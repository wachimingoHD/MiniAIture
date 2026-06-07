"use client";

// Botones "Usar en el generador" de una miniatura pública.
// Al pulsar cualquiera, guarda el contenido y/o el estilo en sessionStorage y
// navega a /generate, que los precarga en el formulario. Para estilo/ambos
// registra además el uso del estilo (incrementa timesStyleCopied).

import { useRouter } from "next/navigation";
import { useState } from "react";

export const PREFILL_STORAGE_KEY = "miniaitura:prefill";

export interface GeneratorPrefill {
  content?: string;
  style?: string;
  styleFromId?: string;
}

export default function UseInGenerator({
  generationId,
  content,
  style,
}: {
  generationId: string;
  content: string;
  style: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const go = async (payload: GeneratorPrefill, registerStyle: boolean) => {
    setBusy(true);
    try {
      sessionStorage.setItem(PREFILL_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // sin sessionStorage: navegamos igualmente (sin precarga).
    }
    if (registerStyle) {
      try {
        await fetch(`/api/generations/${generationId}/use-style`, { method: "POST" });
      } catch {
        // el conteo es best-effort
      }
    }
    router.push("/generate");
  };

  const btn =
    "rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm font-medium transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50";

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Usar en el generador
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void go({ content }, false)} className={btn}>
          Usar contenido
        </button>
        {style && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void go({ style, styleFromId: generationId }, true)}
            className={btn}
          >
            Usar estilo
          </button>
        )}
        {style && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void go({ content, style, styleFromId: generationId }, true)}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
          >
            Usar ambos
          </button>
        )}
      </div>
    </div>
  );
}
