// Landing page (doc rediseño §Página 1)
// =============================================================================
// Server Component (SSR): el visitante entiende qué hace MiniAItura en <3s y ve
// prueba real (miniaturas de la comunidad en el HTML inicial, indexable).
// =============================================================================

import Link from "next/link";
import { adminFirestore } from "@/lib/auth/firebase-admin";
import { getPublicGenerations, type GenerationWithId } from "@/lib/firestore/generations";
import Mascot from "@/components/mascots/Mascot";
import RevealOnScroll from "@/components/RevealOnScroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadCommunity(): Promise<GenerationWithId[]> {
  const db = adminFirestore();
  if (!db) return [];
  try {
    return await getPublicGenerations(db, { limit: 20, orderBy: "timesStyleCopied" });
  } catch {
    return [];
  }
}

const STEPS = [
  { color: "pink" as const, title: "Describe tu vídeo", text: "Cuéntale a la IA de qué trata tu vídeo y qué quieres mostrar." },
  { color: "blue" as const, title: "Elige un estilo", text: "Presets por nicho, tu estilo propio o uno de la comunidad." },
  { color: "green" as const, title: "La IA genera", text: "En segundos tienes una miniatura optimizada para conseguir clics." },
  { color: "yellow" as const, title: "Publica y comparte", text: "Descárgala y, si quieres, compártela en la galería pública." },
];

