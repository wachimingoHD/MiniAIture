=== CREAR CODIGO DE CREADOR (EN PRODUCCION / LIVE) ===
(en PowerShell, dentro de la carpeta MiniAItures)

$env:STRIPE_SECRET_KEY = "sk_live_AQUI_TU_CLAVE"
node scripts/create-creator-code.mjs CODIGO "Nombre del creador" --amount-off 200
Remove-Item Env:\STRIPE_SECRET_KEY

  --amount-off 200    descuento fijo de 2,00 EUR/mes (21,99 -> 19,99)
  --percent 10        descuento del 10% (alternativa al fijo)
  --commission 15     comision del creador al 15% (default 10)

Ejemplo real:
$env:STRIPE_SECRET_KEY = "sk_live_..."
node scripts/create-creator-code.mjs WACHI "Wachimingo" --amount-off 200
Remove-Item Env:\STRIPE_SECRET_KEY

OJO: sin la linea de $env:STRIPE_SECRET_KEY el codigo se crea
en modo PRUEBA y no funciona en la web real.

=== REGALAR PRO GRATIS (sin Stripe, funciona tal cual) ===

node scripts/grant-pro.mjs correo@gmail.com 3
  (3 = meses; si no pones numero, 1 mes)

=== COMPROBAR QUE LAS CLAVES DE STRIPE ESTAN BIEN ===

node scripts/check-stripe.mjs sk_live_TU_CLAVE price_TU_PRICE_ID
  (pasa los valores que tengas en Vercel; te dice cual falla)