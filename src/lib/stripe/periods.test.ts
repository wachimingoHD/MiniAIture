import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  invoiceSubscriptionPeriodEndMs,
  subscriptionPeriodEndMs,
  subscriptionPeriodStartMs,
} from "./periods";

describe("Stripe period helpers", () => {
  it("reads subscription periods from top-level fields", () => {
    const sub = {
      current_period_start: 1_800,
      current_period_end: 3_600,
      items: { data: [{ current_period_start: 1_000, current_period_end: 2_000 }] },
    } as unknown as Stripe.Subscription;

    expect(subscriptionPeriodStartMs(sub)).toBe(1_800_000);
    expect(subscriptionPeriodEndMs(sub)).toBe(3_600_000);
  });

  it("falls back to subscription item periods", () => {
    const sub = {
      start_date: 500,
      items: {
        data: [
          { current_period_start: 1_000, current_period_end: 4_000 },
          { current_period_start: 1_200, current_period_end: 3_000 },
        ],
      },
    } as unknown as Stripe.Subscription;

    expect(subscriptionPeriodStartMs(sub)).toBe(1_000_000);
    expect(subscriptionPeriodEndMs(sub)).toBe(3_000_000);
  });

  it("reads the paid subscription period from invoice line items", () => {
    const invoice = {
      period_end: 1_000,
      lines: {
        data: [
          { period: { end: 1_000 }, type: "invoiceitem" },
          { period: { end: 3_000 }, price: { recurring: { interval: "month" } } },
          { period: { end: 4_000 }, parent: { subscription_item_details: {} } },
        ],
      },
    } as unknown as Stripe.Invoice;

    expect(invoiceSubscriptionPeriodEndMs(invoice)).toBe(4_000_000);
  });

  it("ignores invoice.period_end when there is no subscription line period", () => {
    const invoice = {
      period_end: 1_000,
      lines: { data: [{ period: { end: 1_000 }, type: "invoiceitem" }] },
    } as unknown as Stripe.Invoice;

    expect(invoiceSubscriptionPeriodEndMs(invoice)).toBeNull();
  });
});
