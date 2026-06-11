import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { getOrCreateUserDocument } from "@/lib/firestore/users";
import { applyResetsIfDue } from "@/lib/firestore/credits";
import { writeCreditTransactionInTx } from "@/lib/firestore/credit-transactions";
import type { UserDocument } from "@/lib/firestore/schema";
import { retrieveSubscription } from "@/lib/stripe/client";
import { isoFromMs, parseIsoMs, subscriptionPeriodEndMs } from "@/lib/stripe/periods";
import { safeErrorMessage } from "@/lib/server/errors";
import { readBearerToken } from "@/lib/server/request";

export const runtime = "nodejs";

const SUSPICIOUS_SUBSCRIPTION_END_WINDOW_MS = 36 * 60 * 60 * 1000;

async function refreshSuspiciousStripePeriod(
  db: NonNullable<ReturnType<typeof adminFirestore>>,
  uid: string,
  doc: UserDocument,
): Promise<UserDocument> {
  if (!doc.stripeSubscriptionId || doc.subscriptionStatus === "canceled") return doc;

  const currentEndMs = parseIsoMs(doc.subscriptionEnd);
  const looksSuspicious =
    !currentEndMs || currentEndMs < Date.now() + SUSPICIOUS_SUBSCRIPTION_END_WINDOW_MS;
  if (!looksSuspicious) return doc;

  try {
    const sub = await retrieveSubscription(doc.stripeSubscriptionId);
    const periodEndIso = isoFromMs(subscriptionPeriodEndMs(sub));
    const patch: Partial<UserDocument> = {};

    if (periodEndIso && periodEndIso !== doc.subscriptionEnd) {
      patch.subscriptionEnd = periodEndIso;
      patch.credits = { ...doc.credits, monthlyResetAt: periodEndIso };
    }
    if (typeof sub.cancel_at_period_end === "boolean" && sub.cancel_at_period_end !== doc.cancelAtPeriodEnd) {
      patch.cancelAtPeriodEnd = sub.cancel_at_period_end;
    }

    if (Object.keys(patch).length === 0) return doc;
    await db.collection("users").doc(uid).set(patch, { merge: true });
    return { ...doc, ...patch };
  } catch (err) {
    console.warn("Could not refresh Stripe subscription period", uid, safeErrorMessage(err, "stripe_refresh_failed"));
    return doc;
  }
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

  const cfg = getRuntimeConfig();
  const initial = await refreshSuspiciousStripePeriod(
    db,
    user.uid,
    await getOrCreateUserDocument(db, { uid: user.uid, email: user.email, displayName: user.name }),
  );
  const dailyResetMs = Date.parse(initial.credits.dailyResetAt);
  const dailyDue = !Number.isFinite(dailyResetMs) || Date.now() > dailyResetMs;
  const monthlyResetMs = Date.parse(initial.credits.monthlyResetAt);
  const monthlyDue =
    initial.plan === "pro" && (!Number.isFinite(monthlyResetMs) || Date.now() > monthlyResetMs);

  // Only run a transaction when a reset is actually due — the read-only path
  // is hit on every page load and shouldn't take a lock.
  let finalDoc: UserDocument = initial;
  if (dailyDue || monthlyDue) {
    finalDoc = await db.runTransaction(async (tx) => {
      const ref = db.collection("users").doc(user.uid);
      const snap = await tx.get(ref);
      if (!snap.exists) return initial;
      const current = snap.data() as UserDocument;
      const allowanceForCurrent = current.plan === "pro" ? cfg.credits.proDaily : cfg.credits.freeDaily;
      const { doc: reset, info } = applyResetsIfDue(
        current,
        Date.now(),
        allowanceForCurrent,
        cfg.credits.proMonthly,
      );
      if (info.dailyResetApplied) {
        writeCreditTransactionInTx(db, tx, {
          userId: user.uid,
          type: "reset",
          amount: info.dailyAfter - info.dailyBefore,
          balanceBefore: info.dailyBefore + info.monthlyBefore,
          balanceAfter: info.dailyAfter + info.monthlyBefore,
        });
      }
      if (info.monthlyResetApplied) {
        writeCreditTransactionInTx(db, tx, {
          userId: user.uid,
          type: "reset",
          amount: info.monthlyAfter - info.monthlyBefore,
          balanceBefore: info.dailyAfter + info.monthlyBefore,
          balanceAfter: info.dailyAfter + info.monthlyAfter,
        });
      }
      if (info.dailyResetApplied || info.monthlyResetApplied) {
        tx.set(ref, reset, { merge: true });
      }
      return reset;
    });
  }

  return NextResponse.json({
    uid: user.uid,
    displayName: finalDoc.displayName ?? null,
    email: finalDoc.email ?? null,
    plan: finalDoc.plan,
    credits: finalDoc.credits,
    stats: finalDoc.stats ?? null,
    subscriptionStatus: finalDoc.subscriptionStatus ?? null,
    subscriptionStart: finalDoc.subscriptionStart ?? null,
    subscriptionEnd: finalDoc.subscriptionEnd ?? null,
    cancelAtPeriodEnd: finalDoc.cancelAtPeriodEnd ?? false,
    stripeSubscriptionId: finalDoc.stripeSubscriptionId ?? null,
  });
}
