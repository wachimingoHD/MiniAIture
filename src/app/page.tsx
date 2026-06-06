// Landing page (rediseño boceto) — tema claro beige, scrollable y minimalista.
// =============================================================================
// Server Component (SSR): hero centrado a pantalla completa + "Últimas
// generaciones públicas" mostradas por pingüinos que las cargan y se deslizan.
// Las miniaturas vienen de getPublicGenerations() (isPublic == true).
// =============================================================================

import Link from "next/link";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getPublicGenerations, type GenerationWithId } from "@/lib/firestore/generations";
import PenguinThumbnailMarquee, { type MarqueeThumb } from "@/components/ui/PenguinThumbnailMarquee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadPublicThumbs(): Promise<MarqueeThumb[]> {
  const db = adminFirestore();
  if (!db) return [];
  try {
    const gens: GenerationWithId[] = await getPublicGenerations(db, {
      limit: 24,
      orderBy: "timesStyleCopied",
    });

    // Nombre del autor: lo buscamos en la colección `users` (deduplicado).
    // (La foto del autor no se guarda aún; el modal usa avatar con inicial.)
    const userIds = [...new Set(gens.map((g) => g.userId).filter(Boolean))];
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

    return gens.map((g) => ({
      id: g.id,
      imageUrl: g.imageUrl,
      prompt: g.videoTitle ?? g.userPrompt,
      stylePrompt: g.stylePrompt,
      authorName: names.get(g.userId) ?? "Anónimo",
    }));
  } catch {
    return [];
  }
}

// Cuadros pastel decorativos del boceto (posición/tamaño/color/retardo).
type Square = { top: string; left?: string; right?: string; size: number; color: string; delay: string };
const SQUARES: Square[] = [
  { top: "14%", left: "7%", size: 120, color: "var(--color-pastel-purple)", delay: "0s" },
  { top: "24%", left: "19%", size: 150, color: "var(--color-pastel-teal)", delay: "1.2s" },
  { top: "52%", left: "4%", size: 110, color: "var(--color-pastel-yellow)", delay: "0.6s" },
  { top: "70%", left: "14%", size: 128, color: "var(--color-pastel-green)", delay: "1.8s" },
  { top: "16%", right: "16%", size: 138, color: "var(--color-pastel-purple)", delay: "0.9s" },
  { top: "34%", right: "6%", size: 150, color: "var(--color-pastel-blue)", delay: "1.5s" },
  { top: "60%", right: "12%", size: 120, color: "var(--color-pastel-pink)", delay: "0.3s" },
  { top: "74%", right: "4%", size: 110, color: "var(--color-pastel-green)", delay: "2.1s" },
];

export default async function LandingPage() {
  const thumbs = await loadPublicThumbs();

  return (
    <div className="relative">
      {/* Cuadros pastel flotantes (decorativos), confinados al hero. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-screen overflow-hidden" aria-hidden>
        {SQUARES.map((s, i) => (
          <div
            key={i}
            className="float-soft absolute rounded-3xl opacity-60"
            style={{
              top: s.top,
              left: s.left,
              right: s.right,
              width: s.size,
              height: s.size,
              background: s.color,
              animationDelay: s.delay,
            }}
          />
        ))}
      </div>

      <main>
        {/* HERO — ocupa casi toda la altura; deja asomar los pingüinos al deslizar. */}
        <section className="relative z-10 mx-auto flex min-h-[88vh] max-w-[1200px] flex-col items-center justify-center px-4 text-center md:px-8">
        <h1 className="font-display text-[clamp(2.25rem,10vw,8.5rem)] font-extrabold leading-[1.05] tracking-tight">
          Mini<span className="text-[var(--color-accent)]">AI</span>tura
        </h1>
        <p className="mt-5 max-w-xl text-lg text-[var(--color-text-secondary)] md:text-xl">
          Crea miniaturas de YouTube increíbles con IA. Describe tu vídeo y deja que las hagan por ti.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/generate"
            className="rounded-xl bg-[var(--color-accent)] px-6 py-3 font-semibold text-white shadow-lg shadow-[var(--color-accent)]/25 transition hover:-translate-y-0.5 hover:bg-[var(--color-accent-strong)]"
          >
            Crea tu miniatura gratis
          </Link>
          <Link
            href="/gallery"
            className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-panel)] px-6 py-3 font-semibold text-[var(--color-text-primary)] transition hover:-translate-y-0.5 hover:border-[var(--color-accent)]"
          >
            Explora la galería pública
          </Link>
        </div>
      </section>

      {/* ÚLTIMAS GENERACIONES PÚBLICAS — aparece al deslizar (reveal 100% CSS). */}
      <section className="on-scroll-rise relative z-10 pb-24 pt-6">
        <h2 className="mb-8 text-center text-sm font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
          Últimas generaciones de la comunidad
        </h2>
        <PenguinThumbnailMarquee items={thumbs} />
        </section>
      </main>
    </div>
  );
}
