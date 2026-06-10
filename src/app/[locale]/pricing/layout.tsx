import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SITE_URL } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pricingMeta" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `/${locale}/pricing`,
      languages: { en: "/en/pricing", es: "/es/pricing", "x-default": "/en/pricing" },
    },
    openGraph: {
      title: t("ogTitle"),
      description: t("ogDescription"),
      url: `${SITE_URL}/${locale}/pricing`,
      type: "website",
    },
  };
}

// SoftwareApplication con oferta gratuita (posibles rich results de precio).
const appSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "MiniAItura",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  url: `${SITE_URL}/pricing`,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "EUR",
    description: "Plan gratuito: 1 miniatura al día.",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appSchema) }}
      />
      {children}
    </>
  );
}
