// Backfill puntual: registra la comisión de la última factura pagada de los
// usuarios atribuidos a un código (lo que el webhook invoice.payment_succeeded
// hará solo en producción). Idempotente: mismo id de doc = id de factura.
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const code = (process.argv[2] ?? "R241").toUpperCase();
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);
initializeApp({ credential: cert(JSON.parse(env.FIREBASE_ADMIN_CREDENTIALS)) });
const db = getFirestore();
const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const affSnap = await db.collection("affiliates").doc(code).get();
if (!affSnap.exists) { console.error(`No existe affiliates/${code}`); process.exit(1); }
const pct = affSnap.data().commissionPct ?? 10;

const users = await db.collection("users").where("affiliate.referredBy", "==", code).get();
if (users.empty) { console.log("Ningún usuario atribuido a", code); process.exit(0); }

for (const u of users.docs) {
  const subId = u.data().stripeSubscriptionId;
  if (!subId) continue;
  const invoices = await stripe.invoices.list({ subscription: subId, status: "paid", limit: 12 });
  for (const inv of invoices.data) {
    const commissionMinor = Math.round((inv.amount_paid * pct) / 100);
    try {
      await db.collection("affiliateCommissions").doc(inv.id).create({
        code, uid: u.id, invoiceId: inv.id,
        amountPaidMinor: inv.amount_paid, commissionMinor, commissionPct: pct,
        currency: inv.currency, paidOut: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      await affSnap.ref.set(
        { totalPaidMonths: FieldValue.increment(1), totalEarnedMinor: FieldValue.increment(commissionMinor) },
        { merge: true },
      );
      console.log(`Asiento creado: ${inv.id} | pagado=${inv.amount_paid} | comisión=${commissionMinor}`);
    } catch {
      console.log(`Ya existía: ${inv.id} (no se duplica)`);
    }
  }
}

const after = (await affSnap.ref.get()).data();
console.log(`\naffiliates/${code} → totalPaidMonths=${after.totalPaidMonths} | totalEarnedMinor=${after.totalEarnedMinor} | activeReferrals=${after.activeReferrals}`);
