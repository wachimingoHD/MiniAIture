// Detalle público de una miniatura (doc §6.3 + §6.4)
// =============================================================================
// Server Component con SSR: metadata para SEO (title/description/og), HTML
// semántico (article/figure/figcaption) y datos estructurados JSON-LD.
// =============================================================================

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getGenerationById, type GenerationWithId } from "@/lib/firestore/generations";
import UseStyleButton from "./use-style-button";

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
  params: Promise<{ generationId: string }>;
}): Promise<Metadata> {
  const { generationId } = await params;
  const gen = await loadPublicGeneration(generationId);
  if (!gen) return { title: "Miniatura no encontrada | MiniAItura Gallery" };

  const desc = shortText(gen.userPrompt, 150);
  return {
    title: `${shortText(gen.userPrompt, 60)} | MiniAItura Gallery`,
    description: `AI-generated YouTube thumbnail: ${desc}`,
    openGraph: {
      title: shortText(gen.userPrompt, 60),
      description: desc,
      images: [{ url: gen.imageUrl }],
      type: "article",
    },
  };
}

export default async function GenerationDetailPage({
  params,
}: {
  params: Promise<{ generationId: string }>;
}) {
  const { generationId } = await params;
  const gen = await loadPublicGeneration(generationId);
  if (!gen) notFound();

  const authorName = await loadAuthorName(gen.userId);
  const isCustom = gen.styleType === "custom";

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
          ← Galería de la comunidad
        </Link>
      </nav>

      <article className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <figure className="m-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={gen.imageUrl}
            alt={shortText(gen.userPrompt, 120)}
            loading="lazy"
            className="aspect-video w-full object-cover"
          />
          <figcaption className="p-3 text-sm text-[var(--color-text-secondary)]">
            {isCustom && gen.stylePrompt ? gen.stylePrompt : shortText(gen.userPrompt, 160)}
          </figcaption>
        </figure>

        <aside className="space-y-4 text-sm">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{shortText(gen.userPrompt, 80)}</h1>
            {isCustom && (
              <p className="mt-1 text-[var(--color-text-muted)]">Estilo por: @{authorName}</p>
            )}
          </div>

          {isCustom && gen.stylePrompt && (
            <div>
              <p className="mb-1 font-medium text-[var(--color-text-primary)]">Prompt de estilo</p>
              <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-2 text-[var(--color-text-secondary)]">
                {gen.stylePrompt}
              </p>
            </div>
          )}

          {gen.nicho && (
            <p className="text-[var(--color-text-muted)]">Nicho: {gen.nicho}</p>
          )}

          <p className="text-[var(--color-text-muted)]">
            Este estilo ha sido usado {gen.timesStyleCopied} veces
          </p>

          {isCustom && <UseStyleButton generationId={gen.id} />}
        </aside>
      </article>
    </main>
  );
}
