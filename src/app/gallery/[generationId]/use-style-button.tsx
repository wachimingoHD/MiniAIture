"use client";

// Botón "Usar este estilo" (doc §6.3)
// - Logueado: registra el uso (incrementa timesStyleCopied) y redirige al
//   formulario con el estilo de galería precargado (?styleFrom=<id>).
// - No logueado: redirige a la app, que pedirá login y conservará el estilo.

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UseStyleButton({ generationId }: { generationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch(`/api/generations/${generationId}/use-style`, { method: "POST" });
        } catch {
          // El conteo es best-effort; continuar igualmente.
        } finally {
          router.push(`/generate?styleFrom=${encodeURIComponent(generationId)}`);
        }
      }}
      className="w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-accent)]/10 px-3 py-2 text-sm font-medium hover:border-[var(--color-accent)] disabled:opacity-50"
    >
      {busy ? "Cargando…" : "Usar este estilo"}
    </button>
  );
}
