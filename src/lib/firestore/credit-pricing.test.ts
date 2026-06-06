import { describe, expect, it } from "vitest";
import {
  computeGenerationCreditsCost,
  deriveModesFromParams,
  resolveGenerationMode,
  type GenerationModes,
} from "@/lib/firestore/credit-pricing";

const M = (m: Partial<GenerationModes> = {}): GenerationModes => ({
  saver: false,
  highQuality: false,
  highRes: false,
  ...m,
});

describe("computeGenerationCreditsCost (modelo por modos doc §2)", () => {
  it("FREE siempre cuesta 100, sin importar los modos", () => {
    expect(computeGenerationCreditsCost("free", M())).toBe(100);
    expect(computeGenerationCreditsCost("free", M({ saver: true, highQuality: true, highRes: true }))).toBe(100);
  });

  it("PRO base cuesta 100", () => {
    expect(computeGenerationCreditsCost("pro", M())).toBe(100);
  });

  it("PRO ahorro -25, alta calidad +25, alta resolución +25 (acumulables)", () => {
    expect(computeGenerationCreditsCost("pro", M({ saver: true }))).toBe(75);
    expect(computeGenerationCreditsCost("pro", M({ highQuality: true }))).toBe(125);
    expect(computeGenerationCreditsCost("pro", M({ highRes: true }))).toBe(125);
    expect(computeGenerationCreditsCost("pro", M({ saver: true, highQuality: true }))).toBe(100);
    expect(computeGenerationCreditsCost("pro", M({ highQuality: true, highRes: true }))).toBe(150);
    expect(computeGenerationCreditsCost("pro", M({ saver: true, highQuality: true, highRes: true }))).toBe(125);
  });
});

describe("deriveModesFromParams", () => {
  it("default (512 → upscale 1K): sin modos extra", () => {
    expect(deriveModesFromParams({ resolution: "512", flex_mode: false, upscale_enabled: true, upscale_resolution: "1K" })).toEqual(
      M(),
    );
  });
  it("alta calidad: nativo 1K", () => {
    expect(deriveModesFromParams({ resolution: "1K", flex_mode: false, upscale_enabled: false, upscale_resolution: "1K" })).toEqual(
      M({ highQuality: true }),
    );
  });
  it("alta resolución: final 2K", () => {
    expect(deriveModesFromParams({ resolution: "512", flex_mode: false, upscale_enabled: true, upscale_resolution: "2K" })).toEqual(
      M({ highRes: true }),
    );
  });
  it("ahorro: flex", () => {
    expect(deriveModesFromParams({ resolution: "512", flex_mode: true, upscale_enabled: true, upscale_resolution: "1K" })).toEqual(
      M({ saver: true }),
    );
  });
});

describe("resolveGenerationMode (doc §9.2)", () => {
  it("FREE siempre es cola (fetch)", () => {
    expect(resolveGenerationMode("free", false)).toBe("fetch");
    expect(resolveGenerationMode("free", true)).toBe("fetch");
  });

  it("PRO depende del ahorro", () => {
    expect(resolveGenerationMode("pro", false)).toBe("normal");
    expect(resolveGenerationMode("pro", true)).toBe("fetch");
  });
});
