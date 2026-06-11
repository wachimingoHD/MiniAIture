// Páginas legales (aviso legal, privacidad, condiciones, cookies).
// =============================================================================
// Server Component estático: el contenido vive en src/lib/legal/content.ts.
// Cada documento tiene canonical propio + hreflang, igual que el resto de
// páginas públicas.
// =============================================================================

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { getLegalDocument, LEGAL_SLUGS } from "@/lib/legal/content";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    LEGAL_SLUGS.map((slug) => ({ locale, slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const doc = getLegalDocument(locale, slug);
  if (!doc) return {};
  return {
    title: doc.title,
    alternates: {
      canonical: `/${locale}/legal/${slug}`,
      languages: {
        en: `/en/legal/${slug}`,
        es: `/es/legal/${slug}`,
        "x-default": `/en/legal/${slug}`,
      },
    },
  };
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const doc = getLegalDocument(locale, slug);
  if (!doc) notFound();

  const updatedLabel = locale === "es" ? "Última actualización" : "Last updated";
  const updatedDate = new Date(doc.updated).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <main className="mx-auto max-w-[760px] px-4 py-10 md:px-8 md:py-14">
      <h1 className="font-display text-3xl font-bold tracking-tight">{doc.title}</h1>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        {updatedLabel}: {updatedDate}
      </p>

      <div className="mt-8 space-y-8">
        {doc.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>
            {section.paragraphs?.map((p, i) => (
              <p key={i} className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                {p}
              </p>
            ))}
            {section.list && (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                {section.list.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
