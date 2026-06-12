// Carga de miniaturas para el carrusel de la portada (compartido entre el SSR
// de la landing y el endpoint /api/gallery/marquee que sirve lotes extra).
// =============================================================================
// Muestra aleatoria de la galería pública: lee 48 para compensar el filtrado de
// verticales y resuelve los nombres de autor (deduplicados) desde `users`.
// =============================================================================

import type { Firestore } from "firebase-admin/firestore";
import type { MarqueeThumb } from "@/components/ui/PenguinThumbnailMarquee";
import { getRandomPublicGenerations, type GenerationWithId } from "@/lib/firestore/generations";

export async function loadMarqueeThumbs(
  db: Firestore,
  opts: { anonymousLabel?: string } = {},
): Promise<MarqueeThumb[]> {
  const gens: GenerationWithId[] = await getRandomPublicGenerations(db, { limit: 48 });
  const horizontalGens = gens.filter((g) => g.aspectRatio !== "9:16");

  // Nombre del autor: lo buscamos en la colección `users` (deduplicado).
  // (La foto del autor no se guarda aún; el modal usa avatar con inicial.)
  const userIds = [...new Set(horizontalGens.map((g) => g.userId).filter(Boolean))];
  const names = new Map<string, string>();
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const snap = await db.collection("users").doc(uid).get();
        const name = (snap.data() as { displayName?: string } | undefined)?.displayName;
        if (name) names.set(uid, name);
      } catch {
        /* ignore */
      }
    }),
  );

  return horizontalGens.map((g) => {
    const title = g.videoTitle?.trim() || undefined;
    return {
      id: g.id,
      imageUrl: g.imageUrl,
      title,
      prompt: title,
      contentPrompt: g.userPrompt,
      stylePrompt: g.stylePrompt,
      authorName: names.get(g.userId) ?? opts.anonymousLabel,
    };
  });
}
