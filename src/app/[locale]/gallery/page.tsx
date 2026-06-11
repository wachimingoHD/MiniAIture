// Galería pública de la comunidad (doc §6.2 + §6.5)
// =============================================================================
// Server Component (SSR): el grid de miniaturas públicas se renderiza en el HTML
// inicial para que Google lo indexe. Cada tarjeta enlaza a /gallery/[id].
// =============================================================================

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import {
  getRandomPublicGenerations,
  toPublicDTO,
  type GenerationWithId,
} from "@/lib/firestore/generations";
import GalleryExplorer, { type ExplorerItem } from "./GalleryExplorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "galleryPublic.meta" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `/${locale}/gallery`,
      languages: { en: "/en/gallery", es: "/es/gallery", "x-default": "/en/gallery" },
    },
    openGraph: {
      title: t("ogTitle"),
      description: t("ogDescription"),
      type: "website",
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
  };
}

// Primera página en ALEATORIO (el modo por defecto del explorador): cada
// visita a la galería muestra una muestra distinta de toda la comunidad.
async function loadPublic(): Promise<GenerationWithId[]> {
  const db = adminFirestore();
  if (!db) return [];
  try {
    return await getRandomPublicGenerations(db, { limit: 24 });
  } catch {
    return [];
  }
}

export default async function PublicGalleryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("galleryPublic");
  const items = await loadPublic();

  // Al cliente solo viajan los campos del DTO público (los props de un client
  // component se serializan en el HTML: nunca pasar userId/enhancedPrompt).
  const initial: ExplorerItem[] = items.map((g) => {
    const dto = toPublicDTO(g);
    return {
      id: dto.id,
      imageUrl: dto.imageUrl,
      userPrompt: dto.userPrompt,
      styleType: dto.styleType,
      nicho: dto.nicho,
      timesStyleCopied: dto.timesStyleCopied,
      createdAt: dto.createdAt,
    };
  });
  const initialCursor = items.length === 24 ? items[items.length - 1].createdAt : null;

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 md:px-8 md:py-12">
      <div className="mt-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {t("subtitle")}
        </p>
      </div>

      <GalleryExplorer initial={initial} initialCursor={initialCursor} />
    </main>
  );
}
