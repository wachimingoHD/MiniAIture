// Detalle público de una miniatura (doc §6.3 + §6.4)
// =============================================================================
// Server Component con SSR: metadata para SEO (title/description/og), HTML
// semántico (article/figure/figcaption) y datos estructurados JSON-LD.
// =============================================================================

import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getGenerationById, type GenerationWithId } from "@/lib/firestore/generations";
import { generateAltText } from "@/lib/seo";
import UseInGenerator from "./use-in-generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadPublicGeneration(id: string): Promise<GenerationWithId | null> {
  const db = adminFirestore();
  if (!db) return null;
  const gen = await getGenerationById(db, id);
  if (!gen || !gen.isPublic) return null;
  return gen;
}

async function loadAuthorName(userId: string): Promise<string> {
  const db = adminFirestore();
  if (!db) return "MiniAItura";
  try {
    const snap = await db.collection("users").doc(userId).get();
    const name = (snap.data() as { displayName?: string } | undefined)?.displayName;
    return name && name.trim().length > 0 ? name : "MiniAItura";
  } catch {
    return "MiniAItura";
  }
}

function shortText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; generationId: string }>;
}): Promise<Metadata> {
  const { locale, generationId } = await params;
  const t = await getTranslations({ locale, namespace: "galleryDetail.meta" });
  const gen = await loadPublicGeneration(generationId);
  if (!gen) return { title: t("notFound") };

  const desc = shortText(gen.userPrompt, 150);
  const title = gen.nicho
    ? t("titleWithNiche", { nicho: gen.nicho, prompt: shortText(gen.userPrompt, 55) })
    : t("title", { prompt: shortText(gen.userPrompt, 55) });
  return {
    title,
    description: t("description", { desc }),
    alternates: {
      canonical: `/${locale}/gallery/${generationId}`,
      languages: {
        en: `/en/gallery/${generationId}`,
        es: `/es/gallery/${generationId}`,
        "x-default": `/en/gallery/${generationId}`,
      },
    },
    openGraph: {
      title,
      description: desc,
      images: [{ url: gen.imageUrl, width: 1280, height: 720 }],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      images: [gen.imageUrl],
    },
  };
}

export default async function GenerationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; generationId: string }>;
}) {
  const { locale, generationId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("galleryDetail");
  const gen = await loadPublicGeneration(generationId);
  if (!gen) notFound();

  const authorName = await loadAuthorName(gen.userId);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ImageObject",
    contentUrl: gen.imageUrl,
    name: shortText(gen.userPrompt, 80),
    description: gen.userPrompt,
    dateCreated: gen.createdAt,
    creator: { "@type": "Person", name: authorName },
  };

  return (
    <main className="mx-auto max-w-[1000px] px-4 py-8 md:px-8 md:py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav className="mb-6 text-sm text-[var(--color-text-secondary)]">
        <Link href="/gallery" className="hover:text-[var(--color-accent)]">
          {t("backToGallery")}
        </Link>
      </nav>

      <article className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <figure className="m-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
          <div className="relative aspect-video w-full">
            <Image
              src={gen.imageUrl}
              alt={generateAltText(gen)}
              fill
              sizes="(max-width: 1024px) 100vw, 640px"
              priority
              className="object-cover"
            />
          </div>
          <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-3">
            <UseInGenerator generationId={gen.id} content={gen.userPrompt} style={gen.stylePrompt || null} />
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--color-text-muted)]">
              {gen.nicho && <span>{t("niche", { nicho: gen.nicho })}</span>}
              <span>{t("styleUsedTimes", { count: gen.timesStyleCopied })}</span>
            </div>
          </div>
        </figure>

        <aside className="space-y-4 text-sm">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{shortText(gen.userPrompt, 80)}</h1>
            <p className="mt-1 text-[var(--color-text-muted)]">{t("byAuthor", { author: authorName })}</p>
          </div>

          {/* Contenido (qué aparece en la miniatura) */}
          {gen.userPrompt && (
            <div>
              <p className="mb-1 font-medium text-[var(--color-text-primary)]">{t("content")}</p>
              <p className="whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-2 text-[var(--color-text-secondary)]">
                {gen.userPrompt}
              </p>
            </div>
          )}

          {/* Estilo (el look) */}
          {gen.stylePrompt && (
            <div>
              <p className="mb-1 font-medium text-[var(--color-text-primary)]">{t("style")}</p>
              <p className="whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-2 text-[var(--color-text-secondary)]">
                {gen.stylePrompt}
              </p>
            </div>
          )}

        </aside>
      </article>
    </main>
  );
}
