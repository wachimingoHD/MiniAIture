export const ACCOUNT_DELETION_SUBSCRIPTION_REASON = "subscription_must_be_cancelled";

export interface AccountDeletionSubscriptionFields {
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
  cancelAtPeriodEnd?: boolean | null;
}

export function hasRenewingStripeSubscription(doc: AccountDeletionSubscriptionFields): boolean {
  return Boolean(
    doc.stripeSubscriptionId &&
      doc.subscriptionStatus !== "canceled" &&
      doc.cancelAtPeriodEnd !== true,
  );
}
