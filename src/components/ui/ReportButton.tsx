"use client";

// Botón "Reportar" del detalle público de una miniatura (moderación reactiva).
// Pide un motivo opcional con window.prompt para no montar otro modal aquí.

import { useState } from "react";
import { useTranslations } from "next-intl";

export default function ReportButton({ generationId }: { generationId: string }) {
  const t = useTranslations("galleryDetail");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");

  const report = async () => {
    const reason = window.prompt(t("reportPromptReason"));
    if (reason === null) return; // canceló
    setState("busy");
    try {
      const res = await fetch(`/api/generations/${generationId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  };

  if (state === "sent") {
    return <span className="text-xs text-[var(--color-text-muted)]">{t("reportThanks")}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => void report()}
      disabled={state === "busy"}
      className="text-xs text-[var(--color-text-muted)] underline-offset-2 transition hover:text-[var(--color-danger)] hover:underline disabled:opacity-50"
    >
      {state === "error" ? t("reportFailed") : t("report")}
    </button>
  );
}
