"use client";

// Popup de confirmación al publicar una miniatura en la galería de la comunidad.
// Se muestra como modal a pantalla completa (portal a <body>) para no quedar
// embebido feo dentro de otra tarjeta. Reutilizable desde generación y galería.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import PublishNotice from "./PublishNotice";

export function PublishConfirmModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("publishModal");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onCancel, busy]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!busy) onCancel();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 font-display text-lg font-bold">{t("title")}</h3>
        <PublishNotice />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="flex-1 rounded-md border border-[var(--color-border-strong)] px-3 py-2 text-sm transition hover:border-[var(--color-accent)] disabled:opacity-50"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex-1 rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
          >
            {busy ? t("publishing") : t("publishNow")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default PublishConfirmModal;
