import type { Plan } from "@/lib/firestore/schema";

export type UserFacingResolution = "512" | "1K" | "2K" | "4K";

export interface CreditPricingInput {
  plan: Plan;
  lowPriority: boolean;
  resolution: UserFacingResolution;
}

export const BASE_GENERATION_CREDITS = 100;

export function computeGenerationCreditsCost(input: CreditPricingInput): number {
  let multiplier = 1;

  if (input.resolution === "512") multiplier -= 0.25;
  if (input.resolution === "2K") multiplier += 0.25;
  if (input.resolution === "4K") multiplier += 0.5;

  // Free users are always flex but do not receive the 25% discount.
  if (input.plan === "pro" && input.lowPriority) {
    multiplier -= 0.25;
  }

  return Math.max(1, Math.round(BASE_GENERATION_CREDITS * multiplier));
}
