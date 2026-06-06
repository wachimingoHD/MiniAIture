import Stripe from "stripe";
import { getRuntimeConfig } from "@/lib/config/runtime";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  proPriceId: string;
}

export function getStripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!secretKey || !webhookSecret || !proPriceId) return null;
  return { secretKey, webhookSecret, proPriceId };
}

let cachedStripe: Stripe | null | undefined;

function getStripeClient(): Stripe | null {
  if (cachedStripe !== undefined) return cachedStripe;
  const cfg = getStripeConfig();
  if (!cfg) {
    cachedStripe = null;
    return null;
  }
  cachedStripe = new Stripe(cfg.secretKey);
  return cachedStripe;
}

export interface CreateCheckoutSessionInput {
  uid: string;
  email: string;
  // When set, reuse the existing Stripe customer instead of having Stripe
  // create a new one from `customer_email`. Without this, every checkout click
  // produced a fresh customer and broke 1:1 user↔customer accounting.
  existingCustomerId?: string;
  affiliateCode?: string;
}

// Cap the affiliate code to a safe shape before forwarding it into Stripe
// metadata. Stripe rejects metadata values over 500 chars and we don't want
// arbitrary user-supplied strings flowing into our backend telemetry either.
export function sanitizeAffiliateCode(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().slice(0, 64);
  if (!trimmed) return undefined;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return undefined;
  return trimmed;
}

export async function createProCheckoutSession(input: CreateCheckoutSessionInput): Promise<string> {
  const cfg = getStripeConfig();
  const stripe = getStripeClient();
  if (!cfg || !stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_* env vars.");
  }

  const runtime = getRuntimeConfig();
  const sessionConfig: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: cfg.proPriceId, quantity: 1 }],
    success_url: runtime.billing.checkoutSuccessUrl,
    cancel_url: runtime.billing.checkoutCancelUrl,
    metadata: {
      uid: input.uid,
      affiliateCode: input.affiliateCode ?? "",
    },
    subscription_data: {
      metadata: {
        uid: input.uid,
        affiliateCode: input.affiliateCode ?? "",
      },
    },
  };

  if (input.existingCustomerId) {
    sessionConfig.customer = input.existingCustomerId;
  } else {
    sessionConfig.customer_email = input.email;
  }

  const session = await stripe.checkout.sessions.create(sessionConfig);

  if (!session.url) throw new Error("Stripe checkout session created without URL.");
  return session.url;
}

// Programa la cancelación al final del periodo ya pagado (no corta el acceso
// inmediato). El webhook customer.subscription.updated/deleted actualizará el doc.
export async function cancelSubscriptionAtPeriodEnd(subscriptionId: string): Promise<void> {
  const stripe = getStripeClient();
  if (!stripe) throw new Error("Stripe no configurado: faltan STRIPE_* env vars.");
  await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}

export function verifyWebhookSignature(payload: string, signature: string): Stripe.Event {
  const cfg = getStripeConfig();
  const stripe = getStripeClient();
  if (!cfg || !stripe) {
    throw new Error("Stripe webhook verification unavailable: missing STRIPE_* env vars.");
  }
  return stripe.webhooks.constructEvent(payload, signature, cfg.webhookSecret);
}
