import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const validBody = {
  params: {
    prompt: "A cinematic thumbnail",
    num_images: 1,
    flex_mode: true,
    enable_google_search: false,
    aspect_ratio: "16:9",
    resolution: "512",
    upscale_enabled: false,
    upscale_resolution: "2K",
  },
  referenceImages: [],
};

describe("/api/generate smoke", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 401 without auth header", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid token", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer invalid-token",
      },
      body: JSON.stringify(validBody),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when free plan uses disallowed resolution", async () => {
    vi.doMock("@/lib/auth/firebase-admin", () => ({
      verifyIdToken: vi.fn(async () => ({ uid: "u1", email: "u1@test.dev", emailVerified: true })),
      adminFirestore: vi.fn(() => ({})),
      verifyAppCheckToken: vi.fn(async () => true),
    }));
    vi.doMock("@/lib/firestore/users", () => ({
      getOrCreateUserDocument: vi.fn(async () => ({
        email: "u1@test.dev",
        plan: "free",
        credits: {
          daily: 100,
          dailyResetAt: new Date(Date.now() + 1000).toISOString(),
          monthly: 0,
          monthlyResetAt: new Date(Date.now() + 1000).toISOString(),
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
      })),
      enforcePlanRules: vi.fn(() => ({
        ok: false,
        status: 403,
        message: "Free plan only supports 512 resolution.",
      })),
      checkAndConsumeFreeIpRateLimit: vi.fn(async () => ({ ok: true, remaining: 0 })),
      deductGenerationCredits: vi.fn(),
      refundGenerationCredits: vi.fn(),
      recordGenerationSuccess: vi.fn(),
      storeProGalleryImages: vi.fn(),
    }));

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer any-token",
      },
      body: JSON.stringify({
        ...validBody,
        params: { ...validBody.params, resolution: "1K" },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
