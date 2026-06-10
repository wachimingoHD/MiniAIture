// Alta de un código de creador, de punta a punta:
//   1. Crea un Coupon en Stripe (descuento recurrente, duración "forever").
//   2. Crea el Promotion Code en Stripe con el código visible.
//   3. Crea el doc en Firestore `affiliates/{CODE}` que usa el checkout.
//
// Uso:
//   node scripts/create-creator-code.mjs CODIGO "Nombre del creador" [opciones]
// Opciones:
//   --percent 10      Descuento % (default 10). Excluyente con --amount-off.
//   --amount-off 200  Descuento fijo en céntimos de EUR (ej. 200 = 2,00 €).
//   --commission 10   % de comisión del creador (default 10).
//
// OJO: usa las claves de .env.local. Para producción, ejecútalo con las claves
// LIVE en el entorno (o edita .env.local temporalmente y revierte).

import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// ---- args ----
const [, , rawCode, creatorName, ...rest] = process.argv;
if (!rawCode || !creatorName) {
  console.error('Uso: node scripts/create-creator-code.mjs CODIGO "Nombre" [--percent 10 | --amount-off 200] [--commission 10]');
  process.exit(1);
}
const code = rawCode.trim().toUpperCase();
// Stripe solo admite letras, números y guiones en promotion codes (sin "_").
if (!/^[A-Z0-9-]{2,64}$/.test(code)) {
  console.error("Código inválido: solo letras/números/guiones, 2-64 caracteres.");
  process.exit(1);
}
function flag(name, def) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? Number(rest[i + 1]) : def;
}
const percent = flag("percent", null);
const amountOff = flag("amount-off", null);
const commission = flag("commission", 10);
const discount = amountOff
  ? { amount_off: amountOff, currency: "eur" }
  : { percent_off: percent ?? 10 };

// ---- env (.env.local) ----
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

// Para apuntar a LIVE sin tocar .env.local:
//   $env:STRIPE_SECRET_KEY="sk_live_..."; node scripts/create-creator-code.mjs ...
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY);
initializeApp({ credential: cert(JSON.parse(env.FIREBASE_ADMIN_CREDENTIALS)) });
const db = getFirestore();

// ---- 1) coupon (uno por código, duración forever = descuenta cada mes) ----
const couponId = `creator-${code.toLowerCase()}`;
let coupon;
try {
  coupon = await stripe.coupons.retrieve(couponId);
  console.log(`Coupon ya existía: ${coupon.id}`);
} catch {
  coupon = await stripe.coupons.create({
    id: couponId,
    duration: "forever",
    name: `Código de creador ${code}`,
    ...discount,
  });
  console.log(`Coupon creado: ${coupon.id}`);
}

// ---- 2) promotion code (solo se reutiliza si sigue ACTIVO: al borrar un
// cupón, Stripe desactiva sus códigos y hay que crear uno nuevo) ----
const existing = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
let promo = existing.data[0];
if (promo) {
  console.log(`Promotion code ya existía: ${promo.id} (${promo.code})`);
} else {
  promo = await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: coupon.id },
    code,
  });
  console.log(`Promotion code creado: ${promo.id} (${promo.code})`);
}

// ---- 3) doc en Firestore ----
await db.collection("affiliates").doc(code).set(
  {
    code,
    creatorName,
    stripePromotionCodeId: promo.id,
    commissionPct: commission,
    active: true,
    createdAt: new Date().toISOString(),
  },
  { merge: true },
);
console.log(`Firestore affiliates/${code} listo.`);
console.log(`\nLink para el creador: https://miniaitura.com/es/pricing?ref=${code}`);
