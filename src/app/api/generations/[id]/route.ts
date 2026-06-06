// Generación individual.
// - GET  (público): detalle SEGURO (DTO) de una generación pública.
// - DELETE (autenticado, propietario): borra la generación y su imagen.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { getGenerationById, deleteGeneration, toPublicDTO } from "@/lib/firestore/generations";
import { deleteGalleryImageByKey, storageKeyFromUrl } from "@/lib/storage/firebase-storage";
import { readBearerToken } from "@/lib/server/request";

export const runtime = "nodejs";

async function authorName(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<string | undefined> {
  try {
    const snap = await db.collection("users").doc(uid).get();
    const name = (snap.data() as { displayName?: string } | undefined)?.displayName;
    return name && name.trim() ? name : undefined;
  } catch {
    return undefined;
  }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const db = adminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin not configured." }, { status: 500 });
  }

  const gen = await getGenerationById(db, id);
  if (!gen || !gen.isPublic) {
    return NextResponse.json({ error: "Generation not found." }, { status: 404 });
  }

  // Solo campos públicos (nunca userId, enhancedPrompt, créditos, modo, etc.).
  return NextResponse.json(toPublicDTO(gen, await authorName(db, gen.userId)));
}

export async function DELETE(
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

  const result = await deleteGeneration(db, { id, uid: user.uid });
  if (!result.ok) {
    const status = result.reason === "NOT_FOUND" ? 404 : 403;
    return NextResponse.json({ error: "No se pudo borrar la generación." }, { status });
  }

  // Limpieza best-effort del objeto en Storage.
  if (result.imageUrl) {
    const key = storageKeyFromUrl(result.imageUrl);
    if (key) await deleteGalleryImageByKey(key);
  }

  return NextResponse.json({ ok: true, id });
}
