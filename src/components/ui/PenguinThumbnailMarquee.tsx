"use client";

// =============================================================================
// PenguinThumbnailMarquee — pingüinos que "cargan" miniaturas públicas y se
// deslizan por la pantalla.
// =============================================================================
// - Animación de los pingüinos y del deslizamiento: 100% CSS (sin JS por frame).
// - Interactividad (medida): al pasar el ratón la miniatura se resalta (glow +
//   escala) y su pingüino se para; al hacer clic se abre un modal con la imagen
//   en grande, el prompt de estilo de la IA y el autor.
// - Bucle infinito sin costuras: margen por ítem + relleno hasta superar el
//   ancho de pantalla (no se ve el corte ni con zoom-out).
// =============================================================================

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export interface MarqueeThumb {
  id: string;
  imageUrl?: string;
  prompt?: string;
  stylePrompt?: string;
  authorName?: string;
}

// =============================================================================
// 👇 LISTAS DE FOTOGRAMAS DE LOS PINGÜINOS (una por variante).
// Cada número es el índice de frame del sprite de deslizamiento (válidos 0–5).
// Edita libremente: añade/quita/repite/reordena. Los pingüinos se reparten
// estas 3 listas (por su posición). FPS = velocidad (fotogramas por segundo).
// =============================================================================
const FRAME_SEQUENCES: number[][] = [
  [0, 1, 0, 1, 0, 1, 4, 3, 4, 3, 0, 1],
  [0, 1, 0, 1, 2, 5, 4, 5, 4, 3, 0, 1],
  [0, 1],
];
const FPS = 8;

// Genera el CSS de las animaciones a partir de las listas de arriba (se calcula
// una sola vez; sigue siendo CSS puro, sin JS de animación en el cliente).
function buildVariantCSS(): string {
  return FRAME_SEQUENCES.map((seq, v) => {
    const name = `peng-seq-${v}`;
    const stops = seq
      .map((f, i) => `${((i / seq.length) * 100).toFixed(3)}%{background-position-x:calc(var(--fw)*${-f})}`)
      .join("");
    const lastFrame = seq[seq.length - 1] ?? 0;
    const duration = (seq.length / FPS).toFixed(3);
    return (
      `@keyframes ${name}{${stops}100%{background-position-x:calc(var(--fw)*${-lastFrame})}}` +
      `.peng-v${v}{animation:${name} ${duration}s step-end infinite}`
    );
  }).join("");
}

const VARIANT_CSS = buildVariantCSS();
const VARIANTS = FRAME_SEQUENCES.map((_, v) => `peng-v${v}`);

function Carrier({
  item,
  index,
  flip,
  onSelect,
  stopped,
  onHover,
}: {
  item: MarqueeThumb;
  index: number;
  flip: boolean;
  onSelect: (t: MarqueeThumb) => void;
  stopped: boolean;
  onHover: (i: number | null) => void;
}) {
  const t = useTranslations("marquee");
  const variant = VARIANTS[index % VARIANTS.length];
  const clickable = !!item.imageUrl;

  const thumb = (
    <div className="aspect-video w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] shadow-[0_12px_30px_-14px_rgba(60,50,30,0.35)] transition duration-200 group-hover:scale-[1.06] group-hover:border-[var(--color-accent)] group-hover:shadow-[0_10px_44px_-6px_rgba(124,110,240,0.55)]">
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt={item.prompt?.slice(0, 80) ?? t("publicThumbAlt")}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-[var(--color-pastel-purple)] via-[var(--color-pastel-blue)] to-[var(--color-pastel-green)]" />
      )}
    </div>
  );

  return (
    <div
      className={`group thumb-card relative mr-14 w-60 shrink-0 pb-[40px] hover:z-20 sm:w-80 ${stopped ? "is-stopped" : ""}`}
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
    >
      {clickable ? (
        <button
          type="button"
          onClick={() => onSelect(item)}
          className="block w-full cursor-pointer"
          aria-label={t("viewThumb", { title: item.prompt?.slice(0, 60) ?? "" })}
        >
          {thumb}
        </button>
      ) : (
        thumb
      )}
      {/* Pingüino centrado, apoyado en el borde inferior de la miniatura. */}
      <div
        className="pointer-events-none absolute bottom-0 left-1/2"
        style={{ transform: flip ? "translateX(-50%) scaleX(-1)" : "translateX(-50%)" }}
        aria-hidden
      >
        <div className={`peng ${variant}`} style={{ animationDelay: `${(index % 5) * -0.17}s` }} />
      </div>
    </div>
  );
}

