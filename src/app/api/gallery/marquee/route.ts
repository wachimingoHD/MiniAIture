// Lotes extra para el carrusel de la portada. No requiere autenticación.
// GET /api/gallery/marquee → ~24-48 miniaturas públicas aleatorias en el
// formato del carrusel. El cliente lo llama SOLO cuando una fila completa una
// vuelta entera (máx. 3 veces por visita), así los visitantes que rebotan no
// generan lecturas extra.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { getClientIp } from "@/lib/server/request";
import { checkIpThrottle } from "@/lib/server/ip-throttle";
import { loadMarqueeThumbs } from "@/lib/server/marquee-thumbs";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req, getRuntimeConfig().security.trustedProxyHeader);
  if (!checkIpThrottle(ip).ok) {
    return NextResponse.json(
      { error: "Too many requests. Try again later.", reason: "rate_limited" },
      { status: 429 },
    );
  }

  const db = adminFirestore();
  if (!db) {
    return NextResponse.json({ items: [] });
  }

  try {
    // El nombre de "anónimo" localizado lo pone el cliente; aquí va sin él.
    const items = await loadMarqueeThumbs(db);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
