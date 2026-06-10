import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Baloo_2, DM_Sans } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import "../globals.css";
import Sidebar from "@/components/ui/Sidebar";
import PageHeader from "@/components/ui/PageHeader";
import { SITE_URL } from "@/lib/seo";
import { routing } from "@/i18n/routing";

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

// Pre-renderiza las dos variantes de idioma en build.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  const ogLocale = locale === "es" ? "es_ES" : "en_US";

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: t("title"),
      template: t("titleTemplate"),
    },
    description: t("description"),
    applicationName: "MiniAItura",
    keywords: t("keywords")
      .split("|")
      .map((k) => k.trim()),
    openGraph: {
      title: t("title"),
      description: t("ogDescription"),
      type: "website",
      locale: ogLocale,
      siteName: "MiniAItura",
      url: `${SITE_URL}/${locale}`,
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("twitterDescription"),
    },
    // OJO: nada de `alternates.canonical` aquí. Un canonical en el layout se
    // hereda en TODAS las subpáginas y las marcaría como duplicados de la home.
    // Cada página define su propio canonical + hreflang.
    robots: { index: true, follow: true },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "metadata" });

  // Datos estructurados de marca (Organization + WebSite) para toda la web.
  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "MiniAItura",
    url: SITE_URL,
    description: t("orgDescription"),
  };
  const siteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "MiniAItura",
    url: SITE_URL,
    inLanguage: locale === "es" ? "es-ES" : "en-US",
  };

  return (
    <html lang={locale} className={`${display.variable} ${body.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteSchema) }}
        />
        <NextIntlClientProvider>
          <Sidebar />
          <div className="min-h-screen pl-16">
            <PageHeader />
            {children}
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
