"use client";

// Cabecera superior común a todas las páginas (marca + navegación + sesión).
// Unifica los headers ad-hoc que tenía cada página (enlaces sueltos tipo "App")
// para que la navegación sea coherente, como en /generate.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signInWithGoogle, signOutUser, subscribeToAuthState } from "@/lib/auth/firebase-client";

const NAV: { href: string; label: string }[] = [
  { href: "/generate", label: "Generar" },
  { href: "/gallery", label: "Comunidad" },
  { href: "/dashboard/gallery", label: "Mi galería" },
  { href: "/pricing", label: "Precios" },
  { href: "/dashboard/settings", label: "Ajustes" },
];

export function PageHeader({ subtitle }: { subtitle?: string }) {
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(
    () => subscribeToAuthState((user) => setEmail(user ? user.email ?? "signed-in-user" : null)),
    [],
  );

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] pb-5">
      <Link href="/" className="shrink-0">
        <span className="font-display text-xl font-bold tracking-tight">
          Mini<span className="text-[var(--color-accent)]">AI</span>tura
        </span>
        {subtitle && <span className="block text-xs text-[var(--color-text-muted)]">{subtitle}</span>}
      </Link>

      <nav className="hidden items-center gap-4 text-sm text-[var(--color-text-secondary)] md:flex">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={
              isActive(item.href)
                ? "font-medium text-[var(--color-accent)]"
                : "hover:text-[var(--color-accent)]"
            }
          >
            {item.label}
          </Link>
        ))}
        {email ? (
          <>
            <span className="hidden max-w-[180px] truncate text-xs text-[var(--color-text-muted)] lg:inline">
              {email}
            </span>
            <button
              type="button"
              onClick={() => void signOutUser()}
              className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)]"
            >
              Cerrar sesión
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)]"
          >
            Iniciar sesión
          </button>
        )}
      </nav>
    </header>
  );
}

export default PageHeader;
