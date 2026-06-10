import Stripe from "stripe";
import { getRuntimeConfig } from "@/lib/config/runtime";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  proPriceId: string;
}

export interface StripeCoreConfig {
  secretKey: string;
  proPriceId: string;
}

export type StripeRecurringInterval = "day" | "week" | "month" | "year";

export interface StripePriceSnapshot {
  unitAmountMinor: number | null;
  currency: string;
  interval: StripeRecurringInterval | null;
  intervalCount: number | null;
}

export function getStripeCoreConfig(): StripeCoreConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!secretKey || !proPriceId) return null;
  return { secretKey, proPriceId };
}

export function getStripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!secretKey || !webhookSecret || !proPriceId) return null;
  return { secretKey, webhookSecret, proPriceId };
}

let cachedStripe: Stripe | null | undefined;

export function getStripeClient(): Stripe | null {
  if (cachedStripe !== undefined) return cachedStripe;
  const cfg = getStripeCoreConfig();
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
  // Stripe Promotion Code (promo_...) ya validado contra `affiliates`. Si se
  // pasa, el descuento del creador se aplica automáticamente en el Checkout.
  promotionCodeId?: string;
  successUrl?: string;
  cancelUrl?: string;
}

function withCheckoutSessionId(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("billing")) parsed.searchParams.set("billing", "success");
    if (!parsed.searchParams.has("session_id")) {
      parsed.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
    }
    return parsed.toString().replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}");
  } catch {
    const pairs = [
      url.includes("billing=") ? null : "billing=success",
      url.includes("session_id=") ? null : "session_id={CHECKOUT_SESSION_ID}",
    ].filter(Boolean);
    if (pairs.length === 0) return url;
    const separator =
      url.includes("?") && !url.endsWith("?") && !url.endsWith("&") ? "&" : url.includes("?") ? "" : "?";
    return `${url}${separator}${pairs.join("&")}`;
  }
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
  const cfg = getStripeCoreConfig();
  const stripe = getStripeClient();
  if (!cfg || !stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_* env vars.");
  }

  const runtime = getRuntimeConfig();
  const sessionConfig: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: cfg.proPriceId, quantity: 1 }],
    success_url: withCheckoutSessionId(input.successUrl ?? runtime.billing.checkoutSuccessUrl),
    cancel_url: input.cancelUrl ?? runtime.billing.checkoutCancelUrl,
    client_reference_id: input.uid,
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

  // Descuento del creador (validado en nuestro backend) o, si no hay código,
  // campo libre de códigos en el Checkout. Stripe no permite ambos a la vez.
  if (input.promotionCodeId) {
    sessionConfig.discounts = [{ promotion_code: input.promotionCodeId }];
  } else {
    sessionConfig.allow_promotion_codes = true;
  }

  const session = await stripe.checkout.sessions.create(sessionConfig);

  if (!session.url) throw new Error("Stripe checkout session created without URL.");
  return session.url;
}

export async function retrieveCheckoutSessionWithSubscription(
  sessionId: string,
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  if (!stripe) throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  });
}

export async function retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  if (!stripe) throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  return stripe.subscriptions.retrieve(subscriptionId);
}

// Busca por su texto un promotion code ACTIVO en Stripe (p. ej. "R241").
// Red de seguridad para cuando el doc de `affiliates` guarda un id incorrecto
// (códigos creados a mano) o el promo original fue desactivado.
export async function findActivePromotionCodeByCode(code: string): Promise<string | null> {
  const stripe = getStripeClient();
  if (!stripe) return null;
  const list = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
  return list.data[0]?.id ?? null;
}

// Busca una suscripción "abierta" (cualquier estado que no sea canceled /
// incomplete_expired) del customer. Es la fuente de verdad para bloquear un
// segundo checkout aunque Firestore esté desincronizado.
export async function findOpenSubscription(customerId: string): Promise<Stripe.Subscription | null> {
  const stripe = getStripeClient();
  if (!stripe) return null;
  const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  return (
    subs.data.find((s) => s.status !== "canceled" && s.status !== "incomplete_expired") ?? null
  );
}

export async function getProPriceSnapshot(): Promise<StripePriceSnapshot | null> {
  const cfg = getStripeCoreConfig();
  const stripe = getStripeClient();
  if (!cfg || !stripe) return null;

  const price = await stripe.prices.retrieve(cfg.proPriceId);
  const decimalAmount =
    price.unit_amount_decimal != null ? Number(price.unit_amount_decimal) : null;
  const unitAmountMinor =
    typeof price.unit_amount === "number"
      ? price.unit_amount
      : decimalAmount != null && Number.isFinite(decimalAmount)
        ? Math.round(decimalAmount)
        : null;

  return {
    unitAmountMinor,
    currency: price.currency,
    interval: price.recurring?.interval ?? null,
    intervalCount: price.recurring?.interval_count ?? null,
  };
}

// Programa la cancelación al final del periodo ya pagado (no corta el acceso
// inmediato). El webhook customer.subscription.updated/deleted actualizará el doc.
export async function cancelSubscriptionAtPeriodEnd(subscriptionId: string): Promise<void> {
  const stripe = getStripeClient();
  if (!stripe) throw new Error("Stripe no configurado: faltan STRIPE_* env vars.");
  await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}

// Deshace una cancelación programada: la suscripción vuelve a renovarse con
// normalidad. No cobra nada (el periodo en curso ya está pagado).
export async function resumeSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripeClient();
  if (!stripe) throw new Error("Stripe no configurado: faltan STRIPE_* env vars.");
  await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
}

export function verifyWebhookSignature(payload: string, signature: string): Stripe.Event {
  const cfg = getStripeConfig();
  const stripe = getStripeClient();
  if (!cfg || !stripe) {
    throw new Error("Stripe webhook verification unavailable: missing STRIPE_* env vars.");
  }
  return stripe.webhooks.constructEvent(payload, signature, cfg.webhookSecret);
}
