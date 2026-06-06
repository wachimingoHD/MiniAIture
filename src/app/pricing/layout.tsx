import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Planes y precios",
  description:
    "Plan gratuito con 1 miniatura al día o plan PRO con más generaciones, alta resolución y galería ilimitada. Crea miniaturas profesionales de YouTube con IA.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Planes y precios | MiniAItura",
    description: "Compara el plan gratuito y el plan PRO de MiniAItura.",
    url: `${SITE_URL}/pricing`,
    type: "website",
  },
};

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
