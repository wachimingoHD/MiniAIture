// Publicar una generación en la galería pública (doc §6.1).
// POST /api/generations/[id]/publish  — solo PRO y solo el propietario.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getOrCreateUserDocument } from "@/lib/firestore/users";
import { publishGeneration } from "@/lib/firestore/generations";
import { readBearerToken } from "@/lib/server/request";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const token = readBearerToken(req);
  if (!token) return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });

  const user = await verifyIdToken(token);
  if (!user) return NextResponse.json({ error: "Invalid or expired auth token." }, { status: 401 });

  const db = adminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin not configured." }, { status: 500 });
  }

  // Publicar es exclusivo de PRO (doc §6.1).
  const userDoc = await getOrCreateUserDocument(db, { uid: user.uid, email: user.email, displayName: user.name });
  if (userDoc.plan !== "pro") {
    return NextResponse.json({ error: "Publicar en galería es solo para usuarios Pro." }, { status: 403 });
  }

  const result = await publishGeneration(db, { id, uid: user.uid });
  if (!result.ok) {
    if (result.reason === "NOT_FOUND") {
      return NextResponse.json({ error: "Generación no encontrada." }, { status: 404 });
    }
    return NextResponse.json({ error: "No puedes publicar esta generación." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, id });
}
