"use client";

// =============================================================================
// Sidebar — barra de navegación lateral global (boceto §menú desplegable).
// =============================================================================
// Único componente con JS de la navegación: estado de colapso (localStorage),
// ruta activa y sesión de Google. Sin animaciones JS (la transición es CSS).
//
// Iconos: chevron (colapsar), perfil (login / Ajustes), casa (inicio),
// lápiz (generar), estrella (tu galería), lupa (galería pública), ≡ (más info).
// =============================================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signInWithGoogle, subscribeToAuthState } from "@/lib/auth/firebase-client";

type IconProps = { className?: string };
function makeIcon(name: string, path: React.ReactNode) {
  const C = (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      {path}
    </svg>
  );
  C.displayName = `Icon(${name})`;
  return C;
}

const Icon = {
  chevron: makeIcon("chevron", <path d="M9 18l6-6-6-6" />),
  home: makeIcon("home", <><path d="M3 11l9-8 9 8" /><path d="M5 10v10a1 1 0 001 1h12a1 1 0 001-1V10" /></>),
  pencil: makeIcon("pencil", <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></>),
  star: makeIcon("star", <path d="M12 2l3 6.5 7 .9-5 4.8 1.2 7L12 18l-6.4 3.2L6.8 14l-5-4.8 7-.9L12 2z" />),
  search: makeIcon("search", <><circle cx={11} cy={11} r={7} /><path d="M21 21l-4.3-4.3" /></>),
  menu: makeIcon("menu", <path d="M4 7h16M4 12h16M4 17h16" />),
  user: makeIcon("user", <><circle cx={12} cy={8} r={4} /><path d="M4 21a8 8 0 0116 0" /></>),
};

const NAV: { href: string; label: string; icon: keyof typeof Icon }[] = [
  { href: "/", label: "Inicio", icon: "home" },
  { href: "/generate", label: "Generar miniatura", icon: "pencil" },
  { href: "/dashboard/gallery", label: "Tu galería", icon: "star" },
  { href: "/gallery", label: "Galería pública", icon: "search" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lectura de localStorage tras el primer render (evita mismatch SSR)
      setExpanded(localStorage.getItem("sidebar:expanded") === "1");
    } catch {
      /* ignore */
    }
    return subscribeToAuthState((user) => {
      setSignedIn(!!user);
      setPhotoURL(user?.photoURL ?? null);
    });
  }, []);

  const toggle = () =>
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("sidebar:expanded", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  // Estilo de cada fila según estado (colapsado = celda cuadrada centrada).
  const row = (active: boolean) =>
    [
      "group flex items-center rounded-xl transition-colors",
      expanded ? "gap-3 px-3 py-2.5" : "h-11 w-11 justify-center",
      active
        ? "bg-[var(--color-accent)] text-white shadow-sm shadow-[var(--color-accent)]/30"
        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-panel-2)] hover:text-[var(--color-text-primary)]",
    ].join(" ");

  const label = (text: string) =>
    expanded ? <span className="truncate text-sm font-medium">{text}</span> : null;

  return (
    <aside
      className="fixed inset-y-0 left-0 z-50 flex flex-col gap-1 border-r border-[var(--color-border)] bg-[var(--color-bg-panel)] py-3 shadow-[3px_0_22px_-16px_rgba(60,50,30,0.55)] transition-[width] duration-200 ease-out"
      style={{ width: expanded ? 216 : 64 }}
      aria-label="Navegación principal"
    >
      {/* Toggle: a la derecha cuando está desplegado, centrado al colapsar. */}
      <div className={`flex px-3 ${expanded ? "justify-end" : "justify-center"}`}>
        <button
          type="button"
          onClick={toggle}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-panel-2)] hover:text-[var(--color-text-primary)]"
          aria-label={expanded ? "Colapsar menú" : "Expandir menú"}
          aria-expanded={expanded}
        >
          <Icon.chevron className={`h-5 w-5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Perfil / login */}
      <div className="px-2.5 pt-1">
        {signedIn ? (
          <Link href="/dashboard/settings" className={row(isActive("/dashboard/settings"))} title="Ajustes de tu cuenta">
            {photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoURL}
                alt=""
                referrerPolicy="no-referrer"
                className="h-7 w-7 shrink-0 rounded-full object-cover ring-2 ring-[var(--color-accent)]/60"
              />
            ) : (
              <Icon.user className="h-7 w-7 shrink-0" />
            )}
            {label("Tu cuenta")}
          </Link>
        ) : (
          <button type="button" onClick={() => void signInWithGoogle()} className={`w-full ${row(false)}`} title="Iniciar sesión con Google">
            <Icon.user className="h-7 w-7 shrink-0" />
            {label("Iniciar sesión")}
          </button>
        )}
      </div>

      <div className="mx-3 my-2 border-t border-[var(--color-border)]" />

      {/* Navegación */}
      <nav className="flex flex-1 flex-col gap-1 px-2.5">
        {NAV.map((item) => {
          const Ico = Icon[item.icon];
          return (
            <Link key={item.href} href={item.href} className={row(isActive(item.href))} title={item.label}>
              <Ico className="h-[22px] w-[22px] shrink-0" />
              {label(item.label)}
            </Link>
          );
        })}
      </nav>

      {/* Más info */}
      <div className="px-2.5">
        <Link href="/pricing" className={row(isActive("/pricing"))} title="Más info">
          <Icon.menu className="h-[22px] w-[22px] shrink-0" />
          {label("Más info")}
        </Link>
      </div>
    </aside>
  );
}

export default Sidebar;
