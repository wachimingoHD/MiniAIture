// Regala PRO a un email durante X meses, sin Stripe y sin cobro.
//
// Uso:
//   node scripts/grant-pro.mjs correo@ejemplo.com [meses]   (meses default: 1)
//
// Cómo funciona:
// - Si el email YA tiene cuenta: escribe en su doc de `users` un PRO "de
//   cortesía" (plan pro, créditos PRO, subscriptionEnd = ahora + meses) SIN
//   stripeSubscriptionId. La app degrada automáticamente a FREE cuando pasa
//   esa fecha (lógica en getOrCreateUserDocument), así que NO es permanente.
// - Si el email NO tiene cuenta aún: deja el regalo en `pendingGrants/{email}`
//   y se aplica solo la primera vez que esa persona inicie sesión.
// - Si el usuario tiene una suscripción de PAGO activa, no toca nada (aborta).
//
// El usuario lo vive exactamente como un PRO normal: mismos créditos diarios y
// mensuales, mismas opciones. Al caducar pasa a FREE sin que se cobre nada.

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const [, , rawEmail, rawMonths] = process.argv;
if (!rawEmail || !rawEmail.includes("@")) {
  console.error("Uso: node scripts/grant-pro.mjs correo@ejemplo.com [meses]");
  process.exit(1);
}
const email = rawEmail.trim().toLowerCase();
const months = Math.max(1, Math.floor(Number(rawMonths) || 1));

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const PRO_DAILY = Number(env.PRO_DAILY_CREDITS) || 550;
const PRO_MONTHLY = Number(env.PRO_MONTHLY_CREDITS) || 3000;

initializeApp({ credential: cert(JSON.parse(env.FIREBASE_ADMIN_CREDENTIALS)) });
const db = getFirestore();

// ¿Existe ya la cuenta?
let uid = null;
try {
  uid = (await getAuth().getUserByEmail(email)).uid;
} catch {
  uid = null;
}

const now = Date.now();
const end = new Date(now + months * 30 * 24 * 60 * 60 * 1000).toISOString();

if (!uid) {
  await db.collection("pendingGrants").doc(email).set({
    months,
    createdAt: new Date(now).toISOString(),
  });
  console.log(`${email} aún no tiene cuenta.`);
  console.log(`Regalo guardado en pendingGrants: ${months} mes(es) de PRO se aplicarán en su primer inicio de sesión.`);
  process.exit(0);
}

const ref = db.collection("users").doc(uid);
const snap = await ref.get();
const existing = snap.exists ? snap.data() : null;

if (existing?.stripeSubscriptionId && existing?.subscriptionStatus !== "canceled") {
  console.error(`ABORTADO: ${email} tiene una suscripción de PAGO (${existing.stripeSubscriptionId}). No se pisa.`);
  process.exit(1);
}

await ref.set(
  {
    plan: "pro",
    subscriptionStatus: "active",
    subscriptionStart: new Date(now).toISOString(),
    subscriptionEnd: end, // sin stripeSubscriptionId → caduca solo en esta fecha
    cancelAtPeriodEnd: false,
    credits: {
      daily: PRO_DAILY,
      dailyResetAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      monthly: PRO_MONTHLY,
      monthlyResetAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  },
  { merge: true },
);

console.log(`PRO regalado a ${email} (uid ${uid}):`);
console.log(`- ${months} mes(es), caduca el ${end}`);
console.log(`- ${PRO_DAILY} créditos/día + ${PRO_MONTHLY}/mes`);
console.log("Al caducar pasará a FREE automáticamente, sin cobros.");
