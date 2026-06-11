// Ejecución del borrado de cuenta (compartida entre el cron diario y, si algún
// día hace falta, herramientas de administración).
// =============================================================================
// El flujo de usuario es DIFERIDO: POST /api/user/delete solo marca
// `deletionScheduledAt` (~24h). Este módulo hace el borrado real:
//   1. Cancela la suscripción Stripe inmediatamente (si sigue viva).
//   2. Borra las imágenes de Storage (todo el prefijo users/{uid}/).
//   3. Borra sus documentos: generations, creditTransactions y users/{uid}.
//   4. Borra el usuario de Firebase Auth.
// El customer de Stripe NO se borra (las facturas deben conservarse por
// obligación fiscal), pero queda sin suscripción.
// =============================================================================

import type { App } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import type { Firestore, Query } from "firebase-admin/firestore";
import { deleteAuthUser } from "@/lib/auth/firebase-admin";
import { cancelSubscriptionImmediately } from "@/lib/stripe/client";
import { getFirebaseStorageConfig } from "@/lib/storage/firebase-storage";
import {
  CREDIT_TRANSACTIONS_COLLECTION,
  GENERATIONS_COLLECTION,
  USERS_COLLECTION,
  type UserDocument,
} from "@/lib/firestore/schema";
import { safeErrorMessage } from "@/lib/server/errors";

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

export interface ExecuteDeletionResult {
  ok: boolean;
  authDeleted: boolean;
  error?: string;
}

export async function executeAccountDeletion(
  db: Firestore,
  app: App,
  uid: string,
): Promise<ExecuteDeletionResult> {
  const userRef = db.collection(USERS_COLLECTION).doc(uid);
  const snap = await userRef.get();
  const userDoc = snap.exists ? (snap.data() as UserDocument) : null;

  // 1) Suscripción: cancelar YA en Stripe. Si Stripe falla, abortamos: el cron
  // reintentará mañana (el doc conserva su deletionScheduledAt vencido).
  // NO ajustamos aquí el contador de referidos: la cancelación dispara el
  // webhook subscription.deleted, que lo decrementa una sola vez a partir de
  // la metadata de la suscripción.
  if (userDoc?.stripeSubscriptionId && userDoc.subscriptionStatus !== "canceled") {
    try {
      await cancelSubscriptionImmediately(userDoc.stripeSubscriptionId);
    } catch (err) {
      return { ok: false, authDeleted: false, error: safeErrorMessage(err, "stripe_cancel_failed") };
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

  // 3) Documentos de Firestore. `usernames` incluido: sin esto, la reserva del
  // nombre público del usuario borrado quedaba huérfana y ese nombre quedaba
  // bloqueado para siempre.
  await deleteByQuery(db, db.collection(GENERATIONS_COLLECTION).where("userId", "==", uid));
  await deleteByQuery(db, db.collection(CREDIT_TRANSACTIONS_COLLECTION).where("userId", "==", uid));
  await deleteByQuery(db, db.collection("usernames").where("uid", "==", uid));
  await userRef.delete();

  // 4) Usuario de Firebase Auth (al final: si algo de arriba falla, el doc
  // sigue existiendo y el cron reintenta).
  const authDeleted = await deleteAuthUser(uid);

  return { ok: true, authDeleted };
}
