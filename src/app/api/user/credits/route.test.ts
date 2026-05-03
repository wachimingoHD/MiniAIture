import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

describe("/api/user/credits smoke", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 401 without auth", async () => {
    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost/api/user/credits", { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns initialized user credits when user is valid", async () => {
    vi.doMock("@/lib/auth/firebase-admin", () => ({
      verifyIdToken: vi.fn(async () => ({ uid: "u1", email: "u1@test.dev", emailVerified: true })),
      adminFirestore: vi.fn(() => ({
        collection: () => ({
          doc: () => ({
            set: vi.fn(async () => undefined),
          }),
        }),
      })),
    }));
    vi.doMock("@/lib/firestore/users", () => ({
      getOrCreateUserDocument: vi.fn(async () => ({
        plan: "free",
        credits: {
          daily: 100,
          monthly: 0,
          dailyResetAt: new Date(Date.now() + 1000).toISOString(),
          monthlyResetAt: new Date(Date.now() + 1000).toISOString(),
        },
      })),
    }));

    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost/api/user/credits", {
      method: "GET",
      headers: { authorization: "Bearer valid-token" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { plan: string; credits: { daily: number } };
    expect(payload.plan).toBe("free");
    expect(payload.credits.daily).toBe(100);
  });
});
