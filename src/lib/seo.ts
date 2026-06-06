// Utilidades SEO compartidas.
// =============================================================================

export const SITE_URL = "https://miniaitura.com";

// Alt text descriptivo y único por miniatura (SEO de imágenes + accesibilidad).
export function generateAltText(g: { nicho?: string | null; userPrompt?: string }): string {
  const nicho = g.nicho ? `${g.nicho} ` : "";
  const prompt = (g.userPrompt ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  return `Miniatura de YouTube ${nicho}generada con IA${prompt ? `: ${prompt}` : ""}`;
}
