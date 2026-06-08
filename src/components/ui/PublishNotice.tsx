"use client";

// Aviso de privacidad al publicar una miniatura en la galería de la comunidad.
// Se reutiliza en la página de generación y en la galería privada para que el
// mensaje sea coherente en toda la app (doc §5/§6: el estilo se comparte; el
// contenido es personal).

import { useTranslations } from "next-intl";

export function PublishNotice() {
  const t = useTranslations("publishNotice");
  const strong = (chunks: React.ReactNode) => (
    <strong className="font-semibold text-[var(--color-text-primary)]">{chunks}</strong>
  );

  return (
    <div className="rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] p-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
      <p className="mb-2 flex items-center gap-1.5 font-semibold text-[var(--color-text-primary)]">
        <span aria-hidden>🌐</span>
        {t("heading")}
      </p>
      <ul className="space-y-1">
        <li className="flex gap-1.5">
          <span aria-hidden className="text-[var(--color-accent)]">•</span>
          <span>{t.rich("bullet1", { strong })}</span>
        </li>
        <li className="flex gap-1.5">
          <span aria-hidden className="text-[var(--color-accent)]">•</span>
          <span>{t.rich("bullet2", { strong })}</span>
        </li>
        <li className="flex gap-1.5">
          <span aria-hidden className="text-[var(--color-accent)]">•</span>
          <span>{t.rich("bullet3", { strong })}</span>
        </li>
      </ul>
      <p className="mt-2 text-[var(--color-text-muted)]">
        {t("footer")}
      </p>
    </div>
  );
}

export default PublishNotice;
