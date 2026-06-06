import type { Metadata } from "next";
import { Baloo_2, DM_Sans } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/ui/Sidebar";
import { SITE_URL } from "@/lib/seo";

const display = Baloo_2({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display-next",
  display: "swap",
});

const body = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body-next",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://miniaitura.com"),
  title: {
    default: "MiniAItura — Miniaturas de YouTube con IA",
    template: "%s | MiniAItura",
  },
  description:
    "Describe tu vídeo y nuestra IA genera la miniatura perfecta para tu nicho. Miniaturas de YouTube que consiguen clics, sin saber diseñar.",
  applicationName: "MiniAItura",
  keywords: [
    "miniaturas YouTube",
    "generador de miniaturas IA",
    "thumbnails YouTube",
    "MiniAItura",
  ],
  openGraph: {
    title: "MiniAItura — Miniaturas de YouTube con IA",
    description:
      "Describe tu vídeo y la IA genera la miniatura perfecta para tu nicho.",
    type: "website",
    locale: "es_ES",
    siteName: "MiniAItura",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "MiniAItura — Miniaturas de YouTube con IA",
    description:
      "Genera miniaturas profesionales de YouTube con IA en segundos.",
  },
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

// Datos estructurados de marca (Organization + WebSite) para toda la web.
const orgSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "MiniAItura",
  url: SITE_URL,
  description: "Generador de miniaturas de YouTube con inteligencia artificial.",
};
const siteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "MiniAItura",
  url: SITE_URL,
  inLanguage: "es-ES",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteSchema) }}
        />
        <Sidebar />
        <div className="min-h-screen pl-16">{children}</div>
      </body>
    </html>
  );
}
