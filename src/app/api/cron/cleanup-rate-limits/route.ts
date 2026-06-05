// Cron de limpieza de rateLimits (doc §1.5)
// =============================================================================
// Equivalente en arquitectura Next.js/Vercel a la "Cloud Function programada"
// del documento: borra los documentos de `rateLimits` cuyo `expiresAt < now()`.
//
// Se ejecuta vía Vercel Cron (ver vercel.json). Protegido con CRON_SECRET:
// Vercel envía `Authorization: Bearer <CRON_SECRET>` en las invocaciones cron.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { RATE_LIMITS_COLLECTION } from "@/lib/firestore/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 400;

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
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin not configured. Set FIREBASE_ADMIN_CREDENTIALS." },
      { status: 500 },
    );
  }

  const nowIso = new Date().toISOString();
  let totalDeleted = 0;

  // Borrado por lotes para no exceder límites de batch de Firestore.
  for (;;) {
    const snap = await db
      .collection(RATE_LIMITS_COLLECTION)
      .where("expiresAt", "<", nowIso)
      .limit(BATCH_SIZE)
      .get();

    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    totalDeleted += snap.size;

    if (snap.size < BATCH_SIZE) break;
  }

  return NextResponse.json({ ok: true, deleted: totalDeleted, ranAt: nowIso });
}
