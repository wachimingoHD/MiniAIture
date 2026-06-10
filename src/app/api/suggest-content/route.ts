// POST /api/suggest-content
// =============================================================================
// Botón "Sugerir contenido con IA". Cobra 1 crédito, llama a Gemini Flash con
// el título (+ contenido actual si existe, para elevarlo en vez de sustituirlo,
// + estilo como contexto) y devuelve una descripción de contenido para el
// campo Contenido. Reembolsa el crédito si la llamada al LLM falla.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { handleSuggestionRequest } from "@/lib/server/suggestions";
import {
  CONTENT_SUGGESTION_PROMPT,
  buildContentSuggestionMessage,
} from "@/lib/prompts/content-suggestion";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleSuggestionRequest(req, {
    systemPrompt: CONTENT_SUGGESTION_PROMPT,
    buildMessage: (f) => buildContentSuggestionMessage(f.videoTitle, f.content, f.style, f.locale),
    requireSomeInput: (f) => Boolean(f.videoTitle || f.content),
    statField: "contentSuggestions",
  });
}
