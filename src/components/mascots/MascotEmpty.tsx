"use client";

// =============================================================================
// MascotEmpty — Pingüino para el estado vacío ("Aún no hay nada")
// =============================================================================
// Mismo sistema de animación que PenguinThumbnailMarquee: sprite CSS puro pero
// la lista de fotogramas se define en un array para poder editarla fácilmente.
// El sprite original penguin-empty.png tiene 17 frames (850x50px).
// =============================================================================

// Fotogramas (índices del 0 al 16, correspondientes al sprite de 17 frames).
// La secuencia se reproduce en bucle.
const FRAME_SEQUENCE = [0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 9, 10, 11, 12, 13, 14, 15, 16];
const FPS = 6;

function buildEmptyCSS(): string {
  const stops = FRAME_SEQUENCE.map((f, i) => {
    const percent = ((i / FRAME_SEQUENCE.length) * 100).toFixed(3);
    return `${percent}%{background-position-x:calc(var(--fw)*${-f})}`;
  }).join("");
  
  const lastFrame = FRAME_SEQUENCE[FRAME_SEQUENCE.length - 1] ?? 0;
  const duration = (FRAME_SEQUENCE.length / FPS).toFixed(3);

  return (
    `@keyframes peng-empty-anim {${stops} 100%{background-position-x:calc(var(--fw)*${-lastFrame})}}` +
    `.peng-empty-dyn { animation: peng-empty-anim ${duration}s step-end infinite; }`
  );
}

const EMPTY_CSS = buildEmptyCSS();

export default function MascotEmpty() {
  return (
    <div className="peng-empty-container relative" aria-hidden>
      <style dangerouslySetInnerHTML={{ __html: EMPTY_CSS }} />
      <div className="peng-empty-dyn" />
      <style jsx>{`
        .peng-empty-dyn {
          --fw: 72px;
          width: var(--fw);
          height: var(--fw);
          background-image: url("/sprites/penguin-empty.png");
          background-repeat: no-repeat;
          background-size: calc(var(--fw) * 17) var(--fw); /* ¡17 frames exactos! */
          image-rendering: pixelated;
          image-rendering: crisp-edges;
        }
        @media (prefers-reduced-motion: reduce) {
          .peng-empty-dyn { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
