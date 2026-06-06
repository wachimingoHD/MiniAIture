import type { Plan } from "@/lib/firestore/schema";

export type UserFacingResolution = "512" | "1K" | "2K" | "4K";

// Modos de generación (PRO). FREE ignora todos: coste fijo, 512, cola forzada.
export interface GenerationModes {
  saver: boolean; // "Ahorro": cola de baja prioridad (flex). -25 créditos.
  highQuality: boolean; // "Alta calidad": genera nativo en 1K. +25 créditos.
  highRes: boolean; // "Alta resolución": resultado final a 2K. +25 créditos.
}

export const BASE_GENERATION_CREDITS = 100;
export const MODE_DELTA_CREDITS = 25;

// Modelo por modos (doc §2 actualizado):
//   FREE -> 100 fijo.
//   PRO  -> 100 base; -25 ahorro; +25 alta calidad; +25 alta resolución (acumulables).
export function computeGenerationCreditsCost(plan: Plan, modes: GenerationModes): number {
  if (plan === "free") return BASE_GENERATION_CREDITS;
  let credits = BASE_GENERATION_CREDITS;
  if (modes.saver) credits -= MODE_DELTA_CREDITS;
  if (modes.highQuality) credits += MODE_DELTA_CREDITS;
  if (modes.highRes) credits += MODE_DELTA_CREDITS;
  return credits;
}

// Deriva los modos desde los params técnicos YA validados (no se confía en el
// cliente): la calidad alta = genera nativo en 1K; la resolución alta = final 2K+.
export function deriveModesFromParams(p: {
  resolution: string;
  flex_mode: boolean;
  upscale_enabled: boolean;
  upscale_resolution: string;
}): GenerationModes {
  const finalRes = p.upscale_enabled ? p.upscale_resolution : p.resolution;
  return {
    saver: !!p.flex_mode,
    highQuality: p.resolution === "1K",
    highRes: finalRes === "2K" || finalRes === "4K",
  };
}

// Modo efectivo de generación según plan + ahorro (doc §9.2). FREE siempre cola.
// El fallback a "normal" cuando la cola falla se decide en el flujo (solo PRO).
export function resolveGenerationMode(plan: Plan, saver: boolean): "normal" | "fetch" {
  if (plan === "free") return "fetch";
  return saver ? "fetch" : "normal";
}
