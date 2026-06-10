// Códigos de creador y libro de comisiones (colecciones `affiliates` y
// `affiliateCommissions`).
// =============================================================================
// Un doc por creador en `affiliates`, con id = CÓDIGO en MAYÚSCULAS. El código
// vincula: el Promotion Code de Stripe (descuento real al comprador) + el % de
// comisión del creador. El usuario lo introduce en NUESTRA página de pricing;
// el checkout lo valida aquí y aplica el descuento. La atribución viaja en la
// metadata de la suscripción y cada factura pagada escribe un asiento
// idempotente en `affiliateCommissions` para liquidar a los creadores.
// =============================================================================

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  AFFILIATES_COLLECTION,
  AFFILIATE_COMMISSIONS_COLLECTION,
} from "./schema";

export const DEFAULT_AFFILIATE_DISCOUNT_PCT = 10;
export const DEFAULT_AFFILIATE_COMMISSION_PCT = 10;

// Doc de `affiliates`. El id del documento ES el código (en mayúsculas).
export interface Affiliate {
  code: string; // redundante con el id, para queries y legibilidad
  creatorName: string; // nombre visible del creador (liquidaciones/soporte)
  stripePromotionCodeId: string; // promo_... de Stripe que aplica el descuento
  commissionPct: number; // % recurrente sobre lo pagado (default 10)
  active: boolean; // permite desactivar sin borrar
  userId?: string; // uid del creador si además es usuario de la app
  stripeConnectId?: string; // reservado para payouts automáticos futuros
  createdAt: string; // ISO string
}

export function buildAffiliate(args: {
  code: string;
  creatorName: string;
  stripePromotionCodeId: string;
  commissionPct?: number;
  userId?: string;
}): Affiliate {
  return {
    code: args.code,
    creatorName: args.creatorName,
    stripePromotionCodeId: args.stripePromotionCodeId,
    commissionPct: args.commissionPct ?? DEFAULT_AFFILIATE_COMMISSION_PCT,
    active: true,
    userId: args.userId,
    createdAt: new Date().toISOString(),
  };
}

// Códigos case-insensitive y solo letras/números/guiones (Stripe no admite
// "_" en promotion codes), 2-64 chars. Devuelve null si no tiene forma válida
// (no consultamos Firestore con basura arbitraria).
export function normalizeAffiliateCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,64}$/.test(code)) return null;
  return code;
}

export async function getActiveAffiliate(
  db: Firestore,
  code: string,
): Promise<Affiliate | null> {
  const snap = await db.collection(AFFILIATES_COLLECTION).doc(code).get();
  if (!snap.exists) return null;
  const doc = snap.data() as Affiliate;
  if (!doc.active) return null;
  return doc;
}

// Asiento de comisión por factura pagada. Idempotente: el id del doc es el id
// de la factura de Stripe y `create()` falla si ya existe, así los reintentos
// del webhook no duplican comisiones.
export async function recordAffiliateCommission(db: Firestore, args: {
  code: string;
  uid: string;
  invoiceId: string;
  amountPaidMinor: number; // céntimos cobrados al cliente (IVA incluido)
  currency: string;
}): Promise<void> {
  const affiliate = await db.collection(AFFILIATES_COLLECTION).doc(args.code).get();
  if (!affiliate.exists) return; // código borrado: no hay a quién liquidar
  const pct = (affiliate.data() as Affiliate).commissionPct ?? DEFAULT_AFFILIATE_COMMISSION_PCT;

  try {
    await db
      .collection(AFFILIATE_COMMISSIONS_COLLECTION)
      .doc(args.invoiceId)
      .create({
        code: args.code,
        uid: args.uid,
        invoiceId: args.invoiceId,
        amountPaidMinor: args.amountPaidMinor,
        commissionMinor: Math.round((args.amountPaidMinor * pct) / 100),
        commissionPct: pct,
        currency: args.currency,
        paidOut: false, // marcar true al liquidar al creador
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch {
    // Ya registrada (reintento de webhook): nada que hacer.
  }
}

export { AFFILIATES_COLLECTION, AFFILIATE_COMMISSIONS_COLLECTION };
