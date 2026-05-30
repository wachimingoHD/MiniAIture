// Detalle de una generación (doc §6.3). GET público para páginas de galería.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getGenerationById } from "@/lib/firestore/generations";

export const runtime = "nodejs";

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

  // El prompt de estilo solo se expone si el estilo es propio (custom) — doc §6.3.
  const exposeStyle = gen.styleType === "custom";
  return NextResponse.json({
    ...gen,
    stylePrompt: exposeStyle ? gen.stylePrompt : null,
  });
}
