// Presets de estilo (doc §8)
// =============================================================================
// Estilos predefinidos por el equipo de MiniAItura. Son estáticos (no Firestore).
// `prompt` se inyecta como VISUAL STYLE DIRECTION en el enhancer (ver §3.2).
//
// Las imágenes de ejemplo (`thumbnailUrl`) deben generarse y guardarse en
// /public/presets/. Hasta entonces el frontend debe tolerar que falten.
// =============================================================================

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  thumbnailUrl: string; // imagen de ejemplo del estilo
  prompt: string; // prompt de estilo que se inyecta al LLM
  nicho: string; // gaming, finance, tutorial, entertainment, reaction, generic
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "gaming-epic",
    name: "Gaming Épico",
    description: "Alta energía, colores saturados, iluminación dramática",
    thumbnailUrl: "/presets/gaming-epic.jpg",
    prompt:
      "Hyper-expressive gaming thumbnail aesthetic. Bright saturated colors, dramatic volumetric lighting with strong light rays, dynamic poses, slight motion blur on edges, particle effects. Dark background with high contrast foreground subjects. Bold and energetic composition.",
    nicho: "gaming",
  },
  {
    id: "tutorial-clean",
    name: "Tutorial Limpio",
    description: "Profesional, claro, fondo limpio con elemento central",
    thumbnailUrl: "/presets/tutorial-clean.jpg",
    prompt:
      "Clean professional tutorial thumbnail style. Soft gradient background, centered subject with clear space around it, clean typography area. Professional lighting, minimal shadows, trust-building blue and white color scheme. Clear and readable at any size.",
    nicho: "tutorial",
  },
  {
    id: "finance-pro",
    name: "Finanzas Pro",
    description: "Profesional y serio, paleta de confianza azul/verde",
    thumbnailUrl: "/presets/finance-pro.jpg",
    prompt:
      "Professional finance and business thumbnail style. Clean modern layout, trust-building color scheme of deep blue, green and white, subtle upward chart or growth motif, crisp professional lighting, confident composition. Polished and authoritative, no clutter.",
    nicho: "finance",
  },
  {
    id: "vlog-casual",
    name: "Vlog Casual",
    description: "Cercano y luminoso, estilo lifestyle/entretenimiento",
    thumbnailUrl: "/presets/vlog-casual.jpg",
    prompt:
      "Warm casual vlog thumbnail style. Natural bright lighting, lifestyle vibe, candid and friendly expression, soft pastel-to-warm color palette, shallow depth of field with a slightly blurred everyday background. Inviting and personable composition.",
    nicho: "entertainment",
  },
  {
    id: "reaction-dramatic",
    name: "Reacción Dramática",
    description: "Expresión exagerada, contraste alto, máxima curiosidad",
    thumbnailUrl: "/presets/reaction-dramatic.jpg",
    prompt:
      "High-drama reaction/commentary thumbnail style. Exaggerated shocked or intense facial expression as the focal point, very high contrast, bold accent color pops (red/yellow), dramatic rim lighting, strong emotional storytelling that creates a curiosity gap. Punchy and attention-grabbing.",
    nicho: "reaction",
  },
  {
    id: "minimal-generic",
    name: "Minimalista Genérico",
    description: "Estilo neutro y versátil para cualquier nicho",
    thumbnailUrl: "/presets/minimal-generic.jpg",
    prompt:
      "Versatile minimal thumbnail style. Bold single focal subject, generous negative space, modern flat-with-depth look, balanced high-contrast color palette following the 60/30/10 rule, clean lighting. Simple, striking and readable at small sizes.",
    nicho: "generic",
  },
];

export const STYLE_PRESETS_BY_ID: Record<string, StylePreset> = Object.fromEntries(
  STYLE_PRESETS.map((p) => [p.id, p]),
);

export function getStylePreset(id: string | null | undefined): StylePreset | null {
  if (!id) return null;
  return STYLE_PRESETS_BY_ID[id] ?? null;
}
