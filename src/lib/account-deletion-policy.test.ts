import { describe, expect, it } from "vitest";
import { hasRenewingStripeSubscription } from "./account-deletion-policy";

describe("hasRenewingStripeSubscription", () => {
  it("blocks a Stripe subscription that can still renew", () => {
    expect(
      hasRenewingStripeSubscription({
        stripeSubscriptionId: "sub_123",
        subscriptionStatus: "active",
        cancelAtPeriodEnd: false,
      }),
    ).toBe(true);
  });

  it("allows deletion after renewal has been cancelled", () => {
    expect(
      hasRenewingStripeSubscription({
        stripeSubscriptionId: "sub_123",
        subscriptionStatus: "active",
        cancelAtPeriodEnd: true,
      }),
    ).toBe(false);
  });

  it("allows cancelled subscriptions and non-Stripe Pro grants", () => {
    expect(
      hasRenewingStripeSubscription({
        stripeSubscriptionId: "sub_123",
        subscriptionStatus: "canceled",
        cancelAtPeriodEnd: false,
      }),
    ).toBe(false);

    expect(
      hasRenewingStripeSubscription({
        subscriptionStatus: "active",
        cancelAtPeriodEnd: false,
      }),
    ).toBe(false);
  });

  it("treats a stale Stripe subscription id with missing status as unsafe", () => {
    expect(
      hasRenewingStripeSubscription({
        stripeSubscriptionId: "sub_123",
      }),
    ).toBe(true);
  });
});
