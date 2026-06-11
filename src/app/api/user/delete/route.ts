// Borrado de cuenta (derecho de supresión RGPD).
// POST /api/user/delete — autenticado; borra TODO lo del usuario:
//   1. Cancela la suscripción Stripe inmediatamente (si la hay): no puede
//      quedar una suscripción facturando a una cuenta que ya no existe.
//   2. Borra sus imágenes de Storage (todo el prefijo users/{uid}/).
//   3. Borra sus documentos: generations, creditTransactions y users/{uid}.
//   4. Borra el usuario de Firebase Auth.
// El customer de Stripe NO se borra (las facturas deben conservarse por
// obligación fiscal), pero queda sin suscripción.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "firebase-admin/storage";
import type { Firestore, Query } from "firebase-admin/firestore";
import {
  adminFirestore,
  deleteAuthUser,
  getAdminApp,
  verifyIdToken,
} from "@/lib/auth/firebase-admin";
import { readBearerToken } from "@/lib/server/request";
import { cancelSubscriptionImmediately } from "@/lib/stripe/client";
import { adjustActiveReferrals } from "@/lib/firestore/affiliates";
import { getFirebaseStorageConfig } from "@/lib/storage/firebase-storage";
import {
  CREDIT_TRANSACTIONS_COLLECTION,
  GENERATIONS_COLLECTION,
  USERS_COLLECTION,
  type UserDocument,
} from "@/lib/firestore/schema";
import { safeErrorMessage } from "@/lib/server/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

// Borra en lotes todos los docs que devuelva la query (máx. 500 por batch).
async function deleteByQuery(db: Firestore, query: Query): Promise<number> {
  let total = 0;
  for (;;) {
    const snap = await query.limit(400).get();
    if (snap.empty) return total;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    if (snap.size < 400) return total;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = readBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });

  const user = await verifyIdToken(token);
  if (!user) return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });

  const db = adminFirestore();
  const app = getAdminApp();
  if (!db || !app) {
    return NextResponse.json({ error: "Firebase Admin not configured." }, { status: 500 });
  }

  const uid = user.uid;
  const userRef = db.collection(USERS_COLLECTION).doc(uid);
  const snap = await userRef.get();
  const userDoc = snap.exists ? (snap.data() as UserDocument) : null;

  // 1) Suscripción: cancelar YA en Stripe. Si Stripe falla (caído, clave mal),
  // abortamos: mejor que el usuario reintente a dejar una suscripción huérfana.
  if (userDoc?.stripeSubscriptionId && userDoc.subscriptionStatus !== "canceled") {
    try {
      await cancelSubscriptionImmediately(userDoc.stripeSubscriptionId);
    } catch (err) {
      return NextResponse.json(
        {
          error: "No se pudo cancelar la suscripción. Inténtalo de nuevo en unos minutos.",
          detail: safeErrorMessage(err, "stripe_cancel_failed"),
        },
        { status: 502 },
      );
    }
    // El usuario deja de contar como referido activo de su creador. Se hace
    // aquí (y el webhook subscription.deleted ya no lo hará: el doc del
    // usuario habrá desaparecido cuando llegue).
    const referredBy = userDoc.affiliate?.referredBy?.trim().toUpperCase();
    if (referredBy) {
      await adjustActiveReferrals(db, referredBy, -1).catch(() => {});
    }
  }

  // 2) Imágenes de Storage (todas las del usuario cuelgan de users/{uid}/).
  const storageCfg = getFirebaseStorageConfig();
  if (storageCfg) {
    try {
      await getStorage(app)
        .bucket(storageCfg.bucketName)
        .deleteFiles({ prefix: `users/${uid}/`, force: true });
    } catch (err) {
      console.warn("Borrado de Storage incompleto para", uid, safeErrorMessage(err, "storage"));
    }
  }

  // 3) Documentos de Firestore.
  await deleteByQuery(db, db.collection(GENERATIONS_COLLECTION).where("userId", "==", uid));
  await deleteByQuery(db, db.collection(CREDIT_TRANSACTIONS_COLLECTION).where("userId", "==", uid));
  await userRef.delete();

  // 4) Usuario de Firebase Auth (al final: si algo de arriba falla, el usuario
  // aún puede reintentar logueado).
  const authDeleted = await deleteAuthUser(uid);

  return NextResponse.json({ ok: true, authDeleted });
}
