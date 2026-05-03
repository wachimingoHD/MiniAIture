import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getOrCreateUserDocument } from "@/lib/firestore/users";
import { readBearerToken } from "@/lib/server/request";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = readBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });

  const user = await verifyIdToken(token);
  if (!user) return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });

  const db = adminFirestore();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin not configured. Set FIREBASE_ADMIN_CREDENTIALS." },
      { status: 500 },
    );
  }

  const doc = await getOrCreateUserDocument(db, { uid: user.uid, email: user.email });
  return NextResponse.json({
    uid: user.uid,
    plan: doc.plan,
    subscriptionStatus: doc.subscriptionStatus ?? null,
    subscriptionStart: doc.subscriptionStart ?? null,
    subscriptionEnd: doc.subscriptionEnd ?? null,
    stripeCustomerId: doc.stripeCustomerId ?? null,
    stripeSubscriptionId: doc.stripeSubscriptionId ?? null,
  });
}
