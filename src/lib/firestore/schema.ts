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
  dailyResetAt: string; // ISO string
  monthly: number;
  monthlyResetAt: string; // ISO string
}

export interface UserAffiliate {
  // Código de afiliado que el usuario usó al registrarse (doc §1.1 `code`).
  // `referredBy` se mantiene como alias histórico del mismo dato.
  referredBy?: string;
  code?: string | null;
  // Si este usuario es a su vez un afiliado (tiene su propio código en `affiliates`).
  isAffiliate?: boolean;
  discountActive: boolean;
}

export interface UserStats {
  totalImagesGenerated: number;
  totalCreditsUsedFree: number;
  totalCreditsUsedPro: number;
  monthsSubscribed: number;
  googleGenerations: number;
  falGenerations: number;
  /** Peticiones de generación completadas (una por click en Generar). */
  totalGenerations: number;
  /** Generaciones en modo ahorro (cola flex/fetch). */
  saverGenerations: number;
  /** Generaciones con alta calidad (1K nativo). */
  highQualityGenerations: number;
  /** Generaciones con alta resolución (resultado final 2K). */
  highResGenerations: number;
  /** Usos del sugeridor de estilo con IA. */
  styleSuggestions: number;
  /** Usos del sugeridor de contenido con IA. */
  contentSuggestions: number;
}

// Stats a cero para docs nuevos y para rellenar docs antiguos que no tengan
// alguno de los campos (los contadores nuevos son opcionales en Firestore).
export function emptyUserStats(): UserStats {
  return {
    totalImagesGenerated: 0,
    totalCreditsUsedFree: 0,
    totalCreditsUsedPro: 0,
    monthsSubscribed: 0,
    googleGenerations: 0,
    falGenerations: 0,
    totalGenerations: 0,
    saverGenerations: 0,
    highQualityGenerations: 0,
    highResGenerations: 0,
    styleSuggestions: 0,
    contentSuggestions: 0,
  };
}

// @deprecated — las generaciones se han movido a la colección `generations`
// (doc §1.2). Esta forma sólo se conserva para leer documentos antiguos durante
// la migración (doc §1.6). Código nuevo NO debe escribir en `gallery`.
export interface ImageEntry {
  url: string; // Firebase Storage public URL
  prompt: string;
  createdAt: string; // ISO string
  provider: "google" | "fal";
}

export interface UserDocument {
  // Nombre público editable (doc §1.1 / §7). Default: nombre de Google al registrarse.
  displayName?: string;
  email: string;
  plan: Plan;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionStart?: string;
  subscriptionEnd?: string;
  /** true si la suscripción se cancelará al final del periodo ya pagado. */
  cancelAtPeriodEnd?: boolean;
  credits: UserCredits;
  affiliate?: UserAffiliate;
  stats: UserStats;
  /** @deprecated movido a la colección `generations`. Sólo lectura en migración. */
  gallery?: ImageEntry[];
}

// ---------------------------------------------------------------------------
// Nombres de colecciones (doc §1)
// ---------------------------------------------------------------------------
export const USERS_COLLECTION = "users";
export const GENERATIONS_COLLECTION = "generations";
export const CREDIT_TRANSACTIONS_COLLECTION = "creditTransactions";
export const AFFILIATES_COLLECTION = "affiliates";
export const AFFILIATE_COMMISSIONS_COLLECTION = "affiliateCommissions";
export const RATE_LIMITS_COLLECTION = "rateLimits";

export const MAX_PRO_GALLERY_ENTRIES = 200;

export const FREE_DAILY_CREDITS = 100;

// Pro plan defaults. `PRO_DAILY_CREDITS` can still override this at runtime.
export const PRO_DAILY_CREDITS_DEFAULT = 550;
export const PRO_MONTHLY_POOL_DEFAULT = 3000;

export const CREDITS_PER_IMAGE = 100;

// ---------------------------------------------------------------------------
// Initial document factory
// ---------------------------------------------------------------------------
export function buildInitialUserDocument(args: {
  email: string;
  displayName?: string;
  plan?: Plan;
  referredBy?: string;
  freeDailyCredits?: number;
  proDailyCredits?: number;
  proMonthlyCredits?: number;
}): UserDocument {
  const now = Date.now();
  const isPro = args.plan === "pro";
  const freeDailyCredits = args.freeDailyCredits ?? FREE_DAILY_CREDITS;
  const proDailyCredits = args.proDailyCredits ?? PRO_DAILY_CREDITS_DEFAULT;
  const proMonthlyCredits = args.proMonthlyCredits ?? PRO_MONTHLY_POOL_DEFAULT;
  return {
    displayName: args.displayName ?? deriveDefaultDisplayName(args.email),
    email: args.email,
    plan: args.plan ?? "free",
    credits: {
      daily: isPro ? proDailyCredits : freeDailyCredits,
      dailyResetAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      monthly: isPro ? proMonthlyCredits : 0,
      monthlyResetAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    affiliate: args.referredBy
      ? { referredBy: args.referredBy, code: args.referredBy, isAffiliate: false, discountActive: true }
      : { code: null, isAffiliate: false, discountActive: false },
    stats: emptyUserStats(),
  };
}

// Fallback de displayName cuando no hay nombre de Google: parte local del email.
export function deriveDefaultDisplayName(email: string): string {
  const local = (email.split("@")[0] ?? "user").trim();
  return local.length >= 3 ? local : `user_${local}`;
}
