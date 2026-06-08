import { describe, expect, it } from "vitest";
import {
  buildFallbackPrompt,
  buildUserMessage,
  enhancePrompt,
  normalizeImageCitations,
  type EnhancerInput,
} from "@/lib/services/prompt-enhancer";

const base: EnhancerInput = {
  videoTitle: "Cómo gané 1000€ en un día",
  userPrompt: "Un creador sorprendido señalando un gráfico que sube",
  referenceImages: [],
  referenceInstructions: null,
  stylePrompt: "Finance pro style, blue and white",
};

describe("buildUserMessage (doc §3.2)", () => {
  it("incluye título, descripción y estilo y termina pidiendo solo el prompt", () => {
    const msg = buildUserMessage(base);
    expect(msg).toContain('VIDEO TITLE: "Cómo gané 1000€ en un día"');
    expect(msg).toContain("THUMBNAIL DESCRIPTION:");
    expect(msg).toContain("VISUAL STYLE DIRECTION:");
    expect(msg).toContain("Output ONLY the prompt");
  });

  it("omite el título si no se proporciona", () => {
    const msg = buildUserMessage({ ...base, videoTitle: null });
    expect(msg).not.toContain("VIDEO TITLE");
  });

  it("lista las imágenes adjuntas y las trata como sujetos reales", () => {
    const msg = buildUserMessage({
      ...base,
      referenceImages: [
        { data: "aaa", mimeType: "image/png", label: "Image 1" },
        { data: "bbb", mimeType: "image/png", label: "Image 2" },
      ],
      referenceInstructions: "Image 2: está fumando muy fuerte",
    });
    expect(msg).toContain("ATTACHED REFERENCE IMAGES (in this order): Image 1, Image 2");
    expect(msg).toContain("the subject from reference image N");
    expect(msg).toContain("PER-IMAGE INSTRUCTIONS:");
  });

  it("no menciona imágenes adjuntas cuando no hay ninguna", () => {
    expect(buildUserMessage(base)).not.toContain("ATTACHED REFERENCE IMAGES");
  });
});

describe("normalizeImageCitations", () => {
  it("convierte [Image N] en 'reference image N' (case/espacios flexibles)", () => {
    expect(normalizeImageCitations("[Image 1] trollea a [image 2]")).toBe(
      "reference image 1 trollea a reference image 2",
    );
    expect(normalizeImageCitations("[ Image  3 ]")).toBe("reference image 3");
  });

  it("también acepta el token legacy en español [Imagen N]", () => {
    expect(normalizeImageCitations("[Imagen 1] y [imagen 2]")).toBe(
      "reference image 1 y reference image 2",
    );
  });

  it("no toca texto sin citas", () => {
    expect(normalizeImageCitations("solo un gato")).toBe("solo un gato");
  });
});

describe("buildFallbackPrompt con imágenes citadas", () => {
  it("normaliza las citas y declara las imágenes como sujetos", () => {
    const out = buildFallbackPrompt({
      ...base,
      userPrompt: "[Image 1] trollea a [Image 2]",
      referenceImages: [
        { data: "a", mimeType: "image/png", label: "Image 1" },
        { data: "b", mimeType: "image/png", label: "Image 2" },
      ],
    });
    expect(out).toContain("reference image 1 trollea a reference image 2");
    expect(out).toContain("as the actual subjects");
    expect(out).not.toContain("[Image");
  });
});

describe("buildFallbackPrompt", () => {
  it("siempre termina con el sufijo técnico de miniatura", () => {
    expect(buildFallbackPrompt(base)).toContain(
      "16:9 aspect ratio. YouTube thumbnail style.",
    );
  });
});

describe("enhancePrompt sin API key", () => {
  it("devuelve el prompt de respaldo y usedLlm=false", async () => {
    const result = await enhancePrompt(base, { apiKey: undefined });
    expect(result.usedLlm).toBe(false);
    expect(result.enhancedPrompt).toContain("16:9 aspect ratio");
  });
});
