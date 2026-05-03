"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getCurrentIdToken,
  signInWithGoogle,
  signOutUser,
  subscribeToAuthState,
} from "@/lib/auth/firebase-client";

interface GalleryImageEntry {
  url: string;
  prompt: string;
  createdAt: string;
  provider: "google" | "fal";
}

export default function GalleryPage() {
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [plan, setPlan] = useState<"free" | "pro" | null>(null);
  const [images, setImages] = useState<GalleryImageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<GalleryImageEntry | null>(null);

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
      await loadGallery(nextToken);
    });
    return () => unsubscribe();
  }, []);

  async function loadGallery(authToken: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gallery", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const payload = (await res.json()) as {
        error?: string;
        plan?: "free" | "pro";
        images?: GalleryImageEntry[];
      };
      if (!res.ok) {
        setPlan(payload.plan ?? null);
        setImages([]);
        setError(payload.error ?? "Could not load gallery.");
        return;
      }
      setPlan(payload.plan ?? null);
      setImages(payload.images ?? []);
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
          <h1 className="text-2xl font-semibold tracking-tight">Gallery</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Your generated thumbnails saved on server (Pro only).
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
            App
          </Link>
          <Link href="/pricing" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
            Pricing
          </Link>
        </div>
      </header>

      <section className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4">
        {authEmail ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">{authEmail}</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Plan: {plan ? plan.toUpperCase() : "Unknown"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || loading || !token}
                onClick={async () => {
                  if (!token) return;
                  await loadGallery(token);
                }}
                className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
              >
                Refresh
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await signOutUser();
                    setPlan(null);
                    setImages([]);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
              >
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--color-text-muted)]">
              Sign in with your Pro account to view your gallery.
            </p>
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
                  await loadGallery(nextToken);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
            >
              Sign in
            </button>
          </div>
        )}
      </section>

      {loading ? (
        <p className="mt-6 text-sm text-[var(--color-text-muted)]">Loading gallery...</p>
      ) : error ? (
        <div className="mt-6 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-text-secondary)]">
          <strong className="text-[var(--color-danger)]">Error:</strong> {error}
        </div>
      ) : images.length === 0 ? (
        <div className="mt-6 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4 text-sm text-[var(--color-text-muted)]">
          No images saved yet. Generate images while on Pro and they will appear here.
        </div>
      ) : (
        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image, index) => (
            <article
              key={`${image.url}-${index}`}
              className="cursor-pointer overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]"
              onClick={() => setSelectedImage(image)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={`Gallery image ${index + 1}`} className="aspect-video w-full object-cover" />
              <div className="space-y-1 p-3">
                <p className="line-clamp-2 text-xs text-[var(--color-text-secondary)]">{image.prompt}</p>
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  {new Date(image.createdAt).toLocaleString()} - {image.provider}
                </p>
              </div>
            </article>
          ))}
        </section>
      )}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="w-full max-w-5xl rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Image details</h2>
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                className="rounded-md border border-[var(--color-border-strong)] px-3 py-1 text-sm"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selectedImage.url} alt="Selected gallery image" className="w-full rounded-md border border-[var(--color-border)]" />
              <div className="space-y-3 text-sm">
                <p className="text-[var(--color-text-muted)]">
                  <strong className="text-[var(--color-text-primary)]">Provider:</strong> {selectedImage.provider}
                </p>
                <p className="text-[var(--color-text-muted)]">
                  <strong className="text-[var(--color-text-primary)]">Created:</strong>{" "}
                  {new Date(selectedImage.createdAt).toLocaleString()}
                </p>
                <div>
                  <p className="mb-1 text-[var(--color-text-primary)]"><strong>Prompt</strong></p>
                  <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] p-2 text-[var(--color-text-secondary)]">
                    {selectedImage.prompt}
                  </p>
                </div>
                <a
                  href={selectedImage.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-[var(--color-accent)] hover:underline"
                >
                  Open original URL
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

