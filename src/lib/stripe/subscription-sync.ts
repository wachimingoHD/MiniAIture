import Stripe from "stripe";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { getRuntimeConfig } from "@/lib/config/runtime";
import type { UserDocument } from "@/lib/firestore/schema";
import {
  retrieveCheckoutSessionWithSubscription,
  retrieveSubscription,
} from "@/lib/stripe/client";

interface SubscriptionPeriodView {
  current_period_start?: number;
  current_period_end?: number;
  start_date?: number;
  items?: {
    data?: Array<{
      current_period_start?: number;
      current_period_end?: number;
    }>;
  };
}

export interface StripeSyncResult {
  ok: boolean;
  uid?: string;
  subscriptionId?: string;
  reason?: string;
}

function asPeriodView(sub: Stripe.Subscription): SubscriptionPeriodView {
  return sub as unknown as SubscriptionPeriodView;
}

export function customerIdOf(sub: Stripe.Subscription): string | null {
  if (typeof sub.customer === "string") return sub.customer;
  return sub.customer?.id ?? null;
}

export function subscriptionStatusToApp(
  status: Stripe.Subscription.Status,
): UserDocument["subscriptionStatus"] {
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  if (status === "past_due" || status === "unpaid" || status === "incomplete" || status === "paused") {
    return "past_due";
  }
  return "active";
}

async function findUserRef(
  db: Firestore,
  args: {
    uid?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  },
): Promise<DocumentReference | null> {
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

async function customerMatches(
  ref: DocumentReference,
  expectedCustomerId: string,
): Promise<boolean> {
  const snap = await ref.get();
  if (!snap.exists) return true;
  const existing = (snap.data() as UserDocument).stripeCustomerId;
  return !existing || existing === expectedCustomerId;
}

export async function applyStripeSubscriptionToUser(
  db: Firestore,
  sub: Stripe.Subscription,
  uidHint?: string | null,
): Promise<StripeSyncResult> {
  const uid = uidHint ?? (sub.metadata?.uid as string | undefined) ?? null;
  const customerId = customerIdOf(sub);
  if (!customerId) return { ok: false, reason: "missing_customer" };

  const ref = await findUserRef(db, {
    uid,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
  });
  if (!ref) return { ok: false, reason: "user_not_found" };

  if (!(await customerMatches(ref, customerId))) {
    return { ok: false, reason: "customer_mismatch", uid: ref.id };
  }

  const cfg = getRuntimeConfig();
  const view = asPeriodView(sub);
  const firstItem = view.items?.data?.[0];
  const now = Date.now();
  const subscriptionStart =
    typeof view.current_period_start === "number"
      ? view.current_period_start * 1000
      : typeof firstItem?.current_period_start === "number"
        ? firstItem.current_period_start * 1000
        : (view.start_date ?? Math.floor(now / 1000)) * 1000;
  const subscriptionEnd =
    typeof view.current_period_end === "number"
      ? view.current_period_end * 1000
      : typeof firstItem?.current_period_end === "number"
        ? firstItem.current_period_end * 1000
        : now + 30 * 24 * 60 * 60 * 1000;
  const status = subscriptionStatusToApp(sub.status);
  const grantsProAccess = status === "active" || status === "past_due";

  await ref.set(
    {
      plan: grantsProAccess ? "pro" : "free",
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: status,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      subscriptionStart: new Date(subscriptionStart).toISOString(),
      subscriptionEnd: new Date(subscriptionEnd).toISOString(),
      credits: {
        daily: grantsProAccess ? cfg.credits.proDaily : cfg.credits.freeDaily,
        dailyResetAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        monthly: grantsProAccess ? cfg.credits.proMonthly : 0,
        monthlyResetAt: new Date(subscriptionEnd).toISOString(),
      },
    } satisfies Partial<UserDocument>,
    { merge: true },
  );

  return { ok: true, uid: ref.id, subscriptionId: sub.id };
}

function uidFromSession(session: Stripe.Checkout.Session): string | null {
  return (
    (typeof session.metadata?.uid === "string" && session.metadata.uid) ||
    (typeof session.client_reference_id === "string" && session.client_reference_id) ||
    null
  );
}

async function subscriptionFromSession(
  session: Stripe.Checkout.Session,
): Promise<Stripe.Subscription | null> {
  if (!session.subscription) return null;
  if (typeof session.subscription === "string") {
    return retrieveSubscription(session.subscription);
  }
  return session.subscription as Stripe.Subscription;
}

export async function syncCheckoutSessionToUser(
  db: Firestore,
  sessionOrId: Stripe.Checkout.Session | string,
  expectedUid?: string | null,
): Promise<StripeSyncResult> {
  const session =
    typeof sessionOrId === "string"
      ? await retrieveCheckoutSessionWithSubscription(sessionOrId)
      : sessionOrId;

  if (session.mode !== "subscription") {
    return { ok: false, reason: "not_subscription_checkout" };
  }

  const sessionUid = uidFromSession(session);
  const sub = await subscriptionFromSession(session);
  if (!sub) return { ok: false, reason: "missing_subscription" };

  const uid = sessionUid ?? (sub.metadata?.uid as string | undefined) ?? null;
  if (!uid) return { ok: false, reason: "missing_uid" };
  if (expectedUid && uid !== expectedUid) {
    return { ok: false, reason: "uid_mismatch", uid };
  }

  const paidEnough =
    session.status === "complete" &&
    (session.payment_status === "paid" || session.payment_status === "no_payment_required");
  const activeEnough = sub.status === "active" || sub.status === "trialing";
  if (!paidEnough && !activeEnough) {
    return { ok: false, reason: "checkout_not_complete", uid, subscriptionId: sub.id };
  }

  return applyStripeSubscriptionToUser(db, sub, uid);
}
