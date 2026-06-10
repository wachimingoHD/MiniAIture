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
import { FieldValue } from "firebase-admin/firestore";

// Stripe responde "resource_missing" sobre `customer` cuando el id guardado
// pertenece al otro modo (un cus_ de test usado con claves live, o viceversa).
function isStaleCustomerError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; param?: unknown };
  return e.code === "resource_missing" && e.param === "customer";
}

// Mismo caso para promotion codes: el doc de `affiliates` guarda un promo_ de
// test que no existe en live. Stripe lo reporta como resource_missing sobre
// el parámetro discounts[0][promotion_code].
function isStalePromotionCodeError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; param?: unknown };
  return (
    e.code === "resource_missing" &&
    typeof e.param === "string" &&
    e.param.includes("promotion_code")
  );
}

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

  const checkoutInput = {
    uid: user.uid,
    email: user.email,
    affiliateCode,
    successUrl: pricingReturnUrl(req, locale, "success"),
    cancelUrl: pricingReturnUrl(req, locale, "cancelled"),
  };

  // Migración test→live: Firestore puede conservar ids de TEST (un customer en
  // users/{uid} o un promotion code en affiliates/{code}) que no existen en
  // live. En vez de fallar con un checkout_failed mudo, curamos el id obsoleto
  // que señale Stripe y reintentamos (máx. 3 intentos: ambos pueden estar
  // obsoletos a la vez para un usuario de la fase de test).
  let existingCustomerId = userDoc.stripeCustomerId;
  for (let attempt = 1; ; attempt++) {
    try {
      const url = await createProCheckoutSession({
        ...checkoutInput,
        existingCustomerId,
        promotionCodeId,
      });
      return NextResponse.json({ url });
    } catch (err) {
      if (attempt < 3 && existingCustomerId && isStaleCustomerError(err)) {
        console.warn(
          `Stale Stripe customer ${existingCustomerId} for uid ${user.uid}; clearing and retrying checkout.`,
        );
        await db
          .collection("users")
          .doc(user.uid)
          .set({ stripeCustomerId: FieldValue.delete() }, { merge: true });
        existingCustomerId = undefined;
        continue;
      }

      if (attempt < 3 && affiliateCode && promotionCodeId && isStalePromotionCodeError(err)) {
        console.warn(
          `Stale promotion code ${promotionCodeId} for affiliate ${affiliateCode}; resolving by code text.`,
        );
        let resolved: string | undefined;
        try {
          resolved = (await findActivePromotionCodeByCode(affiliateCode)) ?? undefined;
        } catch {
          resolved = undefined;
        }
        if (!resolved || resolved === promotionCodeId) {
          // El código no existe activo en este modo de Stripe: mejor avisar
          // que cobrar el precio completo en silencio.
          return NextResponse.json(
            { error: "invalid_affiliate_code", reason: "invalid_affiliate_code" },
            { status: 400 },
          );
        }
        await db
          .collection("affiliates")
          .doc(affiliateCode)
          .set({ stripePromotionCodeId: resolved }, { merge: true });
        promotionCodeId = resolved;
        continue;
      }

      console.error("Checkout session creation failed", err);
      return NextResponse.json(
        { error: safeErrorMessage(err, "checkout_failed") },
        { status: 500 },
      );
    }
  }
}
