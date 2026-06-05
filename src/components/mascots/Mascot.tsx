// Mascotas de MiniAItura (placeholders SVG on-brand)
// =============================================================================
// Criaturas redondas, pastel y expresivas. Son PLACEHOLDERS: cuando existan los
// sprites pixel-art definitivos, sustituir este SVG por un <span> con
// background-image apuntando a un sprite sheet en /public/mascots/<color>.png
// y animarlo por CSS (steps()). La API de props se mantiene igual.
//
// Estética: doc "Cartoon profesional con mascotas pixel art".
// =============================================================================

import type { CSSProperties } from "react";

export type MascotColor = "pink" | "blue" | "green" | "yellow" | "lavender";
export type MascotMood = "happy" | "sleep" | "sad" | "work";

const COLOR_VAR: Record<MascotColor, string> = {
  pink: "var(--color-mascot-pink)",
  blue: "var(--color-mascot-blue)",
  green: "var(--color-mascot-green)",
  yellow: "var(--color-mascot-yellow)",
  lavender: "var(--color-mascot-lavender)",
};

export interface MascotProps {
  color?: MascotColor;
  mood?: MascotMood;
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Mascot({
  color = "lavender",
  mood = "happy",
  size = 48,
  className,
  style,
  title = "Mascota de MiniAItura",
}: MascotProps) {
  const fill = COLOR_VAR[color];
  const sleeping = mood === "sleep";
  const sad = mood === "sad";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      className={className}
      style={style}
    >
      <title>{title}</title>
      {/* sombra */}
      <ellipse cx="32" cy="56" rx="16" ry="3.5" fill="rgba(0,0,0,0.25)" />
      {/* patitas */}
      <ellipse cx="24" cy="50" rx="5" ry="4" fill={fill} opacity="0.85" />
      <ellipse cx="40" cy="50" rx="5" ry="4" fill={fill} opacity="0.85" />
      {/* cuerpo redondo */}
      <circle cx="32" cy="32" r="22" fill={fill} />
      <circle cx="32" cy="32" r="22" fill="rgba(255,255,255,0.08)" />
      {/* mejillas */}
      <circle cx="20" cy="36" r="3.2" fill="rgba(240,110,110,0.35)" />
      <circle cx="44" cy="36" r="3.2" fill="rgba(240,110,110,0.35)" />
      {/* ojos */}
      {sleeping ? (
        <>
          <path d="M22 30 q4 4 8 0" stroke="#2a2b4a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path d="M34 30 q4 4 8 0" stroke="#2a2b4a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <text x="46" y="20" fontSize="10" fill="#2a2b4a" opacity="0.7">z</text>
        </>
      ) : (
        <>
          <circle cx="26" cy="30" r="3.4" fill="#2a2b4a" />
          <circle cx="38" cy="30" r="3.4" fill="#2a2b4a" />
          <circle cx="27.2" cy="28.8" r="1.1" fill="#fff" />
          <circle cx="39.2" cy="28.8" r="1.1" fill="#fff" />
        </>
      )}
      {/* boca */}
      {sad ? (
        <path d="M27 41 q5 -4 10 0" stroke="#2a2b4a" strokeWidth="2" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M27 39 q5 5 10 0" stroke="#2a2b4a" strokeWidth="2" fill="none" strokeLinecap="round" />
      )}
      {/* antenita */}
      <line x1="32" y1="10" x2="32" y2="16" stroke={fill} strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="8" r="2.4" fill={fill} />
    </svg>
  );
}

export default Mascot;
