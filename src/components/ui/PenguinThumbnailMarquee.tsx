// =============================================================================
// PenguinThumbnailMarquee — pingüinos que "cargan" miniaturas públicas y se
// deslizan por la pantalla. 100% CSS (sin JavaScript de animación).
// =============================================================================
// - Dos filas en sentidos opuestos. El pingüino mira a la derecha; cuando la
//   fila avanza hacia la izquierda se voltea (.peng--flip) para ir de cabeza.
// - El pingüino va centrado bajo su miniatura y dentro del contenedor (no se
//   recorta) y se mueve con ella a la misma velocidad.
// - Bucle sin costuras: cada ítem lleva su margen (no flex-gap), así el -50%
//   del keyframe encaja exacto y no "se rompe" al hacer zoom.
// - Cada pingüino usa una de las 3 disposiciones de fotogramas (.peng-a/b/c).
//
// Componente de servidor: solo markup + clases CSS. Sin coste de JS en cliente.
// =============================================================================

import Link from "next/link";

export interface MarqueeThumb {
  id: string;
  imageUrl?: string;
  prompt?: string;
}

const VARIANTS = ["peng-a", "peng-b", "peng-c"] as const;

function Carrier({ item, index, flip }: { item: MarqueeThumb; index: number; flip: boolean }) {
  const variant = VARIANTS[index % VARIANTS.length];

  const thumb = (
    <div className="aspect-video w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] shadow-[0_12px_30px_-14px_rgba(60,50,30,0.35)]">
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt={item.prompt?.slice(0, 80) ?? "Miniatura pública"}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-[var(--color-pastel-purple)] via-[var(--color-pastel-blue)] to-[var(--color-pastel-green)]" />
      )}
    </div>
  );

  return (
    <div className="relative mr-12 w-44 shrink-0 pb-[22px] sm:w-52">
      {item.imageUrl ? (
        <Link href={`/gallery/${item.id}`} aria-label={item.prompt?.slice(0, 60) ?? "Ver miniatura"}>
          {thumb}
        </Link>
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

function Row({ items, reverse }: { items: MarqueeThumb[]; reverse: boolean }) {
  // Duplicamos para un bucle sin costuras (el track mide el doble y va a -50%).
  const loop = [...items, ...items];
  return (
    <div className="pmarquee-pause relative w-full overflow-hidden">
      <div className={`pmarquee flex w-max ${reverse ? "reverse" : ""}`}>
        {loop.map((it, i) => (
          // reverse (hacia la derecha) → mira a la derecha (sin flip).
          // !reverse (hacia la izquierda) → flip para ir de cabeza.
          <Carrier key={`${reverse ? "r" : "l"}-${it.id}-${i}`} item={it} index={i} flip={!reverse} />
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

export function PenguinThumbnailMarquee({ items }: { items: MarqueeThumb[] }) {
  const base: MarqueeThumb[] =
    items.length > 0 ? items : Array.from({ length: 6 }, (_, i) => ({ id: `placeholder-${i}` }));

  const group = fillTo(base, 14);
  const top = group;
  const bottom = [...group].reverse();

  return (
    <div className="flex flex-col gap-12">
      <Row items={top} reverse={false} />
      <Row items={bottom} reverse />
    </div>
  );
}

export default PenguinThumbnailMarquee;
