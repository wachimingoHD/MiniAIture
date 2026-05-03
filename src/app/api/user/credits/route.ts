import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { getOrCreateUserDocument } from "@/lib/firestore/users";
import { applyDailyResetIfDue } from "@/lib/firestore/credits";
import type { UserDocument } from "@/lib/firestore/schema";
import { readBearerToken } from "@/lib/server/request";

export const runtime = "nodejs";

function withDailyReset(doc: UserDocument): UserDocument {
  const cfg = getRuntimeConfig();
  const allowance = doc.plan === "pro" ? cfg.credits.proDaily : cfg.credits.freeDaily;
  return applyDailyResetIfDue(doc, Date.now(), allowance);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = readBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });
  }
  const user = await verifyIdToken(token);
  if (!user) {
    return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });
  }

  const db = adminFirestore();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin not configured. Set FIREBASE_ADMIN_CREDENTIALS." },
      { status: 500 },
    );
  }

  const doc = await getOrCreateUserDocument(db, { uid: user.uid, email: user.email });
  const withReset = withDailyReset(doc);
  await db.collection("users").doc(user.uid).set(withReset, { merge: true });

  return NextResponse.json({
    uid: user.uid,
    plan: withReset.plan,
    credits: withReset.credits,
    subscriptionStatus: withReset.subscriptionStatus ?? null,
  });
}
