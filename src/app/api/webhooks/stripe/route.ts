import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/stripe/client";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getRuntimeConfig } from "@/lib/config/runtime";
import type { UserDocument } from "@/lib/firestore/schema";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";

export const runtime = "nodejs";

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

function subscriptionStatusToApp(status: Stripe.Subscription.Status): UserDocument["subscriptionStatus"] {
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled") return "canceled";
  return "active";
}

async function onSubscriptionCreated(db: Firestore, sub: Stripe.Subscription): Promise<void> {
  const uid = (sub.metadata?.uid as string | undefined) ?? null;
  const ref = await findUserRef(db, {
    uid,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
  });
  if (!ref) return;

  const cfg = getRuntimeConfig();
  const subAny = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
    start_date: number;
  };
  const subscriptionStart =
    typeof subAny.current_period_start === "number"
      ? subAny.current_period_start * 1000
      : subAny.start_date * 1000;
  const subscriptionEnd =
    typeof subAny.current_period_end === "number"
      ? subAny.current_period_end * 1000
      : Date.now() + 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  await ref.set(
    {
      plan: "pro",
      stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: subscriptionStatusToApp(sub.status),
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
  const ref = await findUserRef(db, {
    uid: (sub.metadata?.uid as string | undefined) ?? null,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
  });
  if (!ref) return;

  await ref.set(
    {
      plan: "free",
      subscriptionStatus: "canceled",
    } satisfies Partial<UserDocument>,
    { merge: true },
  );
}

async function onInvoicePaid(db: Firestore, invoice: Stripe.Invoice): Promise<void> {
  const invoiceAny = invoice as unknown as { subscription?: string };
  const ref = await findUserRef(db, {
    stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : null,
    stripeSubscriptionId: typeof invoiceAny.subscription === "string" ? invoiceAny.subscription : null,
  });
  if (!ref) return;

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
      typeof (invoice as { period_end?: unknown }).period_end === "number"
        ? ((invoice as { period_end: number }).period_end * 1000)
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
  const invoiceAny = invoice as unknown as { subscription?: string };
  const ref = await findUserRef(db, {
    stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : null,
    stripeSubscriptionId: typeof invoiceAny.subscription === "string" ? invoiceAny.subscription : null,
  });
  if (!ref) return;
  await ref.set({ subscriptionStatus: "past_due" } satisfies Partial<UserDocument>, { merge: true });
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
        detail: (err as Error).message,
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

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      await onSubscriptionCreated(db, event.data.object as Stripe.Subscription);
      break;
    }
    case "customer.subscription.deleted": {
      await onSubscriptionDeleted(db, event.data.object as Stripe.Subscription);
      break;
    }
    case "invoice.payment_succeeded": {
      await onInvoicePaid(db, event.data.object as Stripe.Invoice);
      break;
    }
    case "invoice.payment_failed": {
      await onInvoiceFailed(db, event.data.object as Stripe.Invoice);
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true, type: event.type });
}
