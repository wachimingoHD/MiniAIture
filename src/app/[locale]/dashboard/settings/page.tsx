"use client";

// Perfil del usuario: foto/nombre, créditos (diario + mensual con cuenta atrás),
// plan y renovación (cancelar / hazte PRO), stats, y edición de displayName.

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { signInWithGoogle, signOutUser, subscribeToAuthState } from "@/lib/auth/firebase-client";

interface Credits {
  daily: number;
  dailyResetAt: string;
  monthly: number;
  monthlyResetAt: string;
}
interface Profile {
  displayName: string | null;
  email: string | null;
  plan: "free" | "pro";
  credits: Credits;
  subscriptionStatus: string | null;
  subscriptionEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

function timeUntil(iso: string | undefined, now: number, soonLabel: string): string {
  if (!iso) return "—";
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return soonLabel;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tAuth = useTranslations("auth");
  const locale = useLocale();
  const [token, setToken] = useState<string | null>(null);
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Reloj para la cuenta atrás (1/min, página no crítica de rendimiento).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const unsub = subscribeToAuthState(async (user) => {
      if (!user) {
        setToken(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      setPhotoURL(user.photoURL ?? null);
      setMemberSince(user.metadata?.creationTime ?? null);
      const t = await user.getIdToken();
      setToken(t);
      try {
        const res = await fetch("/api/user/credits", { headers: { Authorization: `Bearer ${t}` } });
        if (res.ok) {
          const data = (await res.json()) as Profile;
          setProfile(data);
          setDisplayName(data.displayName ?? user.displayName ?? "");
        }
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const save = async () => {
    if (!token) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName }),
      });
      const data = (await res.json()) as { error?: string; displayName?: string };
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? t("saveFailed") });
        return;
      }
      setMsg({ kind: "ok", text: t("nameUpdated") });
      if (data.displayName) setDisplayName(data.displayName);
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // Deshace la cancelación programada (no cobra nada: el periodo ya está pagado).
  const resumeSubscriptionAction = async () => {
    if (!token) return;
    setCancelBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/billing/reactivate", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? t("resumeFailed") });
        return;
      }
      setProfile((p) => (p ? { ...p, cancelAtPeriodEnd: false } : p));
      setMsg({ kind: "ok", text: t("resumeSuccess") });
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setCancelBusy(false);
    }
  };

  const cancelSubscription = async () => {
    if (!token) return;
    if (!window.confirm(t("cancelConfirm"))) return;
    setCancelBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? t("cancelFailed") });
        return;
      }
      setProfile((p) => (p ? { ...p, cancelAtPeriodEnd: true } : p));
      setMsg({ kind: "ok", text: t("cancelSuccess") });
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setCancelBusy(false);
    }
  };

  // Borrado de cuenta (RGPD): doble confirmación; el backend cancela la
  // suscripción en Stripe, borra datos/imágenes y elimina el usuario de Auth.
  const deleteAccount = async () => {
    if (!token) return;
    if (!window.confirm(t("deleteConfirm1"))) return;
    if (!window.confirm(t("deleteConfirm2"))) return;
    setDeleteBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/user/delete", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? t("deleteFailed") });
        return;
      }
      // Borrado DIFERIDO: la cuenta queda en espera ~24-48h. Cerramos sesión;
      // si el usuario vuelve a entrar antes de que se ejecute, se cancela.
      window.alert(t("deleteScheduled"));
      await signOutUser().catch(() => {});
      window.location.href = `/${locale}`;
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-[680px] px-4 py-8 md:px-8 md:py-12">
      <div className="mt-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-[var(--color-text-muted)]">{t("loading")}</p>
      ) : !token || !profile ? (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4">
          <p className="text-sm text-[var(--color-text-muted)]">{t("signInToView")}</p>
          <button type="button" onClick={() => void signInWithGoogle()} className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm">{tAuth("signIn")}</button>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {/* Cabecera de perfil */}
          <section className="flex items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-5">
            {photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoURL} alt="" referrerPolicy="no-referrer" className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-[var(--color-accent)]/50" />
            ) : (
              <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-2xl font-bold text-white">
                {(displayName || profile.email || "?").trim().charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-display text-xl font-bold">{displayName || t("noName")}</p>
              <p className="truncate text-sm text-[var(--color-text-secondary)]">{profile.email}</p>
              {memberSince && (
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{t("memberSince", { date: fmtDate(memberSince, locale) })}</p>
              )}
            </div>
          </section>

          {/* Créditos */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t("credits")}</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-[var(--color-bg-panel-2)] p-3">
                <p className="text-2xl font-bold">{profile.credits.daily}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{t("dailyRenew", { time: timeUntil(profile.credits.dailyResetAt, now, t("soon")) })}</p>
              </div>
              <div className="rounded-xl bg-[var(--color-bg-panel-2)] p-3">
                <p className="text-2xl font-bold">{profile.plan === "pro" ? profile.credits.monthly : "—"}</p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {profile.plan === "pro" ? t("monthlyRenew", { date: fmtDate(profile.credits.monthlyResetAt, locale) }) : t("monthlyProOnly")}
                </p>
              </div>
            </div>
          </section>

          {/* Plan */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t("plan")}</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${profile.plan === "pro" ? "bg-[var(--color-accent)] text-white" : "bg-[var(--color-bg-panel-2)] text-[var(--color-text-secondary)]"}`}>
                {profile.plan.toUpperCase()}
              </span>
            </div>
            {profile.plan === "pro" ? (
              <div className="mt-3 space-y-3">
                {profile.cancelAtPeriodEnd ? (
                  <>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {t.rich("willCancelOn", {
                        date: fmtDate(profile.subscriptionEnd, locale),
                        strong: (c) => <strong>{c}</strong>,
                      })}
                    </p>
                    <button
                      type="button"
                      disabled={cancelBusy}
                      onClick={() => void resumeSubscriptionAction()}
                      className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
                    >
                      {cancelBusy ? t("resuming") : t("resumeSubscription")}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {t.rich("renewsOn", {
                        date: fmtDate(profile.subscriptionEnd, locale),
                        strong: (c) => <strong>{c}</strong>,
                      })}
                    </p>
                    <button
                      type="button"
                      disabled={cancelBusy}
                      onClick={() => void cancelSubscription()}
                      className="rounded-md border border-[var(--color-danger)]/50 px-3 py-1.5 text-sm text-[var(--color-danger)] transition hover:border-[var(--color-danger)] disabled:opacity-50"
                    >
                      {cancelBusy ? t("canceling") : t("cancelSubscription")}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-sm text-[var(--color-text-secondary)]">{t("upgradePitch")}</p>
                <Link href="/pricing" className="shrink-0 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-accent-strong)]">
                  {t("goPro")}
                </Link>
              </div>
            )}
          </section>

          {/* Cambiar nombre */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t("publicName")}</h2>
            <input
              type="text"
              value={displayName}
              minLength={3}
              maxLength={30}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t("publicNamePlaceholder")}
              className="mt-3 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel-2)] px-3 py-2.5 text-sm"
            />
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{t("publicNameHint")}</p>
            <button
              type="button"
              disabled={busy || displayName.trim().length < 3}
              onClick={() => void save()}
              className="mt-3 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? t("saving") : t("save")}
            </button>
          </section>

          {msg && (
            <p className={`text-sm ${msg.kind === "ok" ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]"}`}>{msg.text}</p>
          )}

          {/* Soporte y derechos RGPD (acceso, supresión, etc.) */}
          <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t("support")}</h2>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">{t("supportText")}</p>
            <a
              href={`mailto:wachimingoyt.hd@gmail.com?subject=${encodeURIComponent(t("supportMailSubject"))}`}
              className="mt-3 inline-block rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm transition hover:border-[var(--color-accent)]"
            >
              {t("contactSupport")}
            </a>
          </section>

          {/* Zona de peligro: borrado de cuenta */}
          <section className="rounded-2xl border border-[var(--color-danger)]/40 bg-[var(--color-bg-panel)] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-danger)]">{t("dangerZone")}</h2>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">{t("deleteAccountText")}</p>
            <button
              type="button"
              disabled={deleteBusy}
              onClick={() => void deleteAccount()}
              className="mt-3 rounded-md border border-[var(--color-danger)]/50 px-3 py-1.5 text-sm text-[var(--color-danger)] transition hover:border-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 disabled:opacity-50"
            >
              {deleteBusy ? t("deleting") : t("deleteAccount")}
            </button>
          </section>

          {/* Cerrar sesión */}
          <button
            type="button"
            onClick={() => void signOutUser()}
            className="w-full rounded-md border border-[var(--color-border-strong)] px-4 py-2.5 text-sm font-medium transition hover:border-[var(--color-accent)]"
          >
            {tAuth("signOut")}
          </button>
        </div>
      )}
    </main>
  );
}