function Row({
  items,
  reverse,
  onSelect,
}: {
  items: MarqueeThumb[];
  reverse: boolean;
  onSelect: (t: MarqueeThumb) => void;
}) {
  // Estado de hover (qué tarjeta tiene el ratón) → controla la pausa por clase.
  // Es solo estado de interacción, no anima nada por JS.
  const [hovered, setHovered] = useState<number | null>(null);

  // Duplicamos para un bucle sin costuras (el track mide el doble y va a -50%).
  const loop = [...items, ...items];
  return (
    // py-10 deja sitio para el glow/escala del hover (que si no, recortaría overflow).
    <div className="relative w-full overflow-hidden py-10">
      <div className={`pmarquee flex w-max ${reverse ? "reverse" : ""} ${hovered !== null ? "is-paused" : ""}`}>
        {loop.map((it, i) => (
          // reverse (hacia la derecha) → mira a la derecha (sin flip).
          // !reverse (hacia la izquierda) → flip para ir de cabeza.
          <Carrier
            key={`${reverse ? "r" : "l"}-${it.id}-${i}`}
            item={it}
            index={i}
            flip={!reverse}
            onSelect={onSelect}
            stopped={i === hovered}
            onHover={setHovered}
          />
        ))}
      </div>
    </div>
  );
}

// Repite la lista hasta tener al menos `min` ítems, para que cada grupo sea más
// ancho que la pantalla y el bucle no deje huecos al reciclar (infinito real).
function fillTo(items: MarqueeThumb[], min: number): MarqueeThumb[] {
  if (items.length === 0) return items;
  const out = [...items];
  while (out.length < min) out.push(...items);
  return out;
}

function ThumbModal({ thumb, onClose }: { thumb: MarqueeThumb; onClose: () => void }) {
  const t = useTranslations("marquee");
  // Solo montamos el portal en cliente (document no existe en SSR).
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (!mounted) return null;

  // Portal a <body>: el marquee vive dentro de una sección con `transform`
  // (.on-scroll-rise → @keyframes rise-in), lo que convierte a esa sección en el
  // bloque contenedor de cualquier `position: fixed` descendiente. Sin el portal,
  // el overlay sólo cubría la banda del slider en vez de todo el viewport.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white transition hover:bg-black/50"
        >
          ✕
        </button>

        {/* Imagen en grande */}
        <div className="aspect-video w-full bg-[var(--color-bg-panel-2)]">
          {thumb.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb.imageUrl} alt={thumb.prompt ?? t("thumbAlt")} className="h-full w-full object-contain" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-[var(--color-pastel-purple)] via-[var(--color-pastel-blue)] to-[var(--color-pastel-green)]" />
          )}
        </div>

        {/* Detalles */}
        <div className="p-5">
          {thumb.prompt && <h3 className="font-display text-lg font-bold">{thumb.prompt}</h3>}

          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {t("styleUsed")}
          </p>
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-[var(--color-bg-panel-2)] p-3 text-sm text-[var(--color-text-secondary)]">
            {thumb.stylePrompt?.trim() || t("noStyle")}
          </p>

          <div className="mt-4 flex items-center gap-3">
            <div className="leading-tight">
              <p className="text-xs text-[var(--color-text-muted)]">{t("author")}</p>
              <p className="text-sm font-medium">{thumb.authorName ?? t("anonymous")}</p>
            </div>
            <Link
              href={`/gallery/${thumb.id}`}
              className="ml-auto rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-sm font-medium transition hover:border-[var(--color-accent)]"
            >
              {t("viewInGallery")}
            </Link>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function PenguinThumbnailMarquee({ items }: { items: MarqueeThumb[] }) {
  const [selected, setSelected] = useState<MarqueeThumb | null>(null);

  const base: MarqueeThumb[] =
    items.length > 0 ? items : Array.from({ length: 6 }, (_, i) => ({ id: `placeholder-${i}` }));

  // 24 ítems por grupo: cada copia supera con holgura el ancho de pantalla
  // incluso con bastante zoom-out, evitando que se vea el corte al reciclar.
  const group = fillTo(base, 24);
  const top = group;
  const bottom = [...group].reverse();

  return (
    <div className="flex flex-col gap-6">
      {/* Animaciones generadas desde FRAME_SEQUENCES (una vez). */}
      <style dangerouslySetInnerHTML={{ __html: VARIANT_CSS }} />
      <Row items={top} reverse={false} onSelect={setSelected} />
      <Row items={bottom} reverse onSelect={setSelected} />
      {selected && <ThumbModal thumb={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

export default PenguinThumbnailMarquee;
