import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/stripe/client";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { emptyUserStats, type UserDocument } from "@/lib/firestore/schema";
import { recordAffiliateCommission } from "@/lib/firestore/affiliates";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { safeErrorMessage } from "@/lib/server/errors";
import {
  applyStripeSubscriptionToUser,
  syncCheckoutSessionToUser,
} from "@/lib/stripe/subscription-sync";

export const runtime = "nodejs";

const PROCESSED_EVENTS_COLLECTION = "stripe_processed_events";

interface InvoicePeriodView {
  subscription?: string;
  period_end?: number;
  amount_paid?: number;
  // Snapshot de la metadata de la suscripción que Stripe incluye en la factura
  // (la forma cambió entre versiones de API: leemos ambas defensivamente).
  subscription_details?: { metadata?: Record<string, string> };
  parent?: { subscription_details?: { metadata?: Record<string, string> } };
}

function asInvoiceView(invoice: Stripe.Invoice): InvoicePeriodView {
  return invoice as unknown as InvoicePeriodView;
}

function customerIdOf(sub: Stripe.Subscription): string {
  return typeof sub.customer === "string" ? sub.customer : sub.customer.id;
}

async function findUserRef(db: Firestore, args: {
  uid?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<DocumentReference | null> {
  if (args.uid) return db.collection("users").doc(args.uid);

  if (args.stripeSubscriptionId) {
    const bySub = await db
      .collection("users")
      .where("stripeSubscriptionId", "==", args.stripeSubscriptionId)
      .limit(1)
      .get();
    if (!bySub.empty) return bySub.docs[0].ref;
  }
  if (args.stripeCustomerId) {
    const byCustomer = await db
      .collection("users")
      .where("stripeCustomerId", "==", args.stripeCustomerId)
      .limit(1)
      .get();
    if (!byCustomer.empty) return byCustomer.docs[0].ref;
  }
  return null;
}

// Defense in depth: when the webhook gives us a uid via subscription metadata,
// confirm the existing user document hasn't already been linked to a different
// Stripe customer. If it has, refuse to mutate — this prevents an attacker (or
// dashboard misuse) from rewriting another user's plan by setting metadata.uid.
async function customerMatches(
  ref: DocumentReference,
  expectedCustomerId: string,
): Promise<boolean> {
  const snap = await ref.get();
  if (!snap.exists) return true;
  const existing = (snap.data() as UserDocument).stripeCustomerId;
  return !existing || existing === expectedCustomerId;
}

async function onSubscriptionDeleted(db: Firestore, sub: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(sub);
  const ref = await findUserRef(db, {
    uid: (sub.metadata?.uid as string | undefined) ?? null,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
  });
  if (!ref) return;
  if (!(await customerMatches(ref, customerId))) {
    console.warn("Stripe webhook customer mismatch for user", ref.id);
    return;
  }

  await ref.set(
    {
      plan: "free",
      subscriptionStatus: "canceled",
      cancelAtPeriodEnd: false,
      // El bolsillo mensual es un beneficio PRO: al terminar la suscripción se
      // retira (el diario se renormaliza solo al allowance FREE en el próximo
      // reset diario).
      credits: { monthly: 0 } as UserDocument["credits"],
    } satisfies Partial<UserDocument>,
    { merge: true },
  );
}

async function onInvoicePaid(db: Firestore, invoice: Stripe.Invoice): Promise<void> {
  const invoiceView = asInvoiceView(invoice);
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  const ref = await findUserRef(db, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: typeof invoiceView.subscription === "string" ? invoiceView.subscription : null,
  });
  if (!ref) return;
  if (customerId && !(await customerMatches(ref, customerId))) {
    console.warn("Stripe webhook customer mismatch for user", ref.id);
    return;
  }

  const cfg = getRuntimeConfig();
  // Capturado dentro de la transacción para registrar la comisión del creador
  // (si lo hay) después de aplicar la renovación.
  let referredBy: string | null = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = snap.data() as UserDocument;
    referredBy = current.affiliate?.referredBy?.trim().toUpperCase() || null;
    const currentStats = { ...emptyUserStats(), ...(current.stats ?? {}) };

    const invoicePeriodEnd =
      typeof invoiceView.period_end === "number"
        ? invoiceView.period_end * 1000
        : current.subscriptionEnd
          ? Date.parse(current.subscriptionEnd)
          : undefined;
    const now = Date.now();

    tx.set(
      ref,
      {
        plan: "pro",
        subscriptionStatus: "active",
        subscriptionEnd: new Date(invoicePeriodEnd ?? now).toISOString(),
        credits: {
          ...current.credits,
          daily: cfg.credits.proDaily,
          dailyResetAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
          monthly: cfg.credits.proMonthly,
          monthlyResetAt: new Date(
            invoicePeriodEnd ??
              (current.credits.monthlyResetAt
                ? Date.parse(current.credits.monthlyResetAt)
                : now + 30 * 24 * 60 * 60 * 1000),
          ).toISOString(),
        },
        stats: {
          ...currentStats,
          monthsSubscribed: currentStats.monthsSubscribed + 1,
        },
      } satisfies Partial<UserDocument>,
      { merge: true },
    );
  });

  // Comisión del creador por esta factura. En la PRIMERA factura el doc del
  // usuario puede no tener aún la atribución (carrera entre webhooks), así que
  // caemos a la metadata de la suscripción incluida en la propia factura.
  const metadataCode =
    invoiceView.subscription_details?.metadata?.affiliateCode ??
    invoiceView.parent?.subscription_details?.metadata?.affiliateCode ??
    null;
  const commissionCode = referredBy ?? (metadataCode ? metadataCode.trim().toUpperCase() : null);
  const amountPaid = typeof invoiceView.amount_paid === "number" ? invoiceView.amount_paid : 0;
  if (commissionCode && amountPaid > 0 && invoice.id) {
    await recordAffiliateCommission(db, {
      code: commissionCode,
      uid: ref.id,
      invoiceId: invoice.id,
      amountPaidMinor: amountPaid,
      currency: invoice.currency ?? "eur",
    });
  }
}

