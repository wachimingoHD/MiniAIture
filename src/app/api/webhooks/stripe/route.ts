import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/stripe/client";

export const runtime = "nodejs";

// Phase 2 endpoint - receives Stripe events and updates Firestore accordingly.
// CRITICAL: webhook signature must be verified or anyone can fake plan upgrades.
//
// Event mapping (per MiniAItureDOC.md section 16.3):
//   customer.subscription.created  -> plan = "pro", init Pro credits
//   invoice.payment_succeeded      -> monthsSubscribed++, renew subscriptionEnd
//   invoice.payment_failed         -> subscriptionStatus = "past_due"
//   customer.subscription.deleted  -> plan = "free", revoke Pro access
export async function POST(req: NextRequest): Promise<NextResponse> {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }
  const rawBody = await req.text();
  try {
    verifyWebhookSignature(rawBody, signature);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Stripe webhook handler not implemented yet (Phase 2).",
        detail: (err as Error).message,
      },
      { status: 501 },
    );
  }
  // TODO[Phase 2]: route events to Firestore mutations.
  return NextResponse.json({ received: true });
}
