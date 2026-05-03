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
  affiliateCode?: string;
}

export async function createProCheckoutSession(input: CreateCheckoutSessionInput): Promise<string> {
  const cfg = getStripeConfig();
  const stripe = getStripeClient();
  if (!cfg || !stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_* env vars.");
  }

  const runtime = getRuntimeConfig();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: input.email,
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
  });

  if (!session.url) throw new Error("Stripe checkout session created without URL.");
  return session.url;
}

export function verifyWebhookSignature(payload: string, signature: string): Stripe.Event {
  const cfg = getStripeConfig();
  const stripe = getStripeClient();
  if (!cfg || !stripe) {
    throw new Error("Stripe webhook verification unavailable: missing STRIPE_* env vars.");
  }
  return stripe.webhooks.constructEvent(payload, signature, cfg.webhookSecret);
}
