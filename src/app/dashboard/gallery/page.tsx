"use client";

// Galería personal del usuario (doc §5.1)
// - FREE: últimos 30 (el backend ya acota); aviso de límite.
// - PRO: paginación por cursor ("Cargar más").
// - Click en miniatura -> vista expandida con detalles.

import Link from "next/link";
import { useEffect, useState } from "react";
import { signInWithGoogle, signOutUser, subscribeToAuthState } from "@/lib/auth/firebase-client";

interface GenerationItem {
  id: string;
  imageUrl: string;
  userPrompt: string;
  enhancedPrompt: string;
  stylePrompt: string;
  styleType: "preset" | "custom" | "gallery";
  provider: "gemini" | "fal";
  resolution: number;
  mode: string;
  nicho: string | null;
  isPublic: boolean;
  createdAt: string;
}

interface GalleryResponse {
  error?: string;
  plan?: "free" | "pro";
  limited?: boolean;
  nextCursor?: string | null;
  images?: GenerationItem[];
}

export default function PersonalGalleryPage() {
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [plan, setPlan] = useState<"free" | "pro" | null>(null);
  const [limited, setLimited] = useState(false);
  const [images, setImages] = useState<GenerationItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GenerationItem | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState(async (user) => {
      if (!user) {
        setAuthEmail(null);
        setToken(null);
        setPlan(null);
        setImages([]);
        setLoading(false);
        return;
      }
      setAuthEmail(user.email ?? "signed-in-user");
      const nextToken = await user.getIdToken();
      setToken(nextToken);
      await loadGallery(nextToken, null, true);
    });
    return () => unsubscribe();
  }, []);

  async function loadGallery(authToken: string, fromCursor: string | null, reset: boolean): Promise<void> {
    if (reset) setLoading(true);
    setError(null);
    try {
      const url = fromCursor ? `/api/gallery?cursor=${encodeURIComponent(fromCursor)}` : "/api/gallery";
      const res = await fetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
      const payload = (await res.json()) as GalleryResponse;
      if (!res.ok) {
        setError(payload.error ?? "No se pudo cargar la galería.");
        return;
      }
      setPlan(payload.plan ?? null);
      setLimited(Boolean(payload.limited));
      setCursor(payload.nextCursor ?? null);
      setImages((prev) => (reset ? payload.images ?? [] : [...prev, ...(payload.images ?? [])]));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 md:px-8 md:py-12">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mi galería</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Tus miniaturas generadas.</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">App</Link>
          <Link href="/gallery" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">Comunidad</Link>
        </div>
      </header>

      <section className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4">
        {authEmail ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm">{authEmail}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Plan: {plan ? plan.toUpperCase() : "—"}</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await signOutUser();
                  setImages([]);
                  setPlan(null);
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
            >
              Cerrar sesión
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--color-text-muted)]">Inicia sesión para ver tu galería.</p>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const user = await signInWithGoogle();
                  const nextToken = await user.getIdToken();
                  setToken(nextToken);
                  setAuthEmail(user.email ?? "signed-in-user");
                  await loadGallery(nextToken, null, true);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
            >
              Iniciar sesión
            </button>
          </div>
        )}
      </section>

      {loading ? (
        <p className="mt-6 text-sm text-[var(--color-text-muted)]">Cargando galería…</p>
      ) : error ? (
        <div className="mt-6 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-sm">
          <strong className="text-[var(--color-danger)]">Error:</strong> {error}
        </div>
      ) : images.length === 0 ? (
        <div className="mt-6 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4 text-sm text-[var(--color-text-muted)]">
          Aún no tienes miniaturas. Genera una y aparecerá aquí.
        </div>
      ) : (
        <>
          {limited && (
            <p className="mt-6 text-xs text-[var(--color-text-muted)]">
              Plan FREE: se muestran tus últimas 30 miniaturas. Pásate a PRO para verlas todas.
            </p>
          )}
          <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image) => (
              <article
                key={image.id}
                className="cursor-pointer overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]"
                onClick={() => setSelected(image)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.imageUrl} alt={image.userPrompt.slice(0, 80)} className="aspect-video w-full object-cover" />
                <div className="space-y-1 p-3">
                  <p className="line-clamp-2 text-xs text-[var(--color-text-secondary)]">{image.userPrompt}</p>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {new Date(image.createdAt).toLocaleString()}
                    {image.nicho ? ` · ${image.nicho}` : ""}
                    {image.isPublic ? " · público" : ""}
                  </p>
                </div>
              </article>
            ))}
          </section>
          {plan === "pro" && cursor && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                disabled={busy || !token}
                onClick={async () => {
                  if (!token) return;
                  setBusy(true);
                  try {
                    await loadGallery(token, cursor, false);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-md border border-[var(--color-border-strong)] px-4 py-2 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
              >
                Cargar más
              </button>
            </div>
          )}
        </>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setSelected(null)}>
          <div className="w-full max-w-5xl rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Detalle</h2>
              <button type="button" onClick={() => setSelected(null)} className="rounded-md border border-[var(--color-border-strong)] px-3 py-1 text-sm">Cerrar</button>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selected.imageUrl} alt="Miniatura seleccionada" className="w-full rounded-md border border-[var(--color-border)]" />
              <div className="space-y-3 text-sm">
                <p className="text-[var(--color-text-muted)]"><strong className="text-[var(--color-text-primary)]">Proveedor:</strong> {selected.provider}</p>
                <p className="text-[var(--color-text-muted)]"><strong className="text-[var(--color-text-primary)]">Resolución:</strong> {selected.resolution}</p>
                <p className="text-[var(--color-text-muted)]"><strong className="text-[var(--color-text-primary)]">Modo:</strong> {selected.mode}</p>
                <div>
                  <p className="mb-1"><strong>Tu descripción</strong></p>
                  <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-2 text-[var(--color-text-secondary)]">{selected.userPrompt}</p>
                </div>
                {selected.stylePrompt && (
                  <div>
                    <p className="mb-1"><strong>Estilo</strong></p>
                    <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-2 text-[var(--color-text-secondary)]">{selected.stylePrompt}</p>
                  </div>
                )}
                <a href={selected.imageUrl} target="_blank" rel="noreferrer" className="inline-block text-[var(--color-accent)] hover:underline">Abrir original</a>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
