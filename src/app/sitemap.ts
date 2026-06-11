import type { MetadataRoute } from "next";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getAllPublicGenerationIds } from "@/lib/firestore/generations";
import { SITE_URL } from "@/lib/seo";
import { routing } from "@/i18n/routing";

export const runtime = "nodejs";
// Regenera el sitemap como máximo cada hora (ISR) en vez de en cada request.
export const revalidate = 3600;

const LOCALES = routing.locales;

// Construye el bloque alternates hreflang para una ruta dada (sin prefijo de
// locale). Indica a Google las variantes de idioma de la misma página.
function alternatesFor(path: string): MetadataRoute.Sitemap[number]["alternates"] {
  return {
    languages: Object.fromEntries(
      LOCALES.map((l) => [l, `${SITE_URL}/${l}${path}`]),
    ),
  };
}

// /sitemap.xml — páginas estáticas (×idioma) + una URL por miniatura pública
// (el activo SEO principal: cada miniatura publicada es una página indexable).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPaths: { path: string; priority: number; changeFrequency: "daily" | "monthly" }[] = [
    { path: "", priority: 1.0, changeFrequency: "daily" },
    { path: "/generate", priority: 0.9, changeFrequency: "monthly" },
    { path: "/gallery", priority: 0.9, changeFrequency: "daily" },
    { path: "/pricing", priority: 0.7, changeFrequency: "monthly" },
    { path: "/legal/legal-notice", priority: 0.2, changeFrequency: "monthly" },
    { path: "/legal/privacy", priority: 0.2, changeFrequency: "monthly" },
    { path: "/legal/terms", priority: 0.2, changeFrequency: "monthly" },
    { path: "/legal/cookies", priority: 0.2, changeFrequency: "monthly" },
  ];

  const staticPages: MetadataRoute.Sitemap = LOCALES.flatMap((locale) =>
    staticPaths.map(({ path, priority, changeFrequency }) => ({
      url: `${SITE_URL}/${locale}${path}`,
      priority,
      changeFrequency,
      alternates: alternatesFor(path),
    })),
  );

  const db = adminFirestore();
  if (!db) return staticPages;

  try {
    const gens = await getAllPublicGenerationIds(db, 5000);
    const galleryPages: MetadataRoute.Sitemap = gens.flatMap((g) =>
      LOCALES.map((locale) => ({
        url: `${SITE_URL}/${locale}/gallery/${g.id}`,
        lastModified: new Date(g.createdAt),
        priority: 0.6,
        changeFrequency: "weekly" as const,
        alternates: alternatesFor(`/gallery/${g.id}`),
      })),
    );
    return [...staticPages, ...galleryPages];
  } catch {
    // Si falta el índice o no hay credenciales, al menos las estáticas.
    return staticPages;
  }
}
