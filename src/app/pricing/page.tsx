"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getCurrentIdToken,
  signInWithGoogle,
  signOutUser,
  subscribeToAuthState,
} from "@/lib/auth/firebase-client";

export default function PricingPage() {
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [plan, setPlan] = useState<"free" | "pro" | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alreadyPro = plan === "pro" && (subscriptionStatus === "active" || subscriptionStatus === "trialing");

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
      await refreshBillingStatus(token);
    });
    return () => unsubscribe();
  }, []);

  async function refreshBillingStatus(token: string): Promise<void> {
    try {
      const res = await fetch("/api/billing/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const payload = (await res.json()) as {
        plan?: "free" | "pro";
        subscriptionStatus?: string | null;
      };
      setPlan(payload.plan ?? null);
      setSubscriptionStatus(payload.subscriptionStatus ?? null);
    } catch {
      // ignore non-critical status read errors
    }
  }

  async function startCheckout(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const token = authToken ?? (await getCurrentIdToken());
      if (!token) {
        setError("Sign in is required before starting checkout.");
        return;
      }
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const payload = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !payload.url) {
        setError(payload.error ?? "Unable to create checkout session.");
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
      <header className="flex items-center justify-between border-b border-[var(--color-border)] pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pricing</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Choose the plan that fits your thumbnail workflow.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
            Back to app
          </Link>
          <Link href="/gallery" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
            Gallery
          </Link>
        </div>
      </header>

      <section className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4">
        {authEmail ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <p className="text-[var(--color-text-primary)]">{authEmail}</p>
              <p className="text-[var(--color-text-muted)]">
                Plan: {plan ? plan.toUpperCase() : "unknown"}
                {subscriptionStatus ? ` - Subscription: ${subscriptionStatus}` : ""}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void signOutUser()}
              className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--color-text-muted)]">
              Sign in to start your Pro subscription.
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
                  await refreshBillingStatus(token);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)] disabled:opacity-50"
            >
              Sign in
            </button>
          </div>
        )}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-5">
          <h2 className="text-lg font-semibold">Free</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">EUR 0 / month</p>
          <ul className="mt-4 space-y-2 text-sm text-[var(--color-text-secondary)]">
            <li>100 daily credits</li>
            <li>512px output</li>
            <li>Gemini Flex only</li>
            <li>No server gallery</li>
          </ul>
        </article>

        <article className="rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-5">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Pro</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Subscription via Stripe
          </p>
          <ul className="mt-4 space-y-2 text-sm text-[var(--color-text-secondary)]">
            <li>More daily and monthly credits</li>
            <li>Higher resolutions + upscale</li>
            <li>Persistent server gallery</li>
            <li>Automatic renewals handled by Stripe</li>
          </ul>
          <button
            type="button"
            disabled={busy || !authEmail || alreadyPro}
            onClick={() => void startCheckout()}
            className="mt-5 w-full rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {alreadyPro ? "Already acquired" : busy ? "Opening checkout..." : "Subscribe to Pro"}
          </button>
          {!authEmail && (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Sign in first to enable checkout.
            </p>
          )}
        </article>
      </section>

      {error && (
        <div className="mt-6 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-sm text-[var(--color-text-secondary)]">
          <strong className="text-[var(--color-danger)]">Error:</strong> {error}
        </div>
      )}
    </main>
  );
}
