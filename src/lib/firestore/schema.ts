// Phase 2 - Firestore schema definitions
// =============================================================================
// These types describe the document shape stored in Firestore. They are the
// source of truth for what /api/generate, /api/user/credits, and Stripe
// webhooks will read/write once Phase 2 is wired up.
//
// Section 17 of MiniAItureDOC.md is the canonical reference.
// =============================================================================

export type Plan = "free" | "pro";
export type SubscriptionStatus = "active" | "canceled" | "past_due";

export interface UserCredits {
  daily: number;
  dailyResetAt: number; // unix ms
  monthly: number;
  monthlyResetAt: number; // unix ms
}

export interface UserAffiliate {
  referredBy?: string;
  discountActive: boolean;
}

export interface UserStats {
  totalImagesGenerated: number;
  totalCreditsUsedFree: number;
  totalCreditsUsedPro: number;
  monthsSubscribed: number;
  googleGenerations: number;
  falGenerations: number;
}

export interface ImageEntry {
  url: string; // R2 public URL
  prompt: string;
  createdAt: number;
  provider: "google" | "fal";
}

export interface UserDocument {
  email: string;
  plan: Plan;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionStart?: number;
  subscriptionEnd?: number;
  credits: UserCredits;
  affiliate?: UserAffiliate;
  stats: UserStats;
  gallery: ImageEntry[]; // Pro-only, capped at 200 (FIFO)
}

export const MAX_PRO_GALLERY_ENTRIES = 200;

export const FREE_DAILY_CREDITS = 100;

// Pro plan numbers — see MiniAItureDOC.md section 13.3 [PENDIENTE].
// Defaults below are placeholders to keep code valid; actual values must be
// chosen before launch.
export const PRO_DAILY_CREDITS_DEFAULT = 500;
export const PRO_MONTHLY_POOL_DEFAULT = 3000;

export const CREDITS_PER_IMAGE = 100;

// ---------------------------------------------------------------------------
// Initial document factory
// ---------------------------------------------------------------------------
export function buildInitialUserDocument(args: {
  email: string;
  plan?: Plan;
  referredBy?: string;
}): UserDocument {
  const now = Date.now();
  const isPro = args.plan === "pro";
  return {
    email: args.email,
    plan: args.plan ?? "free",
    credits: {
      daily: isPro ? PRO_DAILY_CREDITS_DEFAULT : FREE_DAILY_CREDITS,
      dailyResetAt: now + 24 * 60 * 60 * 1000,
      monthly: isPro ? PRO_MONTHLY_POOL_DEFAULT : 0,
      monthlyResetAt: now + 30 * 24 * 60 * 60 * 1000,
    },
    affiliate: args.referredBy
      ? { referredBy: args.referredBy, discountActive: true }
      : { discountActive: false },
    stats: {
      totalImagesGenerated: 0,
      totalCreditsUsedFree: 0,
      totalCreditsUsedPro: 0,
      monthsSubscribed: 0,
      googleGenerations: 0,
      falGenerations: 0,
    },
    gallery: [],
  };
}
