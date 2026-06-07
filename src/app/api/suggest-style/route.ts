// POST /api/suggest-style
// =============================================================================
// Botón "Sugerir estilo con IA". Cobra 1 crédito, llama a Gemini 2.5 Flash con
// el título + contenido del vídeo y devuelve una dirección de estilo para el
// campo Estilo. Reembolsa el crédito si la llamada al LLM falla.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyAppCheckToken, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getRuntimeConfig } from "@/lib/config/runtime";
import {
  deductGenerationCredits,
  getOrCreateUserDocument,
  refundGenerationCredits,
} from "@/lib/firestore/users";
import { readBearerToken } from "@/lib/server/request";
import { callGeminiFlash } from "@/lib/geminiText";
import { STYLE_SUGGESTION_PROMPT, buildStyleSuggestionMessage } from "@/lib/prompts/style-suggestion";
import { safeErrorMessage } from "@/lib/server/errors";

export const runtime = "nodejs";
export const maxDuration = 30;

// Coste fijo del sugeridor (mucho más barato para nosotros de lo que cobra).
export const STYLE_SUGGESTION_CREDITS = 1;

// El sugeridor usa siempre Flash barato, no el modelo del enhancer principal.
const STYLE_SUGGESTION_MODEL = "gemini-2.5-flash";

export async function POST(req: NextRequest): Promise<NextResponse> {
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
  const videoTitle = typeof raw.videoTitle === "string" ? raw.videoTitle.trim().slice(0, 200) : "";
  const content = typeof raw.content === "string" ? raw.content.trim().slice(0, 2000) : "";

  if (!videoTitle && !content) {
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

  await getOrCreateUserDocument(db, { uid: user.uid, email: user.email, displayName: user.name });

  const charge = await deductGenerationCredits(db, {
    uid: user.uid,
    email: user.email,
    cost: STYLE_SUGGESTION_CREDITS,
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
      systemInstruction: STYLE_SUGGESTION_PROMPT,
      contents: [{ role: "user", parts: [{ text: buildStyleSuggestionMessage(videoTitle, content) }] }],
      apiKey: geminiKey,
      model: STYLE_SUGGESTION_MODEL,
    });

    const style = response.ok ? response.text.trim() : "";
    if (!style) {
      await refundGenerationCredits(db, { uid: user.uid, chargedFrom });
      return NextResponse.json(
        { error: "No se pudo sugerir un estilo. Inténtalo de nuevo." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      style,
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
