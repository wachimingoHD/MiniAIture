import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/stripe/client";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getRuntimeConfig } from "@/lib/config/runtime";
import type { UserDocument } from "@/lib/firestore/schema";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { safeErrorMessage } from "@/lib/server/errors";
import { syncCheckoutSessionToUser } from "@/lib/stripe/subscription-sync";

export const runtime = "nodejs";

const PROCESSED_EVENTS_COLLECTION = "stripe_processed_events";

// Stripe Subscription's current_period_* fields moved to SubscriptionItem in
// recent API versions. We read them defensively without relying on the
// generated types, which lag behind those changes.
interface SubscriptionPeriodView {
  current_period_start?: number;
  current_period_end?: number;
  start_date?: number;
}

interface InvoicePeriodView {
  subscription?: string;
  period_end?: number;
}

function asPeriodView(sub: Stripe.Subscription): SubscriptionPeriodView {
  return sub as unknown as SubscriptionPeriodView;
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

function subscriptionStatusToApp(status: Stripe.Subscription.Status): UserDocument["subscriptionStatus"] {
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled") return "canceled";
  return "active";
}

async function onSubscriptionCreated(db: Firestore, sub: Stripe.Subscription): Promise<void> {
  const uid = (sub.metadata?.uid as string | undefined) ?? null;
  const customerId = customerIdOf(sub);
  const ref = await findUserRef(db, {
    uid,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
  });
  if (!ref) return;
  if (!(await customerMatches(ref, customerId))) {
    console.warn("Stripe webhook customer mismatch for user", ref.id);
    return;
  }

  const cfg = getRuntimeConfig();
  const subView = asPeriodView(sub);
  const subscriptionStart =
    typeof subView.current_period_start === "number"
      ? subView.current_period_start * 1000
      : (subView.start_date ?? Math.floor(Date.now() / 1000)) * 1000;
  const subscriptionEnd =
    typeof subView.current_period_end === "number"
      ? subView.current_period_end * 1000
      : Date.now() + 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  await ref.set(
    {
      plan: "pro",
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: subscriptionStatusToApp(sub.status),
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      subscriptionStart: new Date(subscriptionStart).toISOString(),
      subscriptionEnd: new Date(subscriptionEnd).toISOString(),
      credits: {
        daily: cfg.credits.proDaily,
        dailyResetAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        monthly: cfg.credits.proMonthly,
        monthlyResetAt: new Date(subscriptionEnd).toISOString(),
      },
    } satisfies Partial<UserDocument>,
    { merge: true },
  );
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
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = snap.data() as UserDocument;
    const currentStats = current.stats ?? {
      totalImagesGenerated: 0,
      totalCreditsUsedFree: 0,
      totalCreditsUsedPro: 0,
      monthsSubscribed: 0,
      googleGenerations: 0,
      falGenerations: 0,
    };

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
      await onSubscriptionCreated(db, event.data.object as Stripe.Subscription);
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
