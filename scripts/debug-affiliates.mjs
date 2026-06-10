// Diagnóstico de códigos de creador: lista los docs de `affiliates` en
// Firestore y los promotion codes en Stripe, para ver qué existe de verdad.
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

initializeApp({ credential: cert(JSON.parse(env.FIREBASE_ADMIN_CREDENTIALS)) });
const db = getFirestore();

console.log("=== Firestore: colección `affiliates` ===");
const snap = await db.collection("affiliates").get();
if (snap.empty) console.log("(vacía)");
for (const doc of snap.docs) {
  const d = doc.data();
  console.log(`- id=${doc.id} | code=${d.code} | active=${d.active} | promo=${d.stripePromotionCodeId} | commissionPct=${d.commissionPct} | creator=${d.creatorName}`);
}

console.log("\n=== Stripe: promotion codes ===");
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const promos = await stripe.promotionCodes.list({ limit: 20 });
if (promos.data.length === 0) console.log("(ninguno)");
for (const p of promos.data) {
  const coupon = p.promotion?.coupon;
  console.log(`- ${p.code} | ${p.id} | activo=${p.active} | coupon=${typeof coupon === "string" ? coupon : coupon?.id ?? "?"}`);
}
