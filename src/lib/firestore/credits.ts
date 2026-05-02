// Phase 2 - Firestore credit management
// =============================================================================
// All credit reads/writes must go through atomic transactions (runTransaction)
// to prevent race conditions where two simultaneous /api/generate calls would
// see the same credit balance.
//
// Doc reference: MiniAItureDOC.md section 16.2 (concurrency note) and 13.4
// (credit reset logic).
// =============================================================================

import {
  CREDITS_PER_IMAGE,
  type UserDocument,
} from "./schema";

export interface CreditCheckResult {
  ok: boolean;
  reason?: "INSUFFICIENT" | "RESET_DUE";
  newDoc?: UserDocument;
}

// Apply the time-based daily reset before deducting.
export function applyDailyResetIfDue(
  doc: UserDocument,
  now: number,
  freshDailyAllowance: number,
): UserDocument {
  if (now <= doc.credits.dailyResetAt) return doc;
  return {
    ...doc,
    credits: {
      ...doc.credits,
      daily: freshDailyAllowance,
      dailyResetAt: now + 24 * 60 * 60 * 1000,
    },
  };
}

// Returns the cost in credits for a given action. Per spec, all generations
// cost the same regardless of resolution / provider.
export function creditsForAction(_action: "generate"): number {
  return CREDITS_PER_IMAGE;
}

// Pure function: simulate a deduction. Wire this inside a Firestore
// transaction in /api/generate.
export function tryDeductCredits(doc: UserDocument, cost: number): CreditCheckResult {
  if (doc.credits.daily >= cost) {
    return {
      ok: true,
      newDoc: {
        ...doc,
        credits: { ...doc.credits, daily: doc.credits.daily - cost },
      },
    };
  }
  if (doc.plan === "pro" && doc.credits.monthly >= cost - doc.credits.daily) {
    const fromDaily = doc.credits.daily;
    const fromMonthly = cost - fromDaily;
    return {
      ok: true,
      newDoc: {
        ...doc,
        credits: {
          ...doc.credits,
          daily: 0,
          monthly: doc.credits.monthly - fromMonthly,
        },
      },
    };
  }
  return { ok: false, reason: "INSUFFICIENT" };
}

// On failure, return credits exactly. To use inside a Firestore transaction.
export function refundCredits(doc: UserDocument, cost: number): UserDocument {
  return {
    ...doc,
    credits: {
      ...doc.credits,
      daily: doc.credits.daily + cost,
    },
  };
}

// TODO[Phase 2]: implement the actual transaction wrappers using firebase-admin
// firestore.runTransaction(...). The pure functions above are framework-free
// so they can be unit-tested without Firestore.
