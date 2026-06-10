// Galería pública de la comunidad (doc §6.2 + §6.5)
// =============================================================================
// Server Component (SSR): el grid de miniaturas públicas se renderiza en el HTML
// inicial para que Google lo indexe. Cada tarjeta enlaza a /gallery/[id].
// =============================================================================

import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getPublicGenerations, type GenerationWithId } from "@/lib/firestore/generations";
import { generateAltText } from "@/lib/seo";

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
    },
  };
}

async function loadPublic(): Promise<GenerationWithId[]> {
  const db = adminFirestore();
  if (!db) return [];
  try {
    return await getPublicGenerations(db, { limit: 24, orderBy: "createdAt" });
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

      {items.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--color-text-muted)]">
          {t("empty")}
        </p>
      ) : (
        <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((gen, i) => (
            <article
              key={gen.id}
              className="group overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] transition hover:border-[var(--color-accent)]"
            >
              <Link href={`/gallery/${gen.id}`}>
                <figure className="m-0">
                  <div className="relative aspect-video w-full">
                    <Image
                      src={gen.imageUrl}
                      alt={generateAltText(gen)}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      priority={i < 4}
                      className="object-cover"
                    />
                  </div>
                  <figcaption className="space-y-1 p-3">
                    <p className="line-clamp-2 text-xs text-[var(--color-text-secondary)]">{gen.userPrompt}</p>
                    {gen.styleType === "custom" && gen.timesStyleCopied > 0 && (
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        {t("styleUsedTimes", { count: gen.timesStyleCopied })}
                      </span>
                    )}
                  </figcaption>
                </figure>
              </Link>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
