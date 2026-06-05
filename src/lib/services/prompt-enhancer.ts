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
import { callGeminiFlash, type GeminiTextContent } from "@/lib/geminiText";

export interface EnhancerInput {
  videoTitle: string | null;
  userPrompt: string; // campo 2: descripción del contenido
  referenceImageBase64: string | null; // imagen de referencia codificada
  referenceImageMimeType?: string | null;
  referenceInstructions: string | null;
  stylePrompt: string; // texto del estilo (preset, custom o galería)
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
  if (input.stylePrompt) {
    userMessage += `VISUAL STYLE DIRECTION: ${input.stylePrompt}\n\n`;
  }
  if (input.referenceInstructions) {
    userMessage += `REFERENCE IMAGE INSTRUCTIONS: ${input.referenceInstructions}\n\n`;
  }
  userMessage += `Generate an optimized image generation prompt based on all the above. Output ONLY the prompt, nothing else.`;
  return userMessage;
}

// Prompt de respaldo determinista cuando el LLM no está disponible.
export function buildFallbackPrompt(input: EnhancerInput): string {
  const parts: string[] = [];
  if (input.videoTitle) parts.push(`Theme: ${input.videoTitle}.`);
  parts.push(input.userPrompt);
  if (input.stylePrompt) parts.push(`Style: ${input.stylePrompt}`);
  if (input.referenceInstructions) parts.push(`Reference notes: ${input.referenceInstructions}`);
  parts.push(
    '16:9 aspect ratio. YouTube thumbnail style. High contrast. Bold and readable at small sizes.',
  );
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

  const contents: GeminiTextContent[] = [];
  if (input.referenceImageBase64) {
    contents.push({
      role: "user",
      parts: [
        {
          inlineData: {
            mimeType: input.referenceImageMimeType ?? "image/jpeg",
            data: input.referenceImageBase64,
          },
        },
        {
          text:
            "This is a reference image. Extract its visual style (color palette, composition, lighting, level of detail) and apply it to the following request.\n\n" +
            userMessage,
        },
      ],
    });
  } else {
    contents.push({ role: "user", parts: [{ text: userMessage }] });
  }

  const response = await callGeminiFlash({
    systemInstruction: THUMBNAIL_SYSTEM_PROMPT,
    contents,
    apiKey: opts.apiKey,
  });

  if (!response.ok) {
    return { enhancedPrompt: buildFallbackPrompt(input), usedLlm: false, llmError: response.error };
  }
  return { enhancedPrompt: response.text, usedLlm: true };
}
