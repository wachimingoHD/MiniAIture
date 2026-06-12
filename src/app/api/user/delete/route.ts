// Solicitud de borrado de cuenta (derecho de supresión RGPD) — DIFERIDA.
// POST /api/user/delete — autenticado. NO borra al instante: marca
// `deletionScheduledAt` (~24h) y cierra la sesión en el cliente. El cron
// diario /api/cron/process-account-deletions ejecuta los vencidos (Storage,
// Firestore, Stripe y Auth — ver src/lib/account-deletion.ts). Si la cuenta
// tiene una suscripción Stripe que todavía renueva, se rechaza: el usuario debe
// cancelar la renovación antes de programar el borrado.
//
// ¿Por qué diferido? Anti-abuso: borrar y recrear la cuenta al momento
// regalaba 100 créditos FREE frescos infinitas veces. Con ~24h de espera, el
// truco no aporta nada sobre el reset diario normal. Si el usuario inicia
// sesión durante la espera, la solicitud se cancela (getOrCreateUserDocument);
// al volver recupera su cuenta tal cual estaba, sin créditos nuevos.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import {
  ACCOUNT_DELETION_SUBSCRIPTION_REASON,
  hasRenewingStripeSubscription,
} from "@/lib/account-deletion-policy";
import { readBearerToken } from "@/lib/server/request";
import { USERS_COLLECTION, type UserDocument } from "@/lib/firestore/schema";

export const runtime = "nodejs";

const DELETION_DELAY_MS = 24 * 60 * 60 * 1000; // ~24h

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = readBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });

  const user = await verifyIdToken(token);
  if (!user) return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });

  const db = adminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin not configured." }, { status: 500 });
  }

  const scheduledAt = new Date(Date.now() + DELETION_DELAY_MS).toISOString();
  const userRef = db.collection(USERS_COLLECTION).doc(user.uid);

  // Transacción: la comprobación de la suscripción y la escritura del schedule
  // son ATÓMICAS. Sin esto, una reactivación de la suscripción desde otra
  // pestaña podía colarse entre la lectura y la escritura, dejando una sub que
  // renueva con un borrado programado (cobro dentro de la ventana de espera).
  let blocked = false;
  let missing = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) {
      missing = true;
      return;
    }
    if (hasRenewingStripeSubscription(snap.data() as UserDocument)) {
      blocked = true;
      return;
    }
    tx.update(userRef, { deletionScheduledAt: scheduledAt });
  });

  if (missing) {
    return NextResponse.json({ ok: true, scheduledAt, note: "no_user_doc" });
  }
  if (blocked) {
    return NextResponse.json(
      {
        error: "Cancela tu suscripción PRO antes de solicitar el borrado de la cuenta.",
        reason: ACCOUNT_DELETION_SUBSCRIPTION_REASON,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, scheduledAt });
}
