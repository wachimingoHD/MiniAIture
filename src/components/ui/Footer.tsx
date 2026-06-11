// Footer global: enlaces legales (LSSI/RGPD) + contacto de soporte.
// =============================================================================

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function Footer() {
  const t = useTranslations("footer");
  const year = new Date().getFullYear();

  const links: { href: string; label: string }[] = [
    { href: "/legal/legal-notice", label: t("legalNotice") },
    { href: "/legal/privacy", label: t("privacy") },
    { href: "/legal/terms", label: t("terms") },
    { href: "/legal/cookies", label: t("cookies") },
  ];

  return (
    <footer className="mt-16 border-t border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-3 px-4 py-6 text-xs text-[var(--color-text-muted)] md:flex-row md:items-center md:justify-between md:px-8">
        <p>© {year} MiniAItura. {t("rights")}</p>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-[var(--color-accent)]">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
