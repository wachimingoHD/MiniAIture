"use client";

// Loader de generación (doc §Estado de carga)
// =============================================================================
// Reemplaza el spinner/barra de progreso: una mascota pinta un lienzo que se va
// llenando de color, con puntos suspensivos animados. Respeta prefers-reduced-
// motion vía las clases CSS (definidas en globals.css).
// =============================================================================

import Mascot from "./Mascot";

export function MascotLoader({ fetchMode = false }: { fetchMode?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-10 text-center">
      <div className="relative h-[140px] w-[200px]" aria-hidden>
        {/* Lienzo */}
        <div className="absolute bottom-3 right-4 h-[110px] w-[120px] overflow-hidden rounded-md border-2 border-[var(--color-border-strong)] bg-[var(--color-bg-panel-2)]">
          <div
            className="paint-fill absolute inset-x-0 bottom-0 h-full"
            style={{
              background:
                "linear-gradient(180deg, var(--color-accent) 0%, var(--color-accent-2) 100%)",
              opacity: 0.55,
            }}
          />
        </div>
        {/* Caballete (patas) */}
        <div className="absolute bottom-0 right-9 h-4 w-1 -rotate-12 rounded bg-[var(--color-border-strong)]" />
        <div className="absolute bottom-0 right-20 h-4 w-1 rotate-12 rounded bg-[var(--color-border-strong)]" />
        {/* Mascota pintora */}
        <div className="absolute bottom-2 left-1 mascot-bob">
          <Mascot color="lavender" mood="work" size={64} title="Mascota pintando tu miniatura" />
          {/* Pincel */}
          <div className="mascot-brush absolute right-1 top-7 h-8 w-1.5 rounded-full bg-[var(--color-accent-2)]">
            <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-[var(--color-accent)]" />
          </div>
        </div>
      </div>

      <div>
        <p className="font-display text-lg">
          Creando tu miniatura<span className="loading-dots" />
        </p>
        <p className="mt-1 max-w-xs text-sm text-[var(--color-text-secondary)]">
          {fetchMode
            ? "Tu miniatura se está generando en modo de baja prioridad. Puede tardar varios minutos."
            : "Nuestras mascotas están dando los últimos retoques."}
        </p>
      </div>

      <style jsx>{`
        .loading-dots::after {
          content: "";
          animation: dots 1.4s steps(4, end) infinite;
        }
        @keyframes dots {
          0% { content: ""; }
          25% { content: "."; }
          50% { content: ".."; }
          75% { content: "..."; }
          100% { content: ""; }
        }
        @media (prefers-reduced-motion: reduce) {
          .loading-dots::after { content: "..."; animation: none; }
        }
      `}</style>
    </div>
  );
}

export default MascotLoader;
