// Cron diario: ejecuta los borrados de cuenta programados ya vencidos.
// =============================================================================
// Las solicitudes las crea POST /api/user/delete (marca deletionScheduledAt a
// ~24h); iniciar sesión durante la espera cancela la solicitud. Aquí se hace
// el borrado real de los docs cuyo deletionScheduledAt ya pasó.
//
// Protegido con CRON_SECRET, igual que cleanup-rate-limits (Vercel envía
// `Authorization: Bearer <CRON_SECRET>`).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, getAdminApp } from "@/lib/auth/firebase-admin";
import { executeAccountDeletion } from "@/lib/account-deletion";
import { USERS_COLLECTION } from "@/lib/firestore/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

// Tope por ejecución para no agotar maxDuration (el resto cae mañana).
const MAX_DELETIONS_PER_RUN = 50;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const db = adminFirestore();
  const app = getAdminApp();
  if (!db || !app) {
    return NextResponse.json(
      { error: "Firebase Admin not configured. Set FIREBASE_ADMIN_CREDENTIALS." },
      { status: 500 },
    );
  }

  const nowIso = new Date().toISOString();
  const due = await db
    .collection(USERS_COLLECTION)
    .where("deletionScheduledAt", "<=", nowIso)
    .limit(MAX_DELETIONS_PER_RUN)
    .get();

  let deleted = 0;
  const failures: string[] = [];
  for (const doc of due.docs) {
    const result = await executeAccountDeletion(db, app, doc.id);
    if (result.ok) {
      deleted += 1;
    } else {
      // p. ej. Stripe caído: el doc conserva su deletionScheduledAt vencido y
      // el cron de mañana lo reintenta.
      failures.push(`${doc.id}: ${result.error ?? "unknown"}`);
    }
  }

  if (failures.length > 0) {
    console.warn("process-account-deletions con fallos:", failures);
  }
  return NextResponse.json({ ok: true, due: due.size, deleted, failed: failures.length, ranAt: nowIso });
}
