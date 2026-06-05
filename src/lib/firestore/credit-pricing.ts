import type { Plan } from "@/lib/firestore/schema";

export type UserFacingResolution = "512" | "1K" | "2K" | "4K";

export interface CreditPricingInput {
  plan: Plan;
  // `lowPriority` === modo Fetch. Para FREE es siempre true (forzado) pero NO
  // cambia el coste. Para PRO es opcional y aplica el descuento.
  lowPriority: boolean;
  // Se conserva por compatibilidad de firma con el frontend, pero el modelo de
  // precios del doc §2 es PLANO: no depende de la resolución.
  resolution?: UserFacingResolution;
}

export const BASE_GENERATION_CREDITS = 100;
export const FETCH_PRO_CREDITS = 70; // PRO con modo Fetch (doc §2.1 / §2.4)

// Modelo de precios plano (doc §2.1, §2.4, §9.2):
//   FREE  -> 100 siempre (fetch es su modo por defecto, no descuenta)
//   PRO   -> 100 normal / 70 si modo fetch (lowPriority)
export function computeGenerationCreditsCost(input: CreditPricingInput): number {
  if (input.plan === "free") return BASE_GENERATION_CREDITS;
  return input.lowPriority ? FETCH_PRO_CREDITS : BASE_GENERATION_CREDITS;
}

// Modo efectivo de generación según plan + toggle de fetch (doc §9.2).
// El fallback a "flex" cuando Gemini rechaza se decide en el flujo de generación.
export function resolveGenerationMode(plan: Plan, lowPriority: boolean): "normal" | "fetch" {
  if (plan === "free") return "fetch"; // FREE siempre fetch (automático)
  return lowPriority ? "fetch" : "normal";
}
