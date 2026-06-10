export type SuggestionField = "content" | "style";

export const FIELD_SUGGESTION_CREDITS = 1;

export function normalizeSuggestionField(raw: unknown): SuggestionField | null {
  return raw === "content" || raw === "style" ? raw : null;
}

export function fieldSuggestionSystemPrompt(field: SuggestionField, locale: string): string {
  if (field === "style") {
    return `You are MiniAitura's style director. Given a YouTube video's title and content description, propose ONE concise visual STYLE direction for its thumbnail: the LOOK only, never the scene, characters, objects, or exact on-image text.

Rules:
- 2 to 4 sentences, tight and concrete.
- Describe only the aesthetic: color palette, lighting, composition approach, typography feel, detail level, and mood.
- It must be reusable for many thumbnails in the same niche.
- Write it in English because it feeds an English image-prompt pipeline.
- Output only the style description. No preamble, quotes, bullets, or markdown.`;
  }

  const language = locale === "es" ? "Spanish" : "English";
  return `You are MiniAitura's thumbnail strategist. Generate a concise CONTENT description for a YouTube thumbnail field.

Rules:
- Write in ${language}.
- Describe what should appear in the thumbnail: main subject, expression/action, setting, visual hook, and any short on-image text if useful.
- Do not write the final image-generation prompt. This is the creator-facing content field.
- Keep it concrete and editable: 2 to 4 sentences.
- Output only the content description. No preamble, quotes, bullets, or markdown.`;
}

export function buildFieldSuggestionMessage(input: {
  field: SuggestionField;
  videoTitle: string;
  content: string;
  style: string;
}): string {
  const parts: string[] = [];
  if (input.videoTitle) parts.push(`VIDEO TITLE:\n${input.videoTitle}`);
  if (input.content) parts.push(`CURRENT CONTENT FIELD:\n${input.content}`);
  if (input.style) parts.push(`CURRENT STYLE FIELD:\n${input.style}`);

  if (input.field === "style") {
    parts.push("Task: propose the best visual style direction for this video's thumbnail.");
  } else {
    parts.push("Task: propose or improve the thumbnail content description for this video.");
  }

  return parts.join("\n\n");
}
