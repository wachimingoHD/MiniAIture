// Colección `affiliates` (doc §1.4)
// =============================================================================
// Un documento por creador afiliado. El `code` es único y es el que otros
// usuarios introducen al registrarse para obtener descuento.
// =============================================================================

import { AFFILIATES_COLLECTION } from "./schema";

export const DEFAULT_AFFILIATE_DISCOUNT_PCT = 10;
export const DEFAULT_AFFILIATE_COMMISSION_PCT = 10;

export interface Affiliate {
  userId: string;
  code: string; // código único del creador
  discountPct: number; // 10
  commissionPct: number; // 10
  totalReferrals: number;
  totalEarned: number;
  stripeConnectId: string;
  createdAt: string; // ISO string
}

export function buildAffiliate(args: {
  userId: string;
  code: string;
  stripeConnectId?: string;
  discountPct?: number;
  commissionPct?: number;
}): Affiliate {
  return {
    userId: args.userId,
    code: args.code,
    discountPct: args.discountPct ?? DEFAULT_AFFILIATE_DISCOUNT_PCT,
    commissionPct: args.commissionPct ?? DEFAULT_AFFILIATE_COMMISSION_PCT,
    totalReferrals: 0,
    totalEarned: 0,
    stripeConnectId: args.stripeConnectId ?? "",
    createdAt: new Date().toISOString(),
  };
}

export { AFFILIATES_COLLECTION };
