"use client";

// Settings del usuario: edición de displayName (doc §7.2)

import Link from "next/link";
import { useEffect, useState } from "react";
import { signInWithGoogle, subscribeToAuthState } from "@/lib/auth/firebase-client";

export default function SettingsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const unsub = subscribeToAuthState(async (user) => {
      if (!user) {
        setToken(null);
        setAuthEmail(null);
        setLoading(false);
        return;
      }
      setAuthEmail(user.email ?? "signed-in-user");
      const t = await user.getIdToken();
      setToken(t);
      try {
        const res = await fetch("/api/user/credits", { headers: { Authorization: `Bearer ${t}` } });
        if (res.ok) {
          const data = (await res.json()) as { displayName?: string | null };
          if (data.displayName) setDisplayName(data.displayName);
        }
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const save = async () => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName }),
      });
      const data = (await res.json()) as { error?: string; displayName?: string };
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? "No se pudo guardar." });
        return;
      }
      setMsg({ kind: "ok", text: "Nombre actualizado." });
      if (data.displayName) setDisplayName(data.displayName);
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-[640px] px-4 py-8 md:px-8 md:py-12">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] pb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
        <Link href="/dashboard/gallery" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">Mi galería</Link>
      </header>

      {loading ? (
        <p className="mt-6 text-sm text-[var(--color-text-muted)]">Cargando…</p>
      ) : !token ? (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4">
          <p className="text-sm text-[var(--color-text-muted)]">Inicia sesión para editar tu perfil.</p>
          <button type="button" onClick={() => void signInWithGoogle()} className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm">Iniciar sesión</button>
        </div>
      ) : (
        <section className="mt-6 space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4">
          <p className="text-xs text-[var(--color-text-muted)]">{authEmail}</p>
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Nombre público</label>
            <input
              type="text"
              value={displayName}
              minLength={3}
              maxLength={30}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Tu nombre público"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2.5 text-sm"
            />
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              3–30 caracteres. Letras, números, guiones, guiones bajos y puntos.
            </p>
          </div>
          <button
            type="button"
            disabled={busy || displayName.trim().length < 3}
            onClick={() => void save()}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
          {msg && (
            <p className={`text-sm ${msg.kind === "ok" ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]"}`}>{msg.text}</p>
          )}
        </section>
      )}
    </main>
  );
}
