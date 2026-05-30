// Galería personal del usuario (doc §5.1)
// =============================================================================
// GET /api/gallery?cursor=<createdAtIso>
//   - FREE: limitado a los últimos 30 (doc §5.2 opción A: el resto se conserva
//     en Firestore pero no se muestra).
//   - PRO: paginación por cursor (createdAt).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getOrCreateUserDocument } from "@/lib/firestore/users";
import { getUserGenerations } from "@/lib/firestore/generations";
import { readBearerToken } from "@/lib/server/request";

export const runtime = "nodejs";

const FREE_GALLERY_LIMIT = 30;
const PRO_PAGE_SIZE = 30;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = readBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });

  const user = await verifyIdToken(token);
  if (!user) return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });

  const db = adminFirestore();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin not configured. Set FIREBASE_ADMIN_CREDENTIALS." },
      { status: 500 },
    );
  }

  const doc = await getOrCreateUserDocument(db, { uid: user.uid, email: user.email, displayName: user.name });

  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const isPro = doc.plan === "pro";
  // FREE: tope duro de 30 sin paginación. PRO: páginas de 30 con cursor.
  const limit = isPro ? PRO_PAGE_SIZE : FREE_GALLERY_LIMIT;

  const items = await getUserGenerations(db, user.uid, {
    limit,
    startAfterCreatedAt: isPro ? cursor : undefined,
  });

  const nextCursor =
    isPro && items.length === PRO_PAGE_SIZE ? items[items.length - 1].createdAt : null;

  return NextResponse.json({
    plan: doc.plan,
    count: items.length,
    limited: !isPro,
    nextCursor,
    images: items,
  });
}
