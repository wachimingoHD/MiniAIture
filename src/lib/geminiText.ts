// Llamada a Gemini Flash (modelo de TEXTO) para el enhancer de prompts (doc §3).
// =============================================================================
// El resto del proyecto usa el modelo de IMAGEN (gemini-3.1-flash-image-preview,
// ver google.ts). El enhancer necesita un modelo de texto que devuelva el prompt
// optimizado, por eso este módulo aparte. Reutiliza el mismo patrón REST y los
// headers (x-goog-api-key) de google.ts.
//
// El modelo es configurable vía GEMINI_TEXT_MODEL.
// =============================================================================

export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-2.5-flash";

export interface GeminiTextPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiTextContent {
  role: "user" | "model";
  parts: GeminiTextPart[];
}

export interface CallGeminiFlashArgs {
  systemInstruction: string;
  contents: GeminiTextContent[];
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

export type CallGeminiFlashResult =
  | { ok: true; text: string }
  | { ok: false; error: string; statusCode?: number };

interface GeminiTextApiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiTextPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

export async function callGeminiFlash(args: CallGeminiFlashArgs): Promise<CallGeminiFlashResult> {
  const model = args.model ?? process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_TEXT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const timeoutMs = args.timeoutMs ?? 30_000;

  const body = {
    systemInstruction: { parts: [{ text: args.systemInstruction }] },
    contents: args.contents,
    generationConfig: {
      responseModalities: ["TEXT"],
      temperature: 0.7,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": args.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, error: `Gemini text HTTP ${res.status}: ${raw.slice(0, 300)}`, statusCode: res.status };
    }
    let parsed: GeminiTextApiResponse;
    try {
      parsed = JSON.parse(raw) as GeminiTextApiResponse;
    } catch {
      return { ok: false, error: "Gemini text response was not valid JSON." };
    }
    if (parsed.promptFeedback?.blockReason) {
      return { ok: false, error: `Blocked: ${parsed.promptFeedback.blockReason}` };
    }
    const parts = parsed.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? "").join("").trim();
    if (!text) return { ok: false, error: "Gemini text returned no content." };
    return { ok: true, text };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { ok: false, error: `Gemini text timed out after ${timeoutMs}ms.` };
    }
    return { ok: false, error: (err as Error).message ?? "Unknown Gemini text error." };
  } finally {
    clearTimeout(timer);
  }
}
