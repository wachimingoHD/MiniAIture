import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { Provider } from "@/lib/nanoBanana";
import { getRuntimeConfig } from "@/lib/config/runtime";
import {
  MAX_PRO_GALLERY_ENTRIES,
  PENDING_GRANTS_COLLECTION,
  RATE_LIMITS_COLLECTION,
  USERS_COLLECTION,
  type UserDocument,
  type UserStats,
  buildInitialUserDocument,
  emptyUserStats,
} from "@/lib/firestore/schema";
import { applyResetsIfDue, refundCredits, tryDeductCredits } from "@/lib/firestore/credits";
import { writeCreditTransactionInTx } from "@/lib/firestore/credit-transactions";

function totalCredits(doc: UserDocument): number {
  return doc.credits.daily + doc.credits.monthly;
}

function userRef(db: Firestore, uid: string): DocumentReference {
  return db.collection(USERS_COLLECTION).doc(uid);
}

function normalizeEmail(email: string | undefined): string {
  return (email ?? "unknown@local.test").trim().toLowerCase();
}

export async function getOrCreateUserDocument(db: Firestore, args: {
  uid: string;
  email?: string;
  displayName?: string; // nombre de Google al registrarse (doc §7.1)
}): Promise<UserDocument> {
  const { credits } = getRuntimeConfig();
  const ref = userRef(db, args.uid);

  // Wrap the read+write in a transaction so two concurrent first-login requests
  // can't both observe an empty doc and race to overwrite each other's seed.
  return db.runTransaction(async (tx) => {
    const email = normalizeEmail(args.email);
    const snapshot = await tx.get(ref);

    if (snapshot.exists) {
      const existing = snapshot.data() as UserDocument;

      // PRO de cortesía caducado: un PRO SIN suscripción de Stripe (regalado
      // por script) expira cuando pasa su subscriptionEnd. Sin esto, regalar
      // PRO sería permanente. Los PRO de pago no entran aquí (tienen
      // stripeSubscriptionId y los gestiona el ciclo de webhooks).
      const compExpired =
        existing.plan === "pro" &&
        !existing.stripeSubscriptionId &&
        !!existing.subscriptionEnd &&
        Date.parse(existing.subscriptionEnd) < Date.now();
      if (compExpired) {
        const downgrade: Partial<UserDocument> = {
          plan: "free",
          subscriptionStatus: "canceled",
          credits: { ...existing.credits, monthly: 0 },
        };
        tx.set(ref, downgrade, { merge: true });
        return { ...existing, ...downgrade } as UserDocument;
      }

      // Backfill: si el doc no tenía displayName y ahora llega el de Google, lo
      // guardamos (la galería pública lo usa como autor).
      const incoming = args.displayName?.trim();
      if (incoming && !existing.displayName) {
        tx.set(ref, { displayName: incoming } as Partial<UserDocument>, { merge: true });
        return { ...existing, displayName: incoming };
      }
      return existing;
    }

    // Primer inicio de sesión: ¿hay un PRO regalado pendiente para este email?
    const grantRef = db.collection(PENDING_GRANTS_COLLECTION).doc(email);
    const grantSnap = await tx.get(grantRef);
    const grantMonths = grantSnap.exists
      ? Math.max(1, Math.floor(Number((grantSnap.data() as { months?: unknown }).months) || 1))
      : 0;

    const initial = buildInitialUserDocument({
      email,
      displayName: args.displayName?.trim() || undefined,
      plan: grantMonths > 0 ? "pro" : "free",
      freeDailyCredits: credits.freeDaily,
      proDailyCredits: credits.proDaily,
      proMonthlyCredits: credits.proMonthly,
    });
    if (grantMonths > 0) {
      const now = Date.now();
      initial.subscriptionStatus = "active";
      initial.subscriptionStart = new Date(now).toISOString();
      // Sin stripeSubscriptionId: el bloque compExpired de arriba lo degradará
      // a FREE automáticamente cuando pase esta fecha.
      initial.subscriptionEnd = new Date(now + grantMonths * 30 * 24 * 60 * 60 * 1000).toISOString();
      tx.delete(grantRef);
    }
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
  generationId?: string | null;
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

    const dailyAllowance = current.plan === "pro" ? credits.proDaily : credits.freeDaily;
    const { doc: afterReset, info } = applyResetsIfDue(
      current,
      Date.now(),
      dailyAllowance,
      credits.proMonthly,
    );

    // Auditoría de resets (doc §2.2 / §2.3): un creditTransaction "reset" por
    // cada reset aplicado.
    if (info.dailyResetApplied) {
      writeCreditTransactionInTx(db, tx, {
        userId: args.uid,
        type: "reset",
        amount: info.dailyAfter - info.dailyBefore,
        balanceBefore: info.dailyBefore + info.monthlyBefore,
        balanceAfter: info.dailyAfter + info.monthlyBefore,
      });
    }
    if (info.monthlyResetApplied) {
      writeCreditTransactionInTx(db, tx, {
        userId: args.uid,
        type: "reset",
        amount: info.monthlyAfter - info.monthlyBefore,
        balanceBefore: info.dailyAfter + info.monthlyBefore,
        balanceAfter: info.dailyAfter + info.monthlyAfter,
      });
    }

    const balanceBefore = totalCredits(afterReset);
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

    // Auditoría del gasto (doc §2.1): creditTransaction "generation".
    writeCreditTransactionInTx(db, tx, {
      userId: args.uid,
      type: "generation",
      amount: -args.cost,
      balanceBefore,
      balanceAfter: totalCredits(check.newDoc),
      generationId: args.generationId ?? null,
    });

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
  generationId?: string | null;
}): Promise<void> {
  const ref = userRef(db, args.uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = snap.data() as UserDocument;
    const refunded = refundCredits(current, args.chargedFrom);
    const amount = args.chargedFrom.daily + args.chargedFrom.monthly;
    if (amount > 0) {
      writeCreditTransactionInTx(db, tx, {
        userId: args.uid,
        type: "refund",
        amount,
        balanceBefore: totalCredits(current),
        balanceAfter: totalCredits(refunded),
        generationId: args.generationId ?? null,
      });
    }
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
  // Modos efectivos de la generación, para contabilidad posterior en Firestore.
  modes?: { saver: boolean; highQuality: boolean; highRes: boolean };
}): Promise<void> {
  const ref = userRef(db, args.uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = snap.data() as UserDocument;
    // Docs antiguos pueden no tener los contadores nuevos: se rellenan a 0.
    const stats = { ...emptyUserStats(), ...(current.stats ?? {}) };

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
          totalGenerations: stats.totalGenerations + 1,
          saverGenerations: stats.saverGenerations + (args.modes?.saver ? 1 : 0),
          highQualityGenerations: stats.highQualityGenerations + (args.modes?.highQuality ? 1 : 0),
          highResGenerations: stats.highResGenerations + (args.modes?.highRes ? 1 : 0),
        },
      } satisfies Partial<UserDocument>,
      { merge: true },
    );
  });
}

