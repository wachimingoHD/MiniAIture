"use client";

// Loader de generación (doc §Estado de carga)
// =============================================================================
// Sprite CSS puro (sin DOM/JS de animación): el pingüino pintor de
// /sprites/penguin.png se anima vía la clase global .peng-paint. Los puntos
// suspensivos y el respeto a prefers-reduced-motion se definen en CSS.
// =============================================================================

import { useTranslations } from "next-intl";

export function MascotLoader({ fetchMode = false }: { fetchMode?: boolean }) {
  const t = useTranslations("loader");
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-10 text-center">
      <div className="peng-paint" aria-hidden />

      <div>
        <p className="font-display text-lg">
          {t("creating")}<span className="loading-dots" />
        </p>
        <p className="mt-1 max-w-xs text-sm text-[var(--color-text-secondary)]">
          {fetchMode ? t("fetchMode") : t("normal")}
        </p>
      </div>

      <style jsx>{`
        .loading-dots::after {
          content: "";
          animation: dots 1.4s steps(4, end) infinite;
        }
        @keyframes dots {
          0% { content: ""; }
          25% { content: "."; }
          50% { content: ".."; }
          75% { content: "..."; }
          100% { content: ""; }
        }
        @media (prefers-reduced-motion: reduce) {
          .loading-dots::after { content: "..."; animation: none; }
        }
      `}</style>
    </div>
  );
}

export default MascotLoader;
