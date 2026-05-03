import { describe, expect, it } from "vitest";
import { applyDailyResetIfDue, refundCredits, tryDeductCredits } from "@/lib/firestore/credits";
import type { UserDocument } from "@/lib/firestore/schema";

function mkDoc(overrides?: Partial<UserDocument>): UserDocument {
  const now = Date.now();
  return {
    email: "user@test.dev",
    plan: "free",
    credits: {
      daily: 100,
      dailyResetAt: new Date(now + 10_000).toISOString(),
      monthly: 0,
      monthlyResetAt: new Date(now + 86_400_000).toISOString(),
    },
    stats: {
      totalImagesGenerated: 0,
      totalCreditsUsedFree: 0,
      totalCreditsUsedPro: 0,
      monthsSubscribed: 0,
      googleGenerations: 0,
      falGenerations: 0,
    },
    gallery: [],
    ...overrides,
  };
}

describe("credits helpers", () => {
  it("applies daily reset when due", () => {
    const now = Date.now();
    const doc = mkDoc({
      credits: {
        daily: 0,
        dailyResetAt: new Date(now - 1).toISOString(),
        monthly: 0,
        monthlyResetAt: new Date(now + 1_000).toISOString(),
      },
    });
    const next = applyDailyResetIfDue(doc, now, 100);
    expect(next.credits.daily).toBe(100);
    expect(Date.parse(next.credits.dailyResetAt)).toBeGreaterThan(now);
  });

  it("deducts from daily first", () => {
    const doc = mkDoc({ plan: "free" });
    const result = tryDeductCredits(doc, 100);
    expect(result.ok).toBe(true);
    expect(result.newDoc?.credits.daily).toBe(0);
    expect(result.chargedFrom).toEqual({ daily: 100, monthly: 0 });
  });

  it("deducts monthly remainder for pro", () => {
    const doc = mkDoc({
      plan: "pro",
      credits: {
        daily: 20,
        dailyResetAt: new Date(Date.now() + 1_000).toISOString(),
        monthly: 500,
        monthlyResetAt: new Date(Date.now() + 10_000).toISOString(),
      },
    });
    const result = tryDeductCredits(doc, 100);
    expect(result.ok).toBe(true);
    expect(result.newDoc?.credits.daily).toBe(0);
    expect(result.newDoc?.credits.monthly).toBe(420);
    expect(result.chargedFrom).toEqual({ daily: 20, monthly: 80 });
  });

  it("refunds exact sources", () => {
    const doc = mkDoc({
      plan: "pro",
      credits: {
        daily: 0,
        dailyResetAt: new Date(Date.now() + 100).toISOString(),
        monthly: 420,
        monthlyResetAt: new Date(Date.now() + 1000).toISOString(),
      },
    });
    const refunded = refundCredits(doc, { daily: 20, monthly: 80 });
    expect(refunded.credits.daily).toBe(20);
    expect(refunded.credits.monthly).toBe(500);
  });
});
