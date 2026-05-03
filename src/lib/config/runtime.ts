import { FREE_DAILY_CREDITS, PRO_DAILY_CREDITS_DEFAULT, PRO_MONTHLY_POOL_DEFAULT } from "@/lib/firestore/schema";

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : fallback;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  return rounded >= 0 ? rounded : fallback;
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export interface RuntimeConfig {
  credits: {
    freeDaily: number;
    proDaily: number;
    proMonthly: number;
  };
  security: {
    requireAuthForGenerate: boolean;
    freeIpRateLimitEnabled: boolean;
    freeIpRateLimitMaxPerDay: number;
    enforceAppCheck: boolean;
    trustedProxyHeader: string;
  };
  billing: {
    checkoutSuccessUrl: string;
    checkoutCancelUrl: string;
    allowMockStripeWebhookInDev: boolean;
  };
}

let cached: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
  if (cached) return cached;

  const freeDaily = parsePositiveInt(process.env.FREE_DAILY_CREDITS, FREE_DAILY_CREDITS);
  const proDaily = parsePositiveInt(process.env.PRO_DAILY_CREDITS, PRO_DAILY_CREDITS_DEFAULT);
  const proMonthly = parseNonNegativeInt(process.env.PRO_MONTHLY_CREDITS, PRO_MONTHLY_POOL_DEFAULT);

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  cached = {
    credits: {
      freeDaily,
      proDaily,
      proMonthly,
    },
    security: {
      requireAuthForGenerate: parseBoolean(process.env.REQUIRE_AUTH_FOR_GENERATE, true),
      freeIpRateLimitEnabled: parseBoolean(process.env.FREE_IP_RATE_LIMIT_ENABLED, true),
      freeIpRateLimitMaxPerDay: parsePositiveInt(process.env.FREE_IP_RATE_LIMIT_MAX_PER_DAY, 1),
      enforceAppCheck: parseBoolean(process.env.ENFORCE_FIREBASE_APP_CHECK, false),
      trustedProxyHeader: process.env.TRUSTED_CLIENT_IP_HEADER ?? "x-forwarded-for",
    },
    billing: {
      checkoutSuccessUrl:
        process.env.STRIPE_CHECKOUT_SUCCESS_URL ?? `${appUrl}/?billing=success`,
      checkoutCancelUrl:
        process.env.STRIPE_CHECKOUT_CANCEL_URL ?? `${appUrl}/?billing=cancelled`,
      allowMockStripeWebhookInDev: parseBoolean(process.env.ALLOW_MOCK_STRIPE_WEBHOOK_IN_DEV, false),
    },
  };

  return cached;
}

export function resetRuntimeConfigForTests(): void {
  cached = null;
}

export function getRuntimeConfigWarnings(): string[] {
  const warnings: string[] = [];
  const cfg = getRuntimeConfig();

  if (cfg.credits.proDaily < 100) {
    warnings.push("PRO_DAILY_CREDITS is set below generation cost (100).");
  }
  if (cfg.credits.proMonthly < 0) {
    warnings.push("PRO_MONTHLY_CREDITS cannot be negative.");
  }
  if (!cfg.billing.checkoutSuccessUrl.startsWith("http")) {
    warnings.push("STRIPE_CHECKOUT_SUCCESS_URL is not an absolute URL.");
  }
  if (!cfg.billing.checkoutCancelUrl.startsWith("http")) {
    warnings.push("STRIPE_CHECKOUT_CANCEL_URL is not an absolute URL.");
  }
  return warnings;
}

export function getBypassAuthIds(): string[] {
  return parseCsv(process.env.AUTH_BYPASS_UIDS);
}
