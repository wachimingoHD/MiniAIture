import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { Provider } from "@/lib/nanoBanana";
import { getRuntimeConfig } from "@/lib/config/runtime";
import {
  MAX_PRO_GALLERY_ENTRIES,
  type UserDocument,
  buildInitialUserDocument,
} from "@/lib/firestore/schema";
import { applyDailyResetIfDue, refundCredits, tryDeductCredits } from "@/lib/firestore/credits";

const USERS_COLLECTION = "users";
const RATE_LIMIT_COLLECTION = "rate_limits_free_ip_daily";

function userRef(db: Firestore, uid: string): DocumentReference {
  return db.collection(USERS_COLLECTION).doc(uid);
}

function normalizeEmail(email: string | undefined): string {
  return (email ?? "unknown@local.test").trim().toLowerCase();
}

export async function getOrCreateUserDocument(db: Firestore, args: {
  uid: string;
  email?: string;
}): Promise<UserDocument> {
  const { credits } = getRuntimeConfig();
  const ref = userRef(db, args.uid);

  // Wrap the read+write in a transaction so two concurrent first-login requests
  // can't both observe an empty doc and race to overwrite each other's seed.
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      return snapshot.data() as UserDocument;
    }

    const initial = buildInitialUserDocument({
      email: normalizeEmail(args.email),
      plan: "free",
      freeDailyCredits: credits.freeDaily,
      proDailyCredits: credits.proDaily,
      proMonthlyCredits: credits.proMonthly,
    });
    tx.set(ref, initial);
    return initial;
  });
}

export interface DeductCreditsResult {
  ok: boolean;
  status: 200 | 402;
  uid: string;
  userDoc: UserDocument;
  chargedFrom: {
    daily: number;
    monthly: number;
  };
}

export async function deductGenerationCredits(db: Firestore, args: {
  uid: string;
  email?: string;
  cost: number;
}): Promise<DeductCreditsResult> {
  const { credits } = getRuntimeConfig();
  const ref = userRef(db, args.uid);

  return db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref);
    const current = snap.exists
      ? (snap.data() as UserDocument)
      : buildInitialUserDocument({
          email: normalizeEmail(args.email),
          plan: "free",
          freeDailyCredits: credits.freeDaily,
          proDailyCredits: credits.proDaily,
          proMonthlyCredits: credits.proMonthly,
        });

    const resetAllowance = current.plan === "pro" ? credits.proDaily : credits.freeDaily;
    const afterReset = applyDailyResetIfDue(current, Date.now(), resetAllowance);
    const check = tryDeductCredits(afterReset, args.cost);
    if (!check.ok || !check.newDoc) {
      tx.set(ref, afterReset, { merge: true });
      return {
        ok: false,
        status: 402 as const,
        uid: args.uid,
        userDoc: afterReset,
        chargedFrom: { daily: 0, monthly: 0 },
      };
    }

    tx.set(ref, check.newDoc, { merge: true });
      return {
        ok: true,
        status: 200 as const,
        uid: args.uid,
        userDoc: check.newDoc,
        chargedFrom: check.chargedFrom ?? { daily: args.cost, monthly: 0 },
      };
  });
}

export async function refundGenerationCredits(db: Firestore, args: {
  uid: string;
  chargedFrom: { daily: number; monthly: number };
}): Promise<void> {
  const ref = userRef(db, args.uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = snap.data() as UserDocument;
    const refunded = refundCredits(current, args.chargedFrom);
    tx.set(ref, refunded, { merge: true });
  });
}

export function enforcePlanRules(doc: UserDocument, input: {
  resolution: "512" | "1K" | "2K" | "4K";
  flex_mode: boolean;
  upscale_enabled: boolean;
}): { ok: true } | { ok: false; status: 400 | 403; message: string } {
  if (doc.plan === "pro") return { ok: true };

  if (input.resolution !== "512") {
    return { ok: false, status: 403, message: "Free plan only supports 512 resolution." };
  }
  if (!input.flex_mode) {
    return { ok: false, status: 403, message: "Free plan requires Gemini Flex mode." };
  }
  if (input.upscale_enabled) {
    return { ok: false, status: 403, message: "Free plan does not allow upscaling." };
  }
  return { ok: true };
}

export async function storeProGalleryImages(db: Firestore, args: {
  uid: string;
  prompt: string;
  imageUrls: string[];
  provider: Provider;
}): Promise<void> {
  if (args.imageUrls.length === 0) return;
  const ref = userRef(db, args.uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = snap.data() as UserDocument;
    if (current.plan !== "pro") return;

    const nowIso = new Date().toISOString();
    const newEntries = args.imageUrls.map((url) => ({
      url,
      prompt: args.prompt,
      createdAt: nowIso,
      provider: args.provider,
    }));
    const gallery = [...(current.gallery ?? []), ...newEntries];
    const trimmed = gallery.slice(-MAX_PRO_GALLERY_ENTRIES);

    tx.set(
      ref,
      {
        gallery: trimmed,
      } satisfies Partial<UserDocument>,
      { merge: true },
    );
  });
}

export async function recordGenerationSuccess(db: Firestore, args: {
  uid: string;
  provider: Provider;
  generatedImages: number;
  chargedCredits: number;
}): Promise<void> {
  const ref = userRef(db, args.uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = snap.data() as UserDocument;
    const stats = current.stats ?? {
      totalImagesGenerated: 0,
      totalCreditsUsedFree: 0,
      totalCreditsUsedPro: 0,
      monthsSubscribed: 0,
      googleGenerations: 0,
      falGenerations: 0,
    };

    tx.set(
      ref,
      {
        stats: {
          ...stats,
          totalImagesGenerated: stats.totalImagesGenerated + args.generatedImages,
          totalCreditsUsedFree:
            current.plan === "free"
              ? stats.totalCreditsUsedFree + args.chargedCredits
              : stats.totalCreditsUsedFree,
          totalCreditsUsedPro:
            current.plan === "pro"
              ? stats.totalCreditsUsedPro + args.chargedCredits
              : stats.totalCreditsUsedPro,
          googleGenerations:
            args.provider === "google" ? stats.googleGenerations + 1 : stats.googleGenerations,
          falGenerations:
            args.provider === "fal" ? stats.falGenerations + 1 : stats.falGenerations,
        },
      } satisfies Partial<UserDocument>,
      { merge: true },
    );
  });
}

function dailyRateLimitDocId(ip: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const safeIp = ip.replace(/[^a-zA-Z0-9:._-]/g, "_");
  return `${date}:${safeIp}`;
}

export async function checkAndConsumeFreeIpRateLimit(db: Firestore, args: {
  ip: string;
}): Promise<{ ok: boolean; remaining: number }> {
  const cfg = getRuntimeConfig().security;
  if (!cfg.freeIpRateLimitEnabled) return { ok: true, remaining: Number.POSITIVE_INFINITY };

  const max = cfg.freeIpRateLimitMaxPerDay;
  const ref = db.collection(RATE_LIMIT_COLLECTION).doc(dailyRateLimitDocId(args.ip));
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const currentCount = snap.exists ? Number((snap.data() as { count?: number }).count ?? 0) : 0;
    if (currentCount >= max) {
      return { ok: false, remaining: 0 };
    }

    tx.set(
      ref,
      {
        count: currentCount + 1,
        ip: args.ip,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, remaining: Math.max(0, max - (currentCount + 1)) };
  });

  return result;
}
