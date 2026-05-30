// Registrar uso de un estilo de galería (doc §6.3).
// POST /api/generations/[id]/use-style — incrementa timesStyleCopied.
// Solo aplica a estilos custom públicos (los presets/ajenos no comparten prompt).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getGenerationById, incrementTimesStyleCopied } from "@/lib/firestore/generations";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const db = adminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin not configured." }, { status: 500 });
  }

  const gen = await getGenerationById(db, id);
  if (!gen || !gen.isPublic || gen.styleType !== "custom") {
    return NextResponse.json({ error: "Estilo no disponible." }, { status: 404 });
  }

  await incrementTimesStyleCopied(db, id);
  return NextResponse.json({ ok: true, stylePrompt: gen.stylePrompt, styleId: id });
}
