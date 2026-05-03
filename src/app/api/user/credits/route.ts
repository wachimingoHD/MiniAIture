import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { getOrCreateUserDocument } from "@/lib/firestore/users";
import { applyDailyResetIfDue } from "@/lib/firestore/credits";
import type { UserDocument } from "@/lib/firestore/schema";
import { readBearerToken } from "@/lib/server/request";

export const runtime = "nodejs";

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

  const cfg = getRuntimeConfig();
  const initial = await getOrCreateUserDocument(db, { uid: user.uid, email: user.email });
  const allowance = initial.plan === "pro" ? cfg.credits.proDaily : cfg.credits.freeDaily;
  const resetMs = Date.parse(initial.credits.dailyResetAt);
  const needsReset = !Number.isFinite(resetMs) || Date.now() > resetMs;

  // Only run a transaction when a reset is actually due — the read-only path
  // is hit on every page load and shouldn't take a lock.
  let finalDoc: UserDocument = initial;
  if (needsReset) {
    finalDoc = await db.runTransaction(async (tx) => {
      const ref = db.collection("users").doc(user.uid);
      const snap = await tx.get(ref);
      if (!snap.exists) return initial;
      const current = snap.data() as UserDocument;
      const allowanceForCurrent = current.plan === "pro" ? cfg.credits.proDaily : cfg.credits.freeDaily;
      const reset = applyDailyResetIfDue(current, Date.now(), allowanceForCurrent);
      if (reset !== current) {
        tx.set(ref, reset, { merge: true });
      }
      return reset;
    });
  }

  return NextResponse.json({
    uid: user.uid,
    plan: finalDoc.plan,
    credits: finalDoc.credits,
    subscriptionStatus: finalDoc.subscriptionStatus ?? null,
  });
}
