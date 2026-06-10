// Diagnóstico de configuración de Stripe: valida que la clave secreta y el
// price id funcionan juntos (mismo modo test/live) antes de culpar al deploy.
//
// Uso: node scripts/check-stripe.mjs sk_live_... price_...
//      (pega los MISMOS valores que tienes en Vercel Production)

import Stripe from "stripe";

const [secretKey, priceId] = process.argv.slice(2);

if (!secretKey || !priceId) {
  console.error("Uso: node scripts/check-stripe.mjs <STRIPE_SECRET_KEY> <STRIPE_PRO_PRICE_ID>");
  process.exit(1);
}

const stripe = new Stripe(secretKey.trim());

try {
  const account = await stripe.accounts.retrieve();
  const mode = secretKey.startsWith("sk_live") || secretKey.startsWith("rk_live") ? "LIVE" : "TEST";
  console.log(`✅ Clave secreta válida (cuenta: ${account.id}, modo ${mode})`);
} catch (err) {
  console.error(`❌ La CLAVE SECRETA no sirve: ${err.message}`);
  console.error("   → Vuelve a copiarla de Stripe (modo Live) → Developers → API keys → Secret key.");
  process.exit(1);
}

try {
  const price = await stripe.prices.retrieve(priceId.trim());
  const amount = (price.unit_amount / 100).toFixed(2);
  const interval = price.recurring ? `cada ${price.recurring.interval_count ?? 1} ${price.recurring.interval}` : "PAGO ÚNICO (¡debería ser recurrente!)";
  console.log(`✅ Price encontrado: ${amount} ${price.currency.toUpperCase()} ${interval}`);
  console.log(`   livemode: ${price.livemode} | activo: ${price.active}`);
  if (!price.active) console.warn("⚠️  El precio está ARCHIVADO en Stripe: actívalo o crea otro.");
  if (!price.recurring) console.warn("⚠️  El precio NO es recurrente: el checkout en modo suscripción fallará.");
} catch (err) {
  console.error(`❌ El PRICE ID no existe con esta clave: ${err.message}`);
  console.error("   → Causas típicas: copiaste el prod_... en vez del price_..., o el price es del otro modo (test/live).");
  process.exit(1);
}

console.log("\n✅ Combinación clave+price correcta. Si la web sigue fallando, el problema es que Vercel no tiene estos valores aplicados → haz Redeploy.");
