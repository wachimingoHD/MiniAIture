// Metadatos SEO de /generate (la página en sí es un client component, así que
// el título/canonical/hreflang se definen en este layout de segmento).

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  return {
    title: t("generateTitle"),
    description: t("generateDescription"),
    alternates: {
      canonical: `/${locale}/generate`,
      languages: { en: "/en/generate", es: "/es/generate", "x-default": "/en/generate" },
    },
  };
}

export default function GenerateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
