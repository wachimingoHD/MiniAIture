"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import PageHeader from "@/components/ui/PageHeader";
import {
  getCurrentIdToken,
  signInWithGoogle,
  signOutUser,
  subscribeToAuthState,
} from "@/lib/auth/firebase-client";

interface PricingInfo {
  credits: {
    freeDaily: number;
    proDaily: number;
    proMonthly: number;
  };
  proPrice: {
    unitAmountMinor: number | null;
    currency: string;
    interval: "day" | "week" | "month" | "year" | null;
    intervalCount: number | null;
  } | null;
}

interface BillingStatus {
  plan?: "free" | "pro";
  subscriptionStatus?: string | null;
}

interface SyncPayload {
  ok?: boolean;
  error?: string;
  reason?: string;
}

const TRANSIENT_SYNC_REASONS = new Set(["missing_subscription", "checkout_not_complete"]);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearCheckoutQueryParams(): void {
  const params = new URLSearchParams(window.location.search);
  params.delete("billing");
  params.delete("session_id");
  const nextQuery = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`,
  );
}

function formatProPrice(
  info: PricingInfo | null,
  locale: string,
  fallback: string,
  perMonth: string,
  perYear: string,
): string {
  const price = info?.proPrice;
  if (!price || price.unitAmountMinor == null) return fallback;

  const amount = price.unitAmountMinor / 100;
  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: price.currency.toUpperCase(),
  }).format(amount);
  const period = price.interval === "year" ? perYear : perMonth;
  return `${formatted} / ${period}`;
}

export default function PricingPage() {
  const t = useTranslations("pricing");
  const tAuth = useTranslations("auth");
  const locale = useLocale();
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [plan, setPlan] = useState<"free" | "pro" | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [pricingInfo, setPricingInfo] = useState<PricingInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkoutSyncedRef = useRef(false);
  const alreadyPro = plan === "pro" && (subscriptionStatus === "active" || subscriptionStatus === "trialing");

  const refreshBillingStatus = useCallback(async (token: string): Promise<BillingStatus | null> => {
    try {
      const res = await fetch("/api/billing/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as BillingStatus;
      setPlan(payload.plan ?? null);
      setSubscriptionStatus(payload.subscriptionStatus ?? null);
      return payload;
    } catch {
      // ignore non-critical status read errors
      return null;
    }
  }, []);

  const syncCheckoutIfNeeded = useCallback(async (token: string): Promise<void> => {
    if (checkoutSyncedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (params.get("billing") !== "success" || !sessionId) return;

    checkoutSyncedRef.current = true;
    try {
      let lastPayload: SyncPayload | null = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await fetch("/api/billing/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sessionId }),
        });
        const payload = (await res.json().catch(() => ({}))) as SyncPayload;
        lastPayload = payload;
        if (res.ok) {
          clearCheckoutQueryParams();
          setError(null);
          return;
        }

        const reason = payload.reason ?? "";
        if (!TRANSIENT_SYNC_REASONS.has(reason)) break;

        const status = await refreshBillingStatus(token);
        if (status?.plan === "pro" && (status.subscriptionStatus === "active" || status.subscriptionStatus === "trialing")) {
          clearCheckoutQueryParams();
          setError(null);
          return;
        }

        if (attempt < 4) await wait(1200);
      }

      const status = await refreshBillingStatus(token);
      if (status?.plan === "pro" && (status.subscriptionStatus === "active" || status.subscriptionStatus === "trialing")) {
        clearCheckoutQueryParams();
        setError(null);
        return;
      }

      const reason = lastPayload?.reason ?? "";
      setError(TRANSIENT_SYNC_REASONS.has(reason) ? t("syncPending") : lastPayload?.error ?? t("syncFailed"));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [refreshBillingStatus, t]);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState(async (user) => {
      if (!user) {
        setAuthEmail(null);
        setAuthToken(null);
        setPlan(null);
        setSubscriptionStatus(null);
        return;
      }
      setAuthEmail(user.email ?? "signed-in-user");
      const token = await user.getIdToken();
      setAuthToken(token);
      await syncCheckoutIfNeeded(token);
      await refreshBillingStatus(token);
    });
    return () => unsubscribe();
  }, [refreshBillingStatus, syncCheckoutIfNeeded]);

  useEffect(() => {
    let alive = true;
    void fetch("/api/billing/pricing")
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as PricingInfo;
      })
      .then((payload) => {
        if (alive && payload) setPricingInfo(payload);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function startCheckout(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const token = authToken ?? (await getCurrentIdToken());
      if (!token) {
        setError(t("signInRequired"));
        return;
      }
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ locale }),
      });
      const payload = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !payload.url) {
        setError(payload.error ?? t("checkoutFailed"));
        return;
      }
      window.location.href = payload.url;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[980px] px-4 py-8 md:px-8 md:py-12">
      <PageHeader subtitle={t("headerSubtitle")} />
      <div className="mt-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {t("subtitle")}
        </p>
      </div>

      <section className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4">
        {authEmail ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <p className="text-[var(--color-text-primary)]">{authEmail}</p>
              <p className="text-[var(--color-text-muted)]">
                {t("planLabel", { plan: plan ? plan.toUpperCase() : t("planUnknown") })}
                {subscriptionStatus ? t("subscriptionSuffix", { status: subscriptionStatus }) : ""}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void signOutUser()}
              className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
            >
              {tAuth("signOut")}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--color-text-muted)]">
              {t("signInToSubscribe")}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const user = await signInWithGoogle();
                  const token = await user.getIdToken();
                  setAuthToken(token);
                  setAuthEmail(user.email ?? "signed-in-user");
                  await syncCheckoutIfNeeded(token);
                  await refreshBillingStatus(token);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
            >
              {tAuth("signIn")}
            </button>
          </div>
        )}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-5">
          <h2 className="text-lg font-semibold">{t("free")}</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t("freePrice")}</p>
          <ul className="mt-4 space-y-2 text-sm text-[var(--color-text-secondary)]">
            <li>{t("freeFeature1", { daily: pricingInfo?.credits.freeDaily ?? 100 })}</li>
            <li>{t("freeFeature2")}</li>
            <li>{t("freeFeature3")}</li>
            <li>{t("freeFeature4")}</li>
          </ul>
        </article>

        <article className="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-5">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{t("pro")}</h2>
          <p className="mt-3 font-display text-3xl font-extrabold leading-none text-[var(--color-accent-strong)] md:text-4xl">
            {formatProPrice(pricingInfo, locale, t("proPriceFallback"), t("perMonth"), t("perYear"))}
          </p>
          <ul className="mt-4 space-y-2 text-sm text-[var(--color-text-secondary)]">
            <li>
              {t("proFeature1", {
                daily: pricingInfo?.credits.proDaily ?? 550,
                monthly: pricingInfo?.credits.proMonthly ?? 3000,
              })}
            </li>
            <li>{t("proFeature2")}</li>
            <li>{t("proFeature3")}</li>
            <li>{t("proFeature4")}</li>
            <li>{t("proFeature5")}</li>
          </ul>
          <button
            type="button"
            disabled={busy || !authEmail || alreadyPro}
            onClick={() => void startCheckout()}
            className="mt-5 w-full rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {alreadyPro ? t("alreadyAcquired") : busy ? t("openingCheckout") : t("subscribeToPro")}
          </button>
          {!authEmail && (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              {t("signInFirst")}
            </p>
          )}
        </article>
      </section>

      {error && (
        <div className="mt-6 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-text-secondary)]">
          <strong className="text-[var(--color-danger)]">{t("errorLabel")}</strong> {error}
        </div>
      )}
    </main>
  );
}
