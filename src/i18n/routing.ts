import { defineRouting } from "next-intl/routing";

// Configuración central de i18n.
// - locales soportados: inglés y español.
// - defaultLocale = "en": es el idioma de caída cuando el navegador del visitante
//   no es ni inglés ni español (decisión de producto: mercado inglés ~10x mayor).
// - localePrefix = "always": TODAS las URLs llevan prefijo de idioma
//   (/en/pricing, /es/pricing) para SEO claro en ambos mercados.
export const routing = defineRouting({
  locales: ["en", "es"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
