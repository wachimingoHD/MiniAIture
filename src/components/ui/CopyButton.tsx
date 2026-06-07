"use client";

// Botón "Copiar al portapapeles" con feedback breve. Se usa en la galería
// pública para copiar el contenido, el estilo o ambos por separado.

import { useState } from "react";

export function CopyButton({
  text,
  label = "Copiar",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Fallback para contextos sin Clipboard API (no seguro / sin foco).
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={
        className ??
        "rounded-md border border-[var(--color-border-strong)] px-2.5 py-1 text-xs font-medium transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      }
    >
      {copied ? "¡Copiado!" : label}
    </button>
  );
}

export default CopyButton;
