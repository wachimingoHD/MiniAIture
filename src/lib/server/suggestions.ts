// Núcleo compartido de los sugeridores con IA (estilo y contenido).
// =============================================================================
// Ambos botones siguen el mismo contrato: auth + App Check, cobro de 1 crédito,
// llamada a Gemini Flash barato con un system prompt específico, y reembolso si
// el LLM falla. Solo cambian el prompt y cómo se construye el mensaje.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyAppCheckToken, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getRuntimeConfig } from "@/lib/config/runtime";
import {
  deductGenerationCredits,
  getOrCreateUserDocument,
  incrementUserStat,
  refundGenerationCredits,
} from "@/lib/firestore/users";
import { readBearerToken } from "@/lib/server/request";
import { callGeminiFlash } from "@/lib/geminiText";
import { safeErrorMessage } from "@/lib/server/errors";

// Coste fijo de cada sugerencia (mucho más barato para nosotros de lo que cobra).
export const SUGGESTION_CREDITS = 1;

// Los sugeridores usan siempre Flash barato, no el modelo del enhancer principal.
const SUGGESTION_MODEL = "gemini-2.5-flash";

export interface SuggestionFields {
  videoTitle: string; // máx 200
  content: string; // máx 2000 (campo Contenido actual)
  style: string; // máx 1500 (campo Estilo actual)
  locale: "en" | "es"; // idioma de la página (para el idioma de la sugerencia)
}

export async function handleSuggestionRequest(
  req: NextRequest,
  opts: {
    systemPrompt: string;
    buildMessage: (fields: SuggestionFields) => string;
    // Los campos que, si están todos vacíos, bloquean la petición.
    requireSomeInput: (fields: SuggestionFields) => boolean;
    // Contador de stats del usuario a incrementar cuando la sugerencia sale bien.
    statField: "styleSuggestions" | "contentSuggestions";
  },
): Promise<NextResponse> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not configured on server." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const fields: SuggestionFields = {
    videoTitle: typeof raw.videoTitle === "string" ? raw.videoTitle.trim().slice(0, 200) : "",
    content: typeof raw.content === "string" ? raw.content.trim().slice(0, 2000) : "",
    style: typeof raw.style === "string" ? raw.style.trim().slice(0, 1500) : "",
    locale: raw.locale === "es" ? "es" : "en",
  };

  if (!opts.requireSomeInput(fields)) {
    return NextResponse.json(
      { error: "Escribe un título o describe el contenido del vídeo primero." },
      { status: 400 },
    );
  }

  // Auth obligatoria (cuesta créditos).
  const cfg = getRuntimeConfig();
  const token = readBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });
  }
  const user = await verifyIdToken(token);
  if (!user) {
    return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });
  }
  if (cfg.security.enforceAppCheck) {
    const appCheckToken = req.headers.get("x-firebase-appcheck");
    if (!appCheckToken || !(await verifyAppCheckToken(appCheckToken))) {
      return NextResponse.json({ error: "Invalid Firebase App Check token." }, { status: 401 });
    }
  }

  const db = adminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin not configured." }, { status: 500 });
  }

  const userDoc = await getOrCreateUserDocument(db, { uid: user.uid, email: user.email, displayName: user.name });

  // Solo PRO: un usuario FREE tiene 100 créditos/día (una generación justa);
  // dejarle gastarlos en sugerencias le impediría generar la imagen.
  if (userDoc.plan !== "pro") {
    return NextResponse.json(
      { error: "Las sugerencias con IA son una función PRO.", reason: "pro_only" },
      { status: 403 },
    );
  }

  const charge = await deductGenerationCredits(db, {
    uid: user.uid,
    email: user.email,
    cost: SUGGESTION_CREDITS,
  });
  if (!charge.ok) {
    return NextResponse.json(
      {
        error: "Créditos insuficientes.",
        creditsRemaining: { daily: charge.userDoc.credits.daily, monthly: charge.userDoc.credits.monthly },
      },
      { status: 402 },
    );
  }
  const chargedFrom = charge.chargedFrom;

  try {
    const response = await callGeminiFlash({
      systemInstruction: opts.systemPrompt,
      contents: [{ role: "user", parts: [{ text: opts.buildMessage(fields) }] }],
      apiKey: geminiKey,
      model: SUGGESTION_MODEL,
    });

    const suggestion = response.ok ? response.text.trim() : "";
    if (!suggestion) {
      await refundGenerationCredits(db, { uid: user.uid, chargedFrom });
      return NextResponse.json(
        { error: "No se pudo generar la sugerencia. Inténtalo de nuevo." },
        { status: 502 },
      );
    }

    // Contabilidad de uso (best-effort: si falla no rompe la respuesta).
    await incrementUserStat(db, user.uid, opts.statField).catch(() => {});

    return NextResponse.json({
      suggestion,
      creditsRemaining: {
        daily: charge.userDoc.credits.daily,
        monthly: charge.userDoc.credits.monthly,
      },
    });
  } catch (err) {
    await refundGenerationCredits(db, { uid: user.uid, chargedFrom });
    return NextResponse.json(
      { error: "Unexpected error.", detail: safeErrorMessage(err, "internal_error") },
      { status: 500 },
    );
  }
}
