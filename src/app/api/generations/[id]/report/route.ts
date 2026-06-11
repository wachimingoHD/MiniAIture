// Reportar una miniatura pública (moderación reactiva).
// POST /api/generations/[id]/report — público (sin auth): cualquier visitante
// puede señalar contenido inapropiado. Protegido por el throttle de IP en
// memoria (mismo que la galería pública) y por validación de que la
// generación existe y es pública. Los reportes se acumulan en la colección
// `generation_reports` para revisión manual.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getGenerationById } from "@/lib/firestore/generations";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { getClientIp } from "@/lib/server/request";
import { checkIpThrottle } from "@/lib/server/ip-throttle";

export const runtime = "nodejs";

const MAX_REASON_LENGTH = 500;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;

  const cfg = getRuntimeConfig();
  const ip = getClientIp(req, cfg.security.trustedProxyHeader);
  if (!checkIpThrottle(`report:${ip}`).ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let reason = "";
  try {
    const body = (await req.json()) as { reason?: unknown };
    if (typeof body.reason === "string") reason = body.reason.trim().slice(0, MAX_REASON_LENGTH);
  } catch {
    // Cuerpo vacío o inválido: se acepta el reporte sin motivo.
  }

  const db = adminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin not configured." }, { status: 500 });
  }

  const gen = await getGenerationById(db, id);
  if (!gen || !gen.isPublic) {
    return NextResponse.json({ error: "Generation not found." }, { status: 404 });
  }

  await db.collection("generation_reports").add({
    generationId: id,
    ownerUserId: gen.userId,
    imageUrl: gen.imageUrl,
    reason: reason || null,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true });
}
