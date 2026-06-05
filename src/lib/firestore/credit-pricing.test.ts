import { describe, expect, it } from "vitest";
import {
  computeGenerationCreditsCost,
  resolveGenerationMode,
} from "@/lib/firestore/credit-pricing";

describe("computeGenerationCreditsCost (modelo plano doc §2)", () => {
  it("FREE siempre cuesta 100, sin importar el modo", () => {
    expect(computeGenerationCreditsCost({ plan: "free", lowPriority: false })).toBe(100);
    expect(computeGenerationCreditsCost({ plan: "free", lowPriority: true })).toBe(100);
  });

  it("PRO normal cuesta 100", () => {
    expect(computeGenerationCreditsCost({ plan: "pro", lowPriority: false })).toBe(100);
  });

  it("PRO con modo fetch cuesta 70", () => {
    expect(computeGenerationCreditsCost({ plan: "pro", lowPriority: true })).toBe(70);
  });

  it("la resolución no afecta el precio", () => {
    expect(computeGenerationCreditsCost({ plan: "pro", lowPriority: false, resolution: "4K" })).toBe(100);
    expect(computeGenerationCreditsCost({ plan: "free", lowPriority: true, resolution: "512" })).toBe(100);
  });
});

describe("resolveGenerationMode (doc §9.2)", () => {
  it("FREE siempre es fetch", () => {
    expect(resolveGenerationMode("free", false)).toBe("fetch");
    expect(resolveGenerationMode("free", true)).toBe("fetch");
  });

  it("PRO depende del toggle", () => {
    expect(resolveGenerationMode("pro", false)).toBe("normal");
    expect(resolveGenerationMode("pro", true)).toBe("fetch");
  });
});
