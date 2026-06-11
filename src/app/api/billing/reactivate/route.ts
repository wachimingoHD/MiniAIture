// Reanudar una suscripción PRO con cancelación programada.
// POST /api/billing/reactivate — autenticado; quita cancel_at_period_end en
// Stripe. No cobra nada: el periodo en curso ya está pagado y la suscripción
// simplemente vuelve a renovarse. Es la contrapartida de /api/billing/cancel
// (sin esto, un usuario arrepentido quedaba bloqueado: no podía comprar otra
// suscripción porque ya tiene una abierta, ni evitar que la suya muriera).

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getOrCreateUserDocument } from "@/lib/firestore/users";
import type { UserDocument } from "@/lib/firestore/schema";
import { resumeSubscription } from "@/lib/stripe/client";
import { isoFromMs, parseIsoMs, subscriptionPeriodEndMs } from "@/lib/stripe/periods";
import { readBearerToken } from "@/lib/server/request";
import { safeErrorMessage } from "@/lib/server/errors";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = readBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });

  const user = await verifyIdToken(token);
  if (!user) return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });

  const db = adminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin not configured." }, { status: 500 });

  const userDoc = await getOrCreateUserDocument(db, { uid: user.uid, email: user.email, displayName: user.name });

  if (userDoc.plan !== "pro" || !userDoc.stripeSubscriptionId) {
    return NextResponse.json({ error: "No tienes una suscripción PRO que reanudar." }, { status: 409 });
  }
  if (!userDoc.cancelAtPeriodEnd) {
    return NextResponse.json({ ok: true, alreadyActive: true });
  }

  try {
    const subscription = await resumeSubscription(userDoc.stripeSubscriptionId);
    const renewsOn =
      isoFromMs(subscriptionPeriodEndMs(subscription)) ??
      isoFromMs(parseIsoMs(userDoc.subscriptionEnd)) ??
      userDoc.subscriptionEnd ??
      null;
    // El webhook subscription.updated confirmará; esto deja la UI coherente ya.
    const patch: Partial<UserDocument> = { cancelAtPeriodEnd: false };
    if (renewsOn) patch.subscriptionEnd = renewsOn;
    await db.collection("users").doc(user.uid).set(patch, { merge: true });
    return NextResponse.json({ ok: true, renewsOn });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err, "reactivate_failed") }, { status: 500 });
  }
}