async function onInvoiceFailed(db: Firestore, invoice: Stripe.Invoice): Promise<void> {
  const invoiceView = asInvoiceView(invoice);
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  const ref = await findUserRef(db, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: typeof invoiceView.subscription === "string" ? invoiceView.subscription : null,
  });
  if (!ref) return;
  if (customerId && !(await customerMatches(ref, customerId))) {
    console.warn("Stripe webhook customer mismatch for user", ref.id);
    return;
  }
  await ref.set({ subscriptionStatus: "past_due" } satisfies Partial<UserDocument>, { merge: true });
}

async function dispatch(db: Firestore, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await syncCheckoutSessionToUser(db, event.data.object as Stripe.Checkout.Session);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      // Misma lógica que el resto de syncs: el plan depende del estado real de
      // la suscripción y los créditos solo se rellenan en periodos nuevos.
      await applyStripeSubscriptionToUser(db, event.data.object as Stripe.Subscription);
      return;
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(db, event.data.object as Stripe.Subscription);
      return;
    case "invoice.payment_succeeded":
      await onInvoicePaid(db, event.data.object as Stripe.Invoice);
      return;
    case "invoice.payment_failed":
      await onInvoiceFailed(db, event.data.object as Stripe.Invoice);
      return;
    default:
      return;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(rawBody, signature);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Stripe signature verification failed.",
        detail: safeErrorMessage(err, "invalid_signature"),
      },
      { status: 400 },
    );
  }

  const db = adminFirestore();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin not configured. Set FIREBASE_ADMIN_CREDENTIALS." },
      { status: 500 },
    );
  }

  // Idempotency: Stripe will retry webhook delivery on 5xx (or transient
  // network errors). Without dedup, retries double-incremented stats counters
  // and re-issued credit pools. We use a Firestore document keyed by event.id
  // as an atomic lock — `create()` fails if the doc exists, which is exactly
  // the semantics we need.
  const eventLock = db.collection(PROCESSED_EVENTS_COLLECTION).doc(event.id);
  try {
    await eventLock.create({
      type: event.type,
      receivedAt: FieldValue.serverTimestamp(),
    });
  } catch {
    return NextResponse.json({ received: true, type: event.type, deduplicated: true });
  }

  try {
    await dispatch(db, event);
    await eventLock.set(
      { completedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return NextResponse.json({ received: true, type: event.type });
  } catch (err) {
    // Release the lock so Stripe's retry can reprocess from a clean state.
    await eventLock.delete().catch(() => {});
    return NextResponse.json(
      {
        error: "Webhook handler failed.",
        detail: safeErrorMessage(err, "internal_error"),
      },
      { status: 500 },
    );
  }
}
