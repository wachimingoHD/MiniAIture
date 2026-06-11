import Stripe from "stripe";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { getRuntimeConfig } from "@/lib/config/runtime";
import type { UserDocument } from "@/lib/firestore/schema";
import {
  retrieveCheckoutSessionWithSubscription,
  retrieveSubscription,
} from "@/lib/stripe/client";
import { adjustActiveReferrals } from "@/lib/firestore/affiliates";

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

// Acceso PRO real según el estado crudo de Stripe. past_due mantiene el acceso
// como periodo de gracia mientras Stripe reintenta el cobro; incomplete (pago
// inicial sin completar), unpaid, paused y canceled NO dan acceso.
export function subscriptionGrantsProAccess(status: Stripe.Subscription.Status): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

// Estados que cuentan como "suscripción abierta" a efectos de bloquear un
// segundo checkout: todo lo que no esté definitivamente terminado.
export function isOpenSubscriptionStatus(status: Stripe.Subscription.Status): boolean {
  return status !== "canceled" && status !== "incomplete_expired";
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

  const snap = await ref.get();
  // Sin doc de usuario no hay nada que sincronizar. Ocurre tras borrar la
  // cuenta (los eventos de la suscripción cancelada siguen llegando un rato);
  // escribir aquí recrearía un doc fantasma. El alta normal siempre tiene doc
  // (se crea al iniciar sesión, antes de cualquier checkout).
  if (!snap.exists) return { ok: false, reason: "user_doc_missing", uid: ref.id };
  const existing = snap.data() as UserDocument;

  // Defensa en profundidad: si el doc ya está vinculado a OTRO customer de
  // Stripe, no lo tocamos (evita que metadata.uid manipulada reescriba el plan
  // de otro usuario).
  if (existing?.stripeCustomerId && existing.stripeCustomerId !== customerId) {
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
  const grantsProAccess = subscriptionGrantsProAccess(sub.status);
  const subscriptionEndIso = new Date(subscriptionEnd).toISOString();

  // Los créditos solo se rellenan al GANAR acceso PRO o al empezar un periodo
  // de facturación nuevo. Un subscription.updated cualquiera (p. ej. marcar o
  // desmarcar cancel_at_period_end) NO debe recargar los créditos ya gastados.
  const samePaidPeriod =
    grantsProAccess &&
    existing?.plan === "pro" &&
    existing.stripeSubscriptionId === sub.id &&
    existing.subscriptionEnd === subscriptionEndIso;

  const base: Partial<UserDocument> = {
    plan: grantsProAccess ? "pro" : "free",
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    subscriptionStatus: status,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    subscriptionStart: new Date(subscriptionStart).toISOString(),
    subscriptionEnd: subscriptionEndIso,
  };

  // Atribución del código de creador: viaja en la metadata de la suscripción
  // desde el checkout y se fija en el doc del usuario (el asiento de comisión
  // mensual lo lee de aquí en invoice.payment_succeeded).
  const affiliateCode =
    typeof sub.metadata?.affiliateCode === "string" && sub.metadata.affiliateCode.trim()
      ? sub.metadata.affiliateCode.trim().toUpperCase()
      : null;
  // Primera vez que este usuario queda atribuido a este código → cuenta como
  // nuevo referido activo del creador.
  const isNewAttribution =
    !!affiliateCode && grantsProAccess && existing?.affiliate?.referredBy !== affiliateCode;
  if (affiliateCode) {
    base.affiliate = {
      ...(existing?.affiliate ?? { discountActive: false }),
      referredBy: affiliateCode,
      code: affiliateCode,
      discountActive: true,
    };
  }

  await ref.set(
    samePaidPeriod
      ? base
      : {
          ...base,
          credits: {
            daily: grantsProAccess ? cfg.credits.proDaily : cfg.credits.freeDaily,
            dailyResetAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
            monthly: grantsProAccess ? cfg.credits.proMonthly : 0,
            monthlyResetAt: new Date(subscriptionEnd).toISOString(),
          },
        },
    { merge: true },
  );

  if (isNewAttribution && affiliateCode) {
    await adjustActiveReferrals(db, affiliateCode, 1);
  }

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
