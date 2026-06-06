// Despublicar una generación de la galería pública (vuelve privada).
// POST /api/generations/[id]/unpublish — autenticado y solo el propietario.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { unpublishGeneration } from "@/lib/firestore/generations";
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
  if (!db) return NextResponse.json({ error: "Firebase Admin not configured." }, { status: 500 });

  const result = await unpublishGeneration(db, { id, uid: user.uid });
  if (!result.ok) {
    const status = result.reason === "NOT_FOUND" ? 404 : 403;
    return NextResponse.json({ error: "No se pudo despublicar la generación." }, { status });
  }
  return NextResponse.json({ ok: true, id });
}