export default async function LandingPage() {
  const community = await loadCommunity();
  const heroExamples = community.slice(0, 3);
  // Pista doble para un marquee sin costuras.
  const carousel = community.length > 0 ? [...community, ...community] : [];

  return (
    <div className="min-h-screen">
      {/* NAV */}
      <nav className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg-base)]/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-4 py-3 md:px-8">
          <Link href="/" className="font-display text-xl font-extrabold">
            Mini<span className="logo-ai">AI</span>tura
          </Link>
          <div className="flex items-center gap-3 text-sm md:gap-5">
            <Link href="/gallery" className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">Galería</Link>
            <Link href="/pricing" className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">Precios</Link>
            <Link
              href="/generate"
              className="rounded-lg bg-[var(--color-accent)] px-3.5 py-2 font-semibold text-white transition hover:bg-[var(--color-accent-strong)] hover:-translate-y-0.5"
            >
              Crear gratis
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-[1200px] px-4 md:px-8">
        {/* HERO */}
        <section className="grid items-center gap-10 py-14 md:grid-cols-2 md:py-20">
          <div>
            <h1 className="rise-in font-display text-4xl font-extrabold leading-[1.1] md:text-6xl">
              Crea miniaturas de YouTube que{" "}
              <span className="text-[var(--color-accent)]">consiguen clics</span>
            </h1>
            <p className="rise-in mt-5 max-w-md text-lg text-[var(--color-text-secondary)]" style={{ animationDelay: "0.1s" }}>
              Describe tu vídeo y nuestra IA genera la miniatura perfecta para tu nicho. Sin saber diseñar.
            </p>
            <div className="rise-in mt-8 flex flex-wrap gap-3" style={{ animationDelay: "0.2s" }}>
              <Link
                href="/generate"
                className="rounded-xl bg-[var(--color-accent)] px-6 py-3 font-semibold text-white shadow-lg shadow-[var(--color-accent)]/25 transition hover:-translate-y-0.5 hover:bg-[var(--color-accent-strong)]"
              >
                Crear miniatura gratis
              </Link>
              <Link
                href="/gallery"
                className="rounded-xl border border-[var(--color-border-strong)] px-6 py-3 font-semibold text-[var(--color-text-primary)] transition hover:border-[var(--color-accent)]"
              >
                Ver galería
              </Link>
            </div>
          </div>

          {/* 3 ejemplos */}
          <div className="grid grid-cols-3 gap-3">
            {heroExamples.length > 0
              ? heroExamples.map((g, i) => (
                  <Link
                    key={g.id}
                    href={`/gallery/${g.id}`}
                    className="rise-in group overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] transition hover:-translate-y-1 hover:border-[var(--color-accent)] hover:shadow-xl"
                    style={{ animationDelay: `${0.15 + i * 0.1}s` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={g.imageUrl} alt={g.userPrompt.slice(0, 80)} className="aspect-[9/16] w-full object-cover md:aspect-video" />
                  </Link>
                ))
              : [0, 1, 2].map((i) => (
                  // Placeholder: sustituir por miniaturas reales de ejemplo.
                  <div
                    key={i}
                    className="rise-in aspect-video rounded-xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-accent)]/25 to-[var(--color-accent-2)]/20"
                    style={{ animationDelay: `${0.15 + i * 0.1}s` }}
                  />
                ))}
          </div>
        </section>

        {/* CARRUSEL COMUNIDAD */}
        <section className="py-12">
          <h2 className="text-center font-display text-2xl font-bold md:text-3xl">Creado por nuestra comunidad</h2>
          {carousel.length > 0 ? (
            <div className="marquee-paused relative mt-8 overflow-hidden">
              {/* Mascotas en los extremos, "empujando" las miniaturas */}
              <div className="pointer-events-none absolute left-0 top-1/2 z-10 -translate-y-1/2">
                <Mascot color="green" size={44} className="mascot-bob" title="Mascota cargando miniaturas" />
              </div>
              <div className="pointer-events-none absolute right-0 top-1/2 z-10 -translate-y-1/2">
                <Mascot color="pink" size={44} className="mascot-bob" title="Mascota cargando miniaturas" />
              </div>
              <div className="marquee-track flex w-max gap-4 px-12">
                {carousel.map((g, i) => (
                  <Link
                    key={`${g.id}-${i}`}
                    href={`/gallery/${g.id}`}
                    aria-label={`Miniatura: ${g.userPrompt.slice(0, 50)}`}
                    className="block w-56 shrink-0 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] transition hover:-translate-y-1 hover:border-[var(--color-accent)]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={g.imageUrl} alt={g.userPrompt.slice(0, 80)} loading="lazy" className="aspect-video w-full object-cover" />
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-6 text-center text-sm text-[var(--color-text-muted)]">
              Aún no hay miniaturas públicas. ¡Sé el primero en publicar la tuya!
            </p>
          )}
        </section>

        {/* CÓMO FUNCIONA */}
        <section className="py-14">
          <h2 className="text-center font-display text-2xl font-bold md:text-3xl">Cómo funciona</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <RevealOnScroll key={step.title} delay={i * 0.08}>
                <div className="flex h-full flex-col items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-5 text-center">
                  <Mascot color={step.color} size={56} className="mascot-bob" />
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">Paso {i + 1}</p>
                  <h3 className="mt-1 font-display text-lg font-bold">{step.title}</h3>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{step.text}</p>
                </div>
              </RevealOnScroll>
            ))}
          </div>
        </section>

        {/* PRECIOS */}
        <section id="precios" className="py-14">
          <h2 className="text-center font-display text-2xl font-bold md:text-3xl">Planes</h2>
          <div className="mx-auto mt-10 grid max-w-3xl gap-6 md:grid-cols-2">
            <PlanCard
              name="Gratis"
              price="0€"
              cta="Empezar"
              href="/generate"
              features={["1 miniatura al día", "Galería de las últimas 30", "Estilos predefinidos"]}
            />
            <PlanCard
              name="Pro"
              price="~20€/mes"
              cta="Suscribirse"
              href="/pricing"
              featured
              features={[
                "5 miniaturas al día + 30 mensuales",
                "Alta resolución",
                "Galería ilimitada",
                "Publica tus estilos",
                "Modo ahorro",
              ]}
            />
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-[var(--color-border)] py-8">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-4 px-4 text-sm text-[var(--color-text-muted)] md:flex-row md:px-8">
          <Link href="/" className="font-display text-lg font-extrabold text-[var(--color-text-secondary)]">
            Mini<span className="logo-ai">AI</span>tura
          </Link>
          <div className="flex gap-5">
            <Link href="/pricing" className="hover:text-[var(--color-text-primary)]">Precios</Link>
            <Link href="/gallery" className="hover:text-[var(--color-text-primary)]">Galería</Link>
            <a href="mailto:hola@miniaitura.com" className="hover:text-[var(--color-text-primary)]">Contacto</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PlanCard({
  name,
  price,
  cta,
  href,
  features,
  featured = false,
}: {
  name: string;
  price: string;
  cta: string;
  href: string;
  features: string[];
  featured?: boolean;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 ${
        featured
          ? "border-[var(--color-accent)] bg-[var(--color-bg-panel)] shadow-xl shadow-[var(--color-accent)]/15"
          : "border-[var(--color-border)] bg-[var(--color-bg-panel)]"
      }`}
    >
      {featured && (
        <span className="absolute -top-3 left-6 rounded-full bg-[var(--color-accent)] px-3 py-0.5 text-xs font-semibold text-white">
          Popular
        </span>
      )}
      <h3 className="font-display text-xl font-bold">{name}</h3>
      <p className="mt-1 text-2xl font-extrabold">{price}</p>
      <ul className="mt-4 flex-1 space-y-2 text-sm text-[var(--color-text-secondary)]">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className="mt-0.5 text-[var(--color-success)]">✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link
        href={href}
        className={`mt-6 rounded-xl px-4 py-2.5 text-center font-semibold transition hover:-translate-y-0.5 ${
          featured
            ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-strong)]"
            : "border border-[var(--color-border-strong)] text-[var(--color-text-primary)] hover:border-[var(--color-accent)]"
        }`}
      >
        {cta}
      </Link>
    </div>
  );
}
