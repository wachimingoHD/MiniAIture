import { describe, expect, it } from "vitest";
import { applyMonthlyResetIfDue, applyResetsIfDue } from "@/lib/firestore/credits";
import type { UserDocument } from "@/lib/firestore/schema";

function baseDoc(overrides: Partial<UserDocument>): UserDocument {
  const now = Date.now();
  return {
    email: "a@b.test",
    plan: "pro",
    credits: {
      daily: 0,
      dailyResetAt: new Date(now - 1000).toISOString(),
      monthly: 100,
      monthlyResetAt: new Date(now - 1000).toISOString(),
    },
    stats: {
      totalImagesGenerated: 0,
      totalCreditsUsedFree: 0,
      totalCreditsUsedPro: 0,
      monthsSubscribed: 0,
      googleGenerations: 0,
      falGenerations: 0,
    },
    ...overrides,
  };
}

describe("applyMonthlyResetIfDue (doc §2.3)", () => {
  it("solo aplica a PRO", () => {
    const free = baseDoc({ plan: "free" });
    expect(applyMonthlyResetIfDue(free, Date.now(), 3000)).toBe(free);
  });

  it("resetea monthly a la asignación si venció", () => {
    const doc = baseDoc({});
    const out = applyMonthlyResetIfDue(doc, Date.now(), 3000);
    expect(out.credits.monthly).toBe(3000);
  });

  it("no resetea si aún no venció", () => {
    const doc = baseDoc({
      credits: {
        daily: 0,
        dailyResetAt: new Date(Date.now() + 10_000).toISOString(),
        monthly: 100,
        monthlyResetAt: new Date(Date.now() + 10_000).toISOString(),
      },
    });
    expect(applyMonthlyResetIfDue(doc, Date.now(), 3000).credits.monthly).toBe(100);
  });
});

describe("applyResetsIfDue (doc §2.2 + §2.3)", () => {
  it("aplica diario y mensual y reporta metadatos", () => {
    const doc = baseDoc({});
    const { doc: out, info } = applyResetsIfDue(doc, Date.now(), 500, 3000);
    expect(out.credits.daily).toBe(500);
    expect(out.credits.monthly).toBe(3000);
    expect(info.dailyResetApplied).toBe(true);
    expect(info.monthlyResetApplied).toBe(true);
  });

  it("FREE no recibe reset mensual", () => {
    const free = baseDoc({ plan: "free", credits: {
      daily: 0,
      dailyResetAt: new Date(Date.now() - 1000).toISOString(),
      monthly: 0,
      monthlyResetAt: new Date(Date.now() - 1000).toISOString(),
    } });
    const { info } = applyResetsIfDue(free, Date.now(), 100, 3000);
    expect(info.dailyResetApplied).toBe(true);
    expect(info.monthlyResetApplied).toBe(false);
  });
});
