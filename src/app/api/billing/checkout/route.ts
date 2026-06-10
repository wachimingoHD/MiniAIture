import { NextRequest, NextResponse } from "next/server";
import { adminFirestore, verifyIdToken } from "@/lib/auth/firebase-admin";
import { readBearerToken } from "@/lib/server/request";
import { getOrCreateUserDocument } from "@/lib/firestore/users";
import {
  createProCheckoutSession,
  findActivePromotionCodeByCode,
  findOpenSubscription,
} from "@/lib/stripe/client";
import { getActiveAffiliate, normalizeAffiliateCode } from "@/lib/firestore/affiliates";
import { applyStripeSubscriptionToUser } from "@/lib/stripe/subscription-sync";
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

  // Refuse to issue a second checkout when the user already has an open Pro
  // subscription. Without this, clicking "Subscribe" twice produced two
  // parallel subscriptions on the same Firebase user (and the second one's
  // webhook simply overwrote the first), leaving the user double-charged.
  // "Open" = anything not definitively over (active, trialing, past_due,
  // incomplete...), so a past_due user can't stack a second subscription.
  // Un PRO de cortesía (sin stripeSubscriptionId, regalado por script) SÍ
  // puede comprar: pasaría a ser un PRO de pago normal.
  if (
    userDoc.plan === "pro" &&
    userDoc.subscriptionStatus !== "canceled" &&
    userDoc.stripeSubscriptionId
  ) {
    return NextResponse.json(
      { error: "You already have an active Pro subscription." },
      { status: 409 },
    );
  }

  // Firestore can drift (missed webhook, manual edits). Ask Stripe — the
  // source of truth — whether this customer already has an open subscription,
  // and self-heal the user doc if so.
  if (userDoc.stripeCustomerId) {
    try {
      const openSub = await findOpenSubscription(userDoc.stripeCustomerId);
      if (openSub) {
        await applyStripeSubscriptionToUser(db, openSub, user.uid);
        return NextResponse.json(
          { error: "You already have an active Pro subscription." },
          { status: 409 },
        );
      }
    } catch (err) {
      console.warn("Could not verify open subscriptions in Stripe", safeErrorMessage(err, "stripe_list_failed"));
    }
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const locale = localeFromBody(body);

  // Código de creador: se valida contra la colección `affiliates` y, si es
  // válido, su Promotion Code de Stripe aplica el descuento real en el
  // Checkout. Si el usuario escribió un código que no existe, se lo decimos
  // en vez de cobrarle el precio completo en silencio.
  const rawAffiliate =
    body && typeof body === "object" ? (body as { affiliateCode?: unknown }).affiliateCode : undefined;
  let affiliateCode: string | undefined;
  let promotionCodeId: string | undefined;
  if (typeof rawAffiliate === "string" && rawAffiliate.trim()) {
    const normalized = normalizeAffiliateCode(rawAffiliate);
    const affiliate = normalized ? await getActiveAffiliate(db, normalized) : null;
    if (!affiliate) {
      return NextResponse.json(
        { error: "invalid_affiliate_code", reason: "invalid_affiliate_code" },
        { status: 400 },
      );
    }
    affiliateCode = affiliate.code;
    promotionCodeId = affiliate.stripePromotionCodeId || undefined;

    // Robustez ante docs creados a mano: si el id guardado no es un promotion
    // code de Stripe ("promo_..."), lo resolvemos por su texto y auto-reparamos
    // el doc. Si tampoco existe activo en Stripe, mejor avisar que cobrar el
    // precio completo en silencio.
    if (!promotionCodeId?.startsWith("promo_")) {
      try {
        promotionCodeId = (await findActivePromotionCodeByCode(affiliate.code)) ?? undefined;
      } catch {
        promotionCodeId = undefined;
      }
      if (!promotionCodeId) {
        return NextResponse.json(
          { error: "invalid_affiliate_code", reason: "invalid_affiliate_code" },
          { status: 400 },
        );
      }
      await db
        .collection("affiliates")
        .doc(affiliate.code)
        .set({ stripePromotionCodeId: promotionCodeId }, { merge: true });
    }
  }

  try {
    const url = await createProCheckoutSession({
      uid: user.uid,
      email: user.email,
      existingCustomerId: userDoc.stripeCustomerId,
      affiliateCode,
      promotionCodeId,
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
