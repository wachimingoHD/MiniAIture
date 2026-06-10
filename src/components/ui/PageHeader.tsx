"use client";

// Cabecera superior común a todas las páginas (marca + navegación + sesión +
// plan/créditos). Se renderiza UNA vez desde el layout para que no cambie de
// sitio al navegar; en la landing ("/") se oculta porque tiene su propio hero.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { signInWithGoogle, signOutUser, subscribeToAuthState } from "@/lib/auth/firebase-client";
import { subscribeCredits } from "@/lib/auth/credits-bus";

const NAV: { href: string; key: string }[] = [
  { href: "/generate", key: "generate" },
  { href: "/gallery", key: "community" },
  { href: "/dashboard/gallery", key: "myGallery" },
  { href: "/pricing", key: "pricing" },
  { href: "/dashboard/settings", key: "settings" },
];

export function PageHeader() {
  const t = useTranslations("nav");
  const tAuth = useTranslations("auth");
  const tGen = useTranslations("generate");
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [plan, setPlan] = useState<"free" | "pro" | null>(null);
  const [credits, setCredits] = useState<{ daily: number; monthly: number } | null>(null);

  useEffect(
    () =>
      subscribeToAuthState(async (user) => {
        if (!user) {
          setEmail(null);
          setPlan(null);
          setCredits(null);
          return;
        }
        setEmail(user.email ?? "signed-in-user");
        try {
          const token = await user.getIdToken();
          const res = await fetch("/api/user/credits", { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const payload = (await res.json()) as {
              plan?: "free" | "pro";
              credits?: { daily: number; monthly: number };
            };
            setPlan(payload.plan ?? null);
            if (payload.credits) setCredits(payload.credits);
          }
        } catch {
          // los créditos en cabecera son informativos; sin red se omiten
        }
      }),
    [],
  );

  // Snapshots más frescos publicados por las páginas (p. ej. tras generar).
  useEffect(
    () =>
      subscribeCredits((snapshot) => {
        if (snapshot.plan) setPlan(snapshot.plan);
        if (snapshot.credits) setCredits(snapshot.credits);
      }),
    [],
  );

  // La landing tiene su propio hero a pantalla completa.
  if (pathname === "/") return null;

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="mx-auto max-w-[1480px] px-4 pt-6 md:px-8">
      <header className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] pb-5">
        <Link href="/" className="shrink-0">
          <span className="font-display text-xl font-bold tracking-tight">
            Mini<span className="text-[var(--color-accent)]">AI</span>tura
          </span>
          <span className="block text-xs text-[var(--color-text-muted)]">{tGen("tagline")}</span>
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
              <div className="flex flex-col items-end gap-1.5">
                <span className="hidden max-w-[180px] truncate text-xs text-[var(--color-text-muted)] lg:inline">
                  {email}
                </span>
                <div className="flex items-center gap-2.5">
                  <span className="rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent-strong)]">
                    {plan ?? tGen("planUnknown")}
                  </span>
                  {credits && (
                    <div className="flex items-center gap-3 text-xs">
                      <span className="inline-flex items-center gap-1.5 text-[var(--color-success)]">
                        <span className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
                        <span className="font-semibold tabular-nums">{credits.daily}</span>
                        <span className="text-[var(--color-text-muted)]">{tGen("daily")}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
                        <span className="h-2 w-2 rounded-full bg-[var(--color-text-muted)]" />
                        <span className="font-semibold tabular-nums">{credits.monthly}</span>
                        <span>{tGen("monthly")}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
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
    </div>
  );
}

export default PageHeader;
