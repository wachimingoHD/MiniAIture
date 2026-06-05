import { describe, expect, it } from "vitest";
import {
  buildFallbackPrompt,
  buildUserMessage,
  enhancePrompt,
  type EnhancerInput,
} from "@/lib/services/prompt-enhancer";

const base: EnhancerInput = {
  videoTitle: "Cómo gané 1000€ en un día",
  userPrompt: "Un creador sorprendido señalando un gráfico que sube",
  referenceImageBase64: null,
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
