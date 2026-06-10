"use client";

// Explorador de la galería pública: orden por salida (recientes) o aleatorio,
// botón de actualizar y "ver más" (paginación por cursor en recientes; lotes
// aleatorios deduplicados en aleatorio). Recibe la primera página renderizada
// en servidor (SEO) y toma el control a partir de ahí.

import Image from "next/image";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { generateAltText } from "@/lib/seo";

export interface ExplorerItem {
  id: string;
  imageUrl: string;
  userPrompt: string;
  styleType: string;
  nicho: string | null;
  timesStyleCopied: number;
  createdAt: string;
}

interface ApiResponse {
  images?: ExplorerItem[];
  nextCursor?: string | null;
}

type Mode = "recent" | "random";

export default function GalleryExplorer({
  initial,
  initialCursor,
}: {
  initial: ExplorerItem[];
  initialCursor: string | null;
}) {
  const t = useTranslations("galleryPublic");
  const [items, setItems] = useState<ExplorerItem[]>(initial);
  // Aleatorio por defecto: la primera página ya llega barajada del servidor.
  const [mode, setMode] = useState<Mode>("random");
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  // En aleatorio, si un lote entero viene repetido asumimos que ya está todo visto.
  const [exhausted, setExhausted] = useState(false);

  const fetchPage = async (m: Mode, c?: string | null): Promise<ApiResponse | null> => {
    try {
      const params = new URLSearchParams({ sort: m === "random" ? "random" : "recent" });
      if (m === "recent" && c) params.set("cursor", c);
      const res = await fetch(`/api/gallery/public?${params}`);
      if (!res.ok) return null;
      return (await res.json()) as ApiResponse;
    } catch {
      return null;
    }
  };

  // Reemplaza el grid entero (cambio de modo o botón Actualizar).
  const reload = async (m: Mode) => {
    setLoading(true);
    setExhausted(false);
    const data = await fetchPage(m);
    if (data?.images) {
      setItems(data.images);
      setCursor(m === "recent" ? (data.nextCursor ?? null) : null);
    }
    setLoading(false);
  };

  const loadMore = async () => {
    setLoading(true);
    if (mode === "recent") {
      const data = await fetchPage("recent", cursor);
      if (data?.images?.length) {
        const known = new Set(items.map((i) => i.id));
        setItems([...items, ...data.images.filter((i) => !known.has(i.id))]);
        setCursor(data.nextCursor ?? null);
      } else {
        setCursor(null);
      }
    } else {
      const data = await fetchPage("random");
      const known = new Set(items.map((i) => i.id));
      const fresh = (data?.images ?? []).filter((i) => !known.has(i.id));
      if (fresh.length === 0) setExhausted(true);
      else setItems([...items, ...fresh]);
    }
    setLoading(false);
  };

  const canLoadMore = mode === "recent" ? cursor !== null : !exhausted;
  const btn = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm transition ${
      active
        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent-strong)]"
        : "border-[var(--color-border-strong)] hover:border-[var(--color-accent)]"
    }`;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button type="button" disabled={loading} onClick={() => { setMode("recent"); void reload("recent"); }} className={btn(mode === "recent")}>
          {t("sortRecent")}
        </button>
        <button type="button" disabled={loading} onClick={() => { setMode("random"); void reload("random"); }} className={btn(mode === "random")}>
          {t("sortRandom")}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => void reload(mode)}
          title={t("refreshTitle")}
          className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)] disabled:opacity-50"
        >
          {loading ? t("loading") : t("refresh")}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--color-text-muted)]">{t("empty")}</p>
      ) : (
        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((gen, i) => (
            <article
              key={gen.id}
              className="group overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] transition hover:border-[var(--color-accent)]"
            >
              <Link href={`/gallery/${gen.id}`}>
                <figure className="m-0">
                  <div className="relative aspect-video w-full">
                    <Image
                      src={gen.imageUrl}
                      alt={generateAltText(gen)}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      priority={i < 4}
                      className="object-cover"
                    />
                  </div>
                  <figcaption className="space-y-1 p-3">
                    <p className="line-clamp-2 text-xs text-[var(--color-text-secondary)]">{gen.userPrompt}</p>
                    {gen.styleType === "custom" && gen.timesStyleCopied > 0 && (
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        {t("styleUsedTimes", { count: gen.timesStyleCopied })}
                      </span>
                    )}
                  </figcaption>
                </figure>
              </Link>
            </article>
          ))}
        </section>
      )}

      {items.length > 0 && canLoadMore && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadMore()}
            className="rounded-md border border-[var(--color-border-strong)] px-5 py-2 text-sm transition hover:border-[var(--color-accent)] disabled:opacity-50"
          >
            {loading ? t("loading") : t("loadMore")}
          </button>
        </div>
      )}
      {items.length > 0 && !canLoadMore && (
        <p className="mt-6 text-center text-xs text-[var(--color-text-muted)]">{t("noMore")}</p>
      )}
    </>
  );
}
