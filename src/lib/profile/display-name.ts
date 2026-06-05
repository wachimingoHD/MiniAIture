// Validación de displayName (doc §7.2)
// =============================================================================
// Reglas:
//   - minLength 3, maxLength 30
//   - solo letras (incl. acentos/ñ), números, guion, guion bajo y punto
//   - filtro básico de palabras ofensivas (ES/EN)
// La unicidad se comprueba contra Firestore en el endpoint, no aquí.
// =============================================================================

export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 30;
export const DISPLAY_NAME_REGEX = /^[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ._-]+$/;

// Lista básica (ampliable). Se comprueba como subcadena en minúsculas.
const BANNED_WORDS = [
  "puta", "puto", "mierda", "gilipollas", "cabron", "cabrón", "polla", "coño",
  "joder", "maricon", "maricón", "zorra", "subnormal", "retrasado",
  "fuck", "shit", "bitch", "asshole", "cunt", "faggot", "nigger", "nigga",
  "whore", "slut", "rape", "nazi",
];

export type DisplayNameError =
  | "TOO_SHORT"
  | "TOO_LONG"
  | "INVALID_CHARS"
  | "OFFENSIVE";

export interface DisplayNameValidation {
  ok: boolean;
  error?: DisplayNameError;
  message?: string;
  normalized?: string;
}

export function validateDisplayName(raw: unknown): DisplayNameValidation {
  const value = typeof raw === "string" ? raw.trim() : "";

  if (value.length < DISPLAY_NAME_MIN) {
    return { ok: false, error: "TOO_SHORT", message: `Mínimo ${DISPLAY_NAME_MIN} caracteres.` };
  }
  if (value.length > DISPLAY_NAME_MAX) {
    return { ok: false, error: "TOO_LONG", message: `Máximo ${DISPLAY_NAME_MAX} caracteres.` };
  }
  if (!DISPLAY_NAME_REGEX.test(value)) {
    return {
      ok: false,
      error: "INVALID_CHARS",
      message: "Solo letras, números, guiones, guiones bajos y puntos.",
    };
  }
  const lower = value.toLowerCase();
  if (BANNED_WORDS.some((w) => lower.includes(w))) {
    return { ok: false, error: "OFFENSIVE", message: "El nombre contiene palabras no permitidas." };
  }
  return { ok: true, normalized: value };
}
