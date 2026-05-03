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
    vi.doMock("@/lib/stripe/client", () => ({
      verifyWebhookSignature: vi.fn(() => ({
        type: "invoice.payment_failed",
        data: {
          object: {
            customer: "cus_123",
            subscription: "sub_123",
          },
        },
      })),
    }));
    vi.doMock("@/lib/auth/firebase-admin", () => ({
      adminFirestore: vi.fn(() => ({
        collection: () => ({
          where: () => ({
            limit: () => ({
              get: vi.fn(async () => ({
                empty: false,
                docs: [{ ref: { set: setSpy } }],
              })),
            }),
          }),
        }),
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
    expect(setSpy).toHaveBeenCalled();
  });
});
