// Galería pública (doc §6.2). No requiere autenticación.
// GET /api/gallery/public?cursor=<createdAtIso>&sort=recent|popular&nicho=...
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { getClientIp } from "@/lib/server/request";
import { checkIpThrottle } from "@/lib/server/ip-throttle";
import {
  getPublicGenerations,
  getRandomPublicGenerations,
  toPublicDTO,
} from "@/lib/firestore/generations";

export const runtime = "nodejs";

const PAGE_SIZE = 24;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Anti-abuso: >300 peticiones en 10 min desde la misma IP → bloqueo 1 hora.
  const ip = getClientIp(req, getRuntimeConfig().security.trustedProxyHeader);
  if (!checkIpThrottle(ip).ok) {
    return NextResponse.json(
      { error: "Too many requests. Try again later.", reason: "rate_limited" },
      { status: 429 },
    );
  }

  const db = adminFirestore();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin not configured. Set FIREBASE_ADMIN_CREDENTIALS." },
      { status: 500 },
    );
  }

  const sortParam = req.nextUrl.searchParams.get("sort");
  const sort = sortParam === "popular" ? "popular" : sortParam === "random" ? "random" : "recent";
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const nicho = req.nextUrl.searchParams.get("nicho");

  let items;
  try {
    items =
      sort === "random"
        ? await getRandomPublicGenerations(db, { limit: PAGE_SIZE })
        : await getPublicGenerations(db, {
            limit: PAGE_SIZE,
            startAfterCreatedAt: sort === "recent" ? cursor : undefined,
            orderBy: sort === "popular" ? "timesStyleCopied" : "createdAt",
          });
  } catch (err) {
    // Falta el índice compuesto de Firestore: degradar a vacío en vez de 500.
    const needsIndex = String((err as Error).message).includes("FAILED_PRECONDITION");
    console.warn("getPublicGenerations falló:", (err as Error).message);
    return NextResponse.json(
      { count: 0, nextCursor: null, images: [], error: needsIndex ? "index_required" : "query_failed" },
      { status: 200 },
    );
  }

  // Filtro por nicho en memoria (la query principal ya usa el índice de isPublic).
  const filtered = nicho ? items.filter((g) => g.nicho === nicho) : items;

  const nextCursor =
    sort === "recent" && items.length === PAGE_SIZE ? items[items.length - 1].createdAt : null;

  // DTO público: nunca exponemos userId, enhancedPrompt, créditos, etc.
  const res = NextResponse.json({
    count: filtered.length,
    nextCursor,
    images: filtered.map((g) => toPublicDTO(g)),
  });
  // Recent/popular se cachean en el CDN (refrescos repetidos = 0 lecturas de
  // Firestore). Random no: cada petición debe ser distinta.
  if (sort !== "random") {
    res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  }
  return res;
}
