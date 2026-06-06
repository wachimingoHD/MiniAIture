import type { MetadataRoute } from "next";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getAllPublicGenerationIds } from "@/lib/firestore/generations";
import { SITE_URL } from "@/lib/seo";

export const runtime = "nodejs";
// Regenera el sitemap como máximo cada hora (ISR) en vez de en cada request.
export const revalidate = 3600;

// /sitemap.xml — páginas estáticas + una URL por miniatura pública (el activo
// SEO principal: cada miniatura publicada es una página indexable nueva).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, priority: 1.0, changeFrequency: "daily" },
    { url: `${SITE_URL}/gallery`, priority: 0.9, changeFrequency: "daily" },
    { url: `${SITE_URL}/pricing`, priority: 0.7, changeFrequency: "monthly" },
  ];

  const db = adminFirestore();
  if (!db) return staticPages;

  try {
    const gens = await getAllPublicGenerationIds(db, 5000);
    const galleryPages: MetadataRoute.Sitemap = gens.map((g) => ({
      url: `${SITE_URL}/gallery/${g.id}`,
      lastModified: new Date(g.createdAt),
      priority: 0.6,
      changeFrequency: "weekly",
    }));
    return [...staticPages, ...galleryPages];
  } catch {
    // Si falta el índice o no hay credenciales, al menos las estáticas.
    return staticPages;
  }
}
