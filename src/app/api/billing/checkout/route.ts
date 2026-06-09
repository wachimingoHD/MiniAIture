import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { readBearerToken } from "@/lib/server/request";
import { getOrCreateUserDocument } from "@/lib/firestore/users";
import { createProCheckoutSession, sanitizeAffiliateCode } from "@/lib/stripe/client";
import { safeErrorMessage } from "@/lib/server/errors";
import { routing, type Locale } from "@/i18n/routing";

export const runtime = "nodejs";

function localeFromBody(body: unknown): Locale {
  const candidate =
    body && typeof body === "object" && typeof (body as { locale?: unknown }).locale === "string"
      ? (body as { locale: string }).locale
      : "";
  return routing.locales.includes(candidate as Locale) ? (candidate as Locale) : routing.defaultLocale;
}

function appOrigin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
}

function pricingReturnUrl(req: NextRequest, locale: Locale, billing: "success" | "cancelled"): string {
  const url = new URL(`/${locale}/pricing`, appOrigin(req));
  url.searchParams.set("billing", billing);
  return url.toString();
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = readBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "Missing Authorization header." }, { status: 401 });
  }
  const user = await verifyIdToken(token);
  if (!user || !user.email) {
    return NextResponse.json({ error: "Invalid token or missing email in auth profile." }, { status: 401 });
  }

  const db = adminFirestore();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin not configured. Set FIREBASE_ADMIN_CREDENTIALS." },
      { status: 500 },
    );
  }

  const userDoc = await getOrCreateUserDocument(db, { uid: user.uid, email: user.email });

  // Refuse to issue a second checkout when the user already has an active Pro
  // subscription. Without this, clicking "Subscribe" twice produced two
  // parallel subscriptions on the same Firebase user (and the second one's
  // webhook simply overwrote the first), leaving the user double-charged.
  if (userDoc.plan === "pro" && userDoc.subscriptionStatus === "active") {
    return NextResponse.json(
      { error: "You already have an active Pro subscription." },
      { status: 409 },
    );
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const affiliateCode = sanitizeAffiliateCode(
    body && typeof body === "object" ? (body as { affiliateCode?: unknown }).affiliateCode : undefined,
  );
  const locale = localeFromBody(body);

  try {
    const url = await createProCheckoutSession({
      uid: user.uid,
      email: user.email,
      existingCustomerId: userDoc.stripeCustomerId,
      affiliateCode,
      successUrl: pricingReturnUrl(req, locale, "success"),
      cancelUrl: pricingReturnUrl(req, locale, "cancelled"),
    });
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, "checkout_failed") },
      { status: 500 },
    );
  }
}
