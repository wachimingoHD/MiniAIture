"use client";

// Cabecera superior común a todas las páginas (marca + navegación + sesión).
// Unifica los headers ad-hoc que tenía cada página (enlaces sueltos tipo "App")
// para que la navegación sea coherente, como en /generate.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { signInWithGoogle, signOutUser, subscribeToAuthState } from "@/lib/auth/firebase-client";

const NAV: { href: string; key: string }[] = [
  { href: "/generate", key: "generate" },
  { href: "/gallery", key: "community" },
  { href: "/dashboard/gallery", key: "myGallery" },
  { href: "/pricing", key: "pricing" },
  { href: "/dashboard/settings", key: "settings" },
];

export function PageHeader({ subtitle }: { subtitle?: string }) {
  const t = useTranslations("nav");
  const tAuth = useTranslations("auth");
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
            {t(item.key)}
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
              {tAuth("signOut")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)]"
          >
            {tAuth("signIn")}
          </button>
        )}
      </nav>
    </header>
  );
}

export default PageHeader;
