// POST /api/suggest-style
// =============================================================================
// Botón "Sugerir estilo con IA". Cobra 1 crédito, llama a Gemini Flash con el
// título + contenido (+ estilo actual si existe, para elevarlo en vez de
// sustituirlo) y devuelve una dirección de estilo para el campo Estilo.
// Reembolsa el crédito si la llamada al LLM falla.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { handleSuggestionRequest } from "@/lib/server/suggestions";
import { STYLE_SUGGESTION_PROMPT, buildStyleSuggestionMessage } from "@/lib/prompts/style-suggestion";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleSuggestionRequest(req, {
    systemPrompt: STYLE_SUGGESTION_PROMPT,
    buildMessage: (f) => buildStyleSuggestionMessage(f.videoTitle, f.content, f.style),
    requireSomeInput: (f) => Boolean(f.videoTitle || f.content),
    statField: "styleSuggestions",
  });
}
