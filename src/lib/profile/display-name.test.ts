import { describe, expect, it } from "vitest";
import { validateDisplayName } from "@/lib/profile/display-name";

describe("validateDisplayName (doc §7.2)", () => {
  it("acepta un nombre válido", () => {
    const r = validateDisplayName("Alvaro_Creator.1");
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe("Alvaro_Creator.1");
  });

  it("acepta acentos y ñ", () => {
    expect(validateDisplayName("Niño-Español").ok).toBe(true);
  });

  it("rechaza menos de 3 caracteres", () => {
    expect(validateDisplayName("ab").error).toBe("TOO_SHORT");
  });

  it("rechaza más de 30 caracteres", () => {
    expect(validateDisplayName("a".repeat(31)).error).toBe("TOO_LONG");
  });

  it("rechaza caracteres especiales no permitidos", () => {
    expect(validateDisplayName("hola mundo").error).toBe("INVALID_CHARS"); // espacio
    expect(validateDisplayName("user@name").error).toBe("INVALID_CHARS");
  });

  it("rechaza palabras ofensivas", () => {
    expect(validateDisplayName("superputo").error).toBe("OFFENSIVE");
  });

  it("recorta espacios alrededor", () => {
    expect(validateDisplayName("  validName  ").normalized).toBe("validName");
  });
});
