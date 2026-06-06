// Cancelar la suscripción PRO al final del periodo (doc §billing).
// POST /api/billing/cancel — autenticado; programa cancel_at_period_end en Stripe.
// El usuario sigue siendo PRO hasta que acabe el periodo ya pagado.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getOrCreateUserDocument } from "@/lib/firestore/users";
import { cancelSubscriptionAtPeriodEnd } from "@/lib/stripe/client";
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
    return NextResponse.json({ error: "No tienes una suscripción PRO activa." }, { status: 409 });
  }

  try {
    await cancelSubscriptionAtPeriodEnd(userDoc.stripeSubscriptionId);
    // Sigue siendo PRO hasta el fin del periodo; solo marcamos la intención.
    // El webhook (subscription.deleted) pondrá plan=free cuando llegue la fecha.
    await db
      .collection("users")
      .doc(user.uid)
      .set({ cancelAtPeriodEnd: true }, { merge: true });
    return NextResponse.json({ ok: true, cancelAtPeriodEnd: true, accessUntil: userDoc.subscriptionEnd ?? null });
  } catch (err) {
    return NextResponse.json({ error: safeErrorMessage(err, "cancel_failed") }, { status: 500 });
  }
}