// Incrementa un contador suelto de stats (p. ej. usos de los sugeridores).
// FieldValue.increment trata el campo ausente como 0, así que funciona también
// en documentos antiguos sin el contador.
export async function incrementUserStat(
  db: Firestore,
  uid: string,
  field: keyof Pick<UserStats, "styleSuggestions" | "contentSuggestions">,
): Promise<void> {
  await userRef(db, uid).set(
    { stats: { [field]: FieldValue.increment(1) } },
    { merge: true },
  );
}

function dailyRateLimitDocId(ip: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const safeIp = ip.replace(/[^a-zA-Z0-9:._-]/g, "_");
  return `${date}:${safeIp}`;
}

// Inicio del día siguiente en UTC (00:00). Usado como `expiresAt` para que la
// Cloud Function / cron de limpieza (doc §1.5) pueda borrar documentos vencidos.
function nextUtcMidnightIso(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0)).toISOString();
}

export async function checkAndConsumeFreeIpRateLimit(db: Firestore, args: {
  ip: string;
}): Promise<{ ok: boolean; remaining: number }> {
  const cfg = getRuntimeConfig().security;
  if (!cfg.freeIpRateLimitEnabled) return { ok: true, remaining: Number.POSITIVE_INFINITY };

  const max = cfg.freeIpRateLimitMaxPerDay;
  const ref = db.collection(RATE_LIMITS_COLLECTION).doc(dailyRateLimitDocId(args.ip));
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
        expiresAt: nextUtcMidnightIso(Date.now()),
      },
      { merge: true },
    );
    return { ok: true, remaining: Math.max(0, max - (currentCount + 1)) };
  });

  return result;
}
