// Galería pública de la comunidad (doc §6.2 + §6.5)
// =============================================================================
// Server Component (SSR): el grid de miniaturas públicas se renderiza en el HTML
// inicial para que Google lo indexe. Cada tarjeta enlaza a /gallery/[id].
// =============================================================================

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getPublicGenerations, type GenerationWithId } from "@/lib/firestore/generations";
import { generateAltText } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Galería de miniaturas de YouTube creadas por la comunidad",
  description:
    "Miniaturas de YouTube generadas con IA por la comunidad de MiniAItura. Explora estilos por nicho y úsalos en tus propias miniaturas.",
  alternates: { canonical: "/gallery" },
  openGraph: {
    title: "Galería de miniaturas de la comunidad | MiniAItura",
    description: "Explora miniaturas de YouTube generadas con IA por la comunidad.",
    type: "website",
  },
};

async function loadPublic(): Promise<GenerationWithId[]> {
  const db = adminFirestore();
  if (!db) return [];
  try {
    return await getPublicGenerations(db, { limit: 24, orderBy: "createdAt" });
  } catch {
    return [];
  }
}

export default async function PublicGalleryPage() {
  const items = await loadPublic();

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 md:px-8 md:py-12">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Galería de miniaturas creadas por la comunidad
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Miniaturas de YouTube generadas con IA. Haz clic para ver el estilo.
          </p>
        </div>
        <Link href="/" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
          App
        </Link>
      </header>

      {items.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--color-text-muted)]">
          Todavía no hay miniaturas públicas. ¡Sé el primero en publicar la tuya!
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
                        Estilo usado {gen.timesStyleCopied} veces
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
