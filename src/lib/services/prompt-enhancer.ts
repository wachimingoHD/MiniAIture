// Servicio enhancer de prompts (doc §3.2)
// =============================================================================
// Ensambla el mensaje de usuario a partir de los 5 campos del formulario, llama
// a Gemini Flash (texto) con el system prompt base, y devuelve el prompt
// optimizado para la IA de imagen.
//
// Robustez: si la llamada al LLM falla (timeout, cuota, bloqueo), se devuelve un
// prompt ensamblado de forma determinista para que la generación pueda seguir.
// =============================================================================

import { THUMBNAIL_SYSTEM_PROMPT } from "@/lib/prompts/system-prompt";
import { callGeminiFlash, type GeminiTextContent, type GeminiTextPart } from "@/lib/geminiText";
import type { AspectRatio } from "@/lib/nanoBanana";

const DEFAULT_FINAL_PROMPT_SUFFIX =
  "16:9 aspect ratio, YouTube thumbnail style, high contrast, bold and readable at small sizes.";

function finalPromptSuffix(aspectRatio: AspectRatio): string {
  const ratio = aspectRatio === "9:16" ? "9:16" : "16:9";
  return `${ratio} aspect ratio, YouTube thumbnail style, high contrast, bold and readable at small sizes.`;
}

function thumbnailSystemPrompt(aspectRatio: AspectRatio): string {
  return THUMBNAIL_SYSTEM_PROMPT.replaceAll(
    DEFAULT_FINAL_PROMPT_SUFFIX,
    finalPromptSuffix(aspectRatio),
  );
}

// Una imagen de referencia con su etiqueta visible ("Image 1", "Image 2"…),
// que es como el usuario la cita en el contenido ([Image N]).
export interface EnhancerReferenceImage {
  data: string; // base64 (sin prefijo data:)
  mimeType: string;
  label: string; // "Image 1"
}

export interface EnhancerInput {
  videoTitle: string | null;
  userPrompt: string; // campo 2: descripción del contenido
  referenceImages: EnhancerReferenceImage[]; // TODAS las imágenes, en orden
  referenceInstructions: string | null; // instrucciones por imagen, etiquetadas
  stylePrompt: string; // texto del estilo (preset, custom o galería)
  aspectRatio: AspectRatio;
}

export interface EnhanceResult {
  enhancedPrompt: string;
  usedLlm: boolean;
  llmError?: string;
}

// Construye el mensaje de usuario para el LLM (doc §3.2 paso 1).
export function buildUserMessage(input: EnhancerInput): string {
  let userMessage = "";
  if (input.videoTitle) {
    userMessage += `VIDEO TITLE: "${input.videoTitle}"\n\n`;
  }
  userMessage += `THUMBNAIL DESCRIPTION: ${input.userPrompt}\n\n`;
  if (input.referenceImages.length > 0) {
    const labels = input.referenceImages.map((r) => r.label).join(", ");
    userMessage +=
      `ATTACHED REFERENCE IMAGES (in this order): ${labels}.\n` +
      `When the description cites [Image N] (or [Imagen N] in Spanish), that attached image IS a real subject to place in the thumbnail. In your output prompt refer to it as "the subject from reference image N" and preserve its identity. Every cited subject must appear in the final image.\n\n`;
  }
  if (input.stylePrompt) {
    userMessage += `VISUAL STYLE DIRECTION: ${input.stylePrompt}\n\n`;
  }
  if (input.referenceInstructions) {
    userMessage += `PER-IMAGE INSTRUCTIONS:\n${input.referenceInstructions}\n\n`;
  }
  userMessage += `OUTPUT FORMAT: ${input.aspectRatio === "9:16" ? "vertical 9:16" : "horizontal 16:9"}.\n\n`;
  userMessage += `Generate an optimized image generation prompt based on all the above. Output ONLY the prompt, nothing else.`;
  return userMessage;
}

// Convierte las citas "[Image N]" del usuario en una referencia que el modelo
// de imagen entiende ("reference image N"). Se usa en el respaldo determinista y
// es seguro aplicarlo siempre (si no hay citas, no cambia nada).
// El patrón `imagen?` acepta tanto "Image N" (token actual) como "Imagen N"
// (legacy en español), para no romper contenido antiguo ni de ningún idioma.
export function normalizeImageCitations(text: string): string {
  return text.replace(/\[\s*imagen?\s*(\d+)\s*\]/gi, "reference image $1");
}

// Prompt de respaldo determinista cuando el LLM no está disponible.
export function buildFallbackPrompt(input: EnhancerInput): string {
  const parts: string[] = [];
  if (input.videoTitle) parts.push(`Theme: ${input.videoTitle}.`);
  parts.push(normalizeImageCitations(input.userPrompt));
  if (input.referenceImages.length > 0) {
    parts.push(
      `Use the ${input.referenceImages.length} attached reference image(s) as the actual subjects (preserve their identity); reference image N = the Nth attached image.`,
    );
  }
  if (input.stylePrompt) parts.push(`Style: ${input.stylePrompt}`);
  if (input.referenceInstructions) {
    parts.push(`Reference notes: ${normalizeImageCitations(input.referenceInstructions)}`);
  }
  parts.push(finalPromptSuffix(input.aspectRatio));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export async function enhancePrompt(
  input: EnhancerInput,
  opts: { apiKey: string | undefined },
): Promise<EnhanceResult> {
  const userMessage = buildUserMessage(input);

  // Sin API key no se puede llamar al LLM: devolver respaldo.
  if (!opts.apiKey) {
    return { enhancedPrompt: buildFallbackPrompt(input), usedLlm: false, llmError: "No API key." };
  }

  // Adjuntamos TODAS las imágenes, cada una precedida por su etiqueta ("Image 1:")
  // para que el LLM sepa qué imagen es cuál y pueda casarla con los [Image N]
  // citados en el contenido. El texto de instrucciones va al final.
  const parts: GeminiTextPart[] = [];
  for (const ref of input.referenceImages) {
    parts.push({ text: `${ref.label}:` });
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
  }
  parts.push({ text: userMessage });
  const contents: GeminiTextContent[] = [{ role: "user", parts }];

  const response = await callGeminiFlash({
    systemInstruction: thumbnailSystemPrompt(input.aspectRatio),
    contents,
    apiKey: opts.apiKey,
    // Sin "thinking": el system prompt ya dirige la composición paso a paso y
    // el modo pensar solo añadía segundos a cada generación.
    disableThinking: true,
  });

  if (!response.ok) {
    return { enhancedPrompt: buildFallbackPrompt(input), usedLlm: false, llmError: response.error };
  }
  return { enhancedPrompt: response.text, usedLlm: true };
}
