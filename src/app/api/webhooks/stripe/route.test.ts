import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

describe("/api/webhooks/stripe smoke", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 400 when signature header is missing", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when signature verification fails", async () => {
    vi.doMock("@/lib/stripe/client", () => ({
      verifyWebhookSignature: vi.fn(() => {
        throw new Error("bad signature");
      }),
    }));

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "bad" },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("accepts a valid event and returns 200", async () => {
    const setSpy = vi.fn(async () => undefined);
    const eventLockCreate = vi.fn(async () => undefined);
    const eventLockSet = vi.fn(async () => undefined);

    vi.doMock("@/lib/stripe/client", () => ({
      verifyWebhookSignature: vi.fn(() => ({
        id: "evt_test_1",
        type: "invoice.payment_failed",
        data: {
          object: {
            customer: "cus_123",
            subscription: "sub_123",
          },
        },
      })),
    }));

    const userRefMock = {
      set: setSpy,
      get: vi.fn(async () => ({ exists: true, data: () => ({ stripeCustomerId: "cus_123" }) })),
    };

    vi.doMock("@/lib/auth/firebase-admin", () => ({
      adminFirestore: vi.fn(() => ({
        collection: (name: string) => {
          if (name === "stripe_processed_events") {
            return {
              doc: () => ({
                create: eventLockCreate,
                set: eventLockSet,
                delete: vi.fn(async () => undefined),
              }),
            };
          }
          return {
            where: () => ({
              limit: () => ({
                get: vi.fn(async () => ({
                  empty: false,
                  docs: [{ ref: userRefMock }],
                })),
              }),
            }),
          };
        },
      })),
    }));

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "good" },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(eventLockCreate).toHaveBeenCalled();
    expect(setSpy).toHaveBeenCalled();
    expect(eventLockSet).toHaveBeenCalled();
  });

  it("dedups an already-processed event", async () => {
    const setSpy = vi.fn(async () => undefined);
    // create() rejecting simulates the doc already existing.
    const eventLockCreate = vi.fn(async () => {
      throw Object.assign(new Error("already exists"), { code: 6 });
    });

    vi.doMock("@/lib/stripe/client", () => ({
      verifyWebhookSignature: vi.fn(() => ({
        id: "evt_test_2",
        type: "invoice.payment_failed",
        data: { object: { customer: "cus_123", subscription: "sub_123" } },
      })),
    }));

    vi.doMock("@/lib/auth/firebase-admin", () => ({
      adminFirestore: vi.fn(() => ({
        collection: (name: string) => {
          if (name === "stripe_processed_events") {
            return {
              doc: () => ({
                create: eventLockCreate,
                set: vi.fn(async () => undefined),
                delete: vi.fn(async () => undefined),
              }),
            };
          }
          return {
            where: () => ({ limit: () => ({ get: vi.fn(async () => ({ empty: true, docs: [] })) }) }),
          };
        },
      })),
    }));

    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "good" },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { deduplicated?: boolean };
    expect(payload.deduplicated).toBe(true);
    // Handler should NOT have run, so the user-collection set should not be called.
    expect(setSpy).not.toHaveBeenCalled();
  });
});
