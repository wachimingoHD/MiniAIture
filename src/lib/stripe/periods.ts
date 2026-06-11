import type Stripe from "stripe";

interface SubscriptionPeriodView {
  current_period_start?: number;
  current_period_end?: number;
  start_date?: number;
  items?: {
    data?: Array<{
      current_period_start?: number;
      current_period_end?: number;
    }>;
  };
}

interface InvoiceLinePeriodView {
  period?: { start?: number; end?: number };
  price?: { recurring?: unknown };
  subscription_item?: string | null;
  parent?: { subscription_item_details?: unknown };
  type?: string;
}

interface InvoiceLinesView {
  lines?: {
    data?: InvoiceLinePeriodView[];
  };
}

function secondsToMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value * 1000 : null;
}

function minTimestamp(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return valid.length > 0 ? Math.min(...valid) : null;
}

function maxTimestamp(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return valid.length > 0 ? Math.max(...valid) : null;
}

function asSubscriptionPeriodView(sub: Stripe.Subscription): SubscriptionPeriodView {
  return sub as unknown as SubscriptionPeriodView;
}

export function subscriptionPeriodStartMs(sub: Stripe.Subscription): number | null {
  const view = asSubscriptionPeriodView(sub);
  return (
    secondsToMs(view.current_period_start) ??
    minTimestamp((view.items?.data ?? []).map((item) => secondsToMs(item.current_period_start))) ??
    secondsToMs(view.start_date)
  );
}

export function subscriptionPeriodEndMs(sub: Stripe.Subscription): number | null {
  const view = asSubscriptionPeriodView(sub);
  return (
    secondsToMs(view.current_period_end) ??
    minTimestamp((view.items?.data ?? []).map((item) => secondsToMs(item.current_period_end)))
  );
}

function isSubscriptionInvoiceLine(line: InvoiceLinePeriodView): boolean {
  return Boolean(
    line.parent?.subscription_item_details ||
      line.subscription_item ||
      line.type === "subscription" ||
      line.price?.recurring,
  );
}

export function invoiceSubscriptionPeriodEndMs(invoice: Stripe.Invoice): number | null {
  const view = invoice as unknown as InvoiceLinesView;
  const subscriptionLines = (view.lines?.data ?? []).filter(isSubscriptionInvoiceLine);
  return maxTimestamp(subscriptionLines.map((line) => secondsToMs(line.period?.end)));
}

export function isoFromMs(ms: number | null | undefined): string | null {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
