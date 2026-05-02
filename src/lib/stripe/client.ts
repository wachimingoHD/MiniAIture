// Phase 2 - Stripe client
// =============================================================================
// Handles subscriptions (Pro plan), affiliate commissions, and webhook events.
//
// To activate Phase 2:
//   1. Create a Stripe account, enable test mode for development.
//   2. Create a recurring product/price for the Pro plan; copy the price ID.
//   3. Set up a webhook endpoint pointing at /api/webhooks/stripe and copy
//      the signing secret.
//   4. Install: `npm install stripe`
//   5. Implement the functions below.
//
// Reference: MiniAItureDOC.md sections 12, 16.3.
// =============================================================================

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  proPriceId: string;
}

export function getStripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!secretKey || !webhookSecret || !proPriceId) return null;
  return { secretKey, webhookSecret, proPriceId };
}

export interface CreateCheckoutSessionInput {
  uid: string;
  email: string;
  affiliateCode?: string;
}

// TODO[Phase 2]: implement Stripe SDK usage
export async function createProCheckoutSession(_input: CreateCheckoutSessionInput): Promise<string> {
  throw new Error("Stripe not implemented yet (Phase 2).");
}

// Webhook signature verification — DO NOT skip this.
// TODO[Phase 2]: implement using stripe.webhooks.constructEvent
export function verifyWebhookSignature(_payload: string, _signature: string): unknown {
  throw new Error("Stripe webhook verification not implemented yet (Phase 2).");
}
