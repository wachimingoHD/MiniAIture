// POST /api/suggest-field
// Generates an AI suggestion for either the Content or Style textarea.

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyAppCheckToken, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getRuntimeConfig } from "@/lib/config/runtime";
import {
  deductGenerationCredits,
  getOrCreateUserDocument,
  incrementUserStat,
  refundGenerationCredits,
} from "@/lib/firestore/users";
import { callGeminiFlash, DEFAULT_GEMINI_TEXT_MODEL } from "@/lib/geminiText";
import {
  buildFieldSuggestionMessage,
  FIELD_SUGGESTION_CREDITS,
  fieldSuggestionSystemPrompt,
  normalizeSuggestionField,
} from "@/lib/prompts/field-suggestion";
import { safeErrorMessage } from "@/lib/server/errors";
import { readBearerToken } from "@/lib/server/request";

export const runtime = "nodejs";
export const maxDuration = 60;

const FALLBACK_MODELS = [
  DEFAULT_GEMINI_TEXT_MODEL,
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
];

function uniqueModels(): string[] {
  const configured = process.env.GEMINI_TEXT_MODEL?.trim();
  return Array.from(new Set([configured, ...FALLBACK_MODELS].filter(Boolean) as string[]));
}

function cleanSuggestion(raw: string): string {
  return raw
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "")
    .trim();
}

async function generateSuggestion(args: {
  apiKey: string;
  field: "content" | "style";
  locale: string;
  videoTitle: string;
  content: string;
  style: string;
}): Promise<{ ok: true; text: string; model: string } | { ok: false; detail: string }> {
  const systemInstruction = fieldSuggestionSystemPrompt(args.field, args.locale);
  const message = buildFieldSuggestionMessage(args);
  const details: string[] = [];

  for (const model of uniqueModels()) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await callGeminiFlash({
        systemInstruction,
        contents: [{ role: "user", parts: [{ text: message }] }],
        apiKey: args.apiKey,
        model,
        timeoutMs: 18_000,
        disableThinking: true,
      });
      if (response.ok) {
        const text = cleanSuggestion(response.text);
        if (text) return { ok: true, text, model };
        details.push(`${model}#${attempt}: empty_text`);
      } else {
        details.push(`${model}#${attempt}: ${response.error}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }

  return { ok: false, detail: details.join(" | ").slice(0, 1200) };
}

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
  const field = normalizeSuggestionField(raw.field);
  if (!field) return NextResponse.json({ error: "Invalid suggestion field." }, { status: 400 });

  const videoTitle = typeof raw.videoTitle === "string" ? raw.videoTitle.trim().slice(0, 240) : "";
  const content = typeof raw.content === "string" ? raw.content.trim().slice(0, 2200) : "";
  const style = typeof raw.style === "string" ? raw.style.trim().slice(0, 1800) : "";
  const locale = typeof raw.locale === "string" ? raw.locale : "es";

  if (!videoTitle && !content && !style) {
    return NextResponse.json(
      { error: "Add a title, content, or style before generating a suggestion." },
      { status: 400 },
    );
  }

  const cfg = getRuntimeConfig();
  const token = readBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });

  const user = await verifyIdToken(token);
  if (!user) return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });

  if (cfg.security.enforceAppCheck) {
    const appCheckToken = req.headers.get("x-firebase-appcheck");
    if (!appCheckToken || !(await verifyAppCheckToken(appCheckToken))) {
      return NextResponse.json({ error: "Invalid Firebase App Check token." }, { status: 401 });
    }
  }

  const db = adminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin not configured." }, { status: 500 });

  const userDoc = await getOrCreateUserDocument(db, { uid: user.uid, email: user.email, displayName: user.name });
  if (userDoc.plan !== "pro") {
    return NextResponse.json(
      { error: "Las sugerencias con IA son una función PRO.", reason: "pro_only" },
      { status: 403 },
    );
  }

  const charge = await deductGenerationCredits(db, {
    uid: user.uid,
    email: user.email,
    cost: FIELD_SUGGESTION_CREDITS,
  });
  if (!charge.ok) {
    return NextResponse.json(
      {
        error: "Insufficient credits.",
        creditsRemaining: { daily: charge.userDoc.credits.daily, monthly: charge.userDoc.credits.monthly },
      },
      { status: 402 },
    );
  }

  try {
    const suggestion = await generateSuggestion({
      apiKey: geminiKey,
      field,
      locale,
      videoTitle,
      content,
      style,
    });

    if (!suggestion.ok) {
      await refundGenerationCredits(db, { uid: user.uid, chargedFrom: charge.chargedFrom });
      console.warn("Field suggestion failed", { uid: user.uid, field, detail: suggestion.detail });
      return NextResponse.json(
        { error: "No se pudo generar la sugerencia. Inténtalo de nuevo." },
        { status: 502 },
      );
    }

    await incrementUserStat(db, user.uid, field === "style" ? "styleSuggestions" : "contentSuggestions").catch(() => {});

    return NextResponse.json({
      field,
      text: suggestion.text,
      model: suggestion.model,
      creditsRemaining: {
        daily: charge.userDoc.credits.daily,
        monthly: charge.userDoc.credits.monthly,
      },
    });
  } catch (err) {
    await refundGenerationCredits(db, { uid: user.uid, chargedFrom: charge.chargedFrom }).catch(() => {});
    return NextResponse.json(
      { error: "Unexpected error.", detail: safeErrorMessage(err, "internal_error") },
      { status: 500 },
    );
  }
}
