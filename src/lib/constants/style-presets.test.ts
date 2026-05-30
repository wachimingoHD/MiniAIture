import { describe, expect, it } from "vitest";
import { STYLE_PRESETS, getStylePreset } from "@/lib/constants/style-presets";

describe("STYLE_PRESETS (doc §8)", () => {
  it("hay al menos 6 presets para el lanzamiento", () => {
    expect(STYLE_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it("los ids son únicos", () => {
    const ids = STYLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todos tienen prompt y nicho no vacíos", () => {
    for (const p of STYLE_PRESETS) {
      expect(p.prompt.length).toBeGreaterThan(20);
      expect(p.nicho.length).toBeGreaterThan(0);
    }
  });

  it("cubre los nichos clave", () => {
    const nichos = new Set(STYLE_PRESETS.map((p) => p.nicho));
    for (const n of ["gaming", "tutorial", "finance", "entertainment", "reaction", "generic"]) {
      expect(nichos.has(n)).toBe(true);
    }
  });

  it("getStylePreset resuelve por id", () => {
    expect(getStylePreset("gaming-epic")?.name).toBe("Gaming Épico");
    expect(getStylePreset("nope")).toBeNull();
    expect(getStylePreset(null)).toBeNull();
  });
});
