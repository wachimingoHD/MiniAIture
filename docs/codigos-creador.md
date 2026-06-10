# Códigos de creador — cómo funcionan y cómo operarlos

## El flujo completo

1. **Alta del creador** (tú, una vez): `node scripts/create-creator-code.mjs WACHI "Wachimingo"`.
   Crea el cupón en Stripe (descuento *recurrente*, cada mes), el promotion code y el doc
   `affiliates/WACHI` en Firestore. Por defecto −10% y 10% de comisión; se puede usar
   `--amount-off 200` para descuento fijo de 2,00 € (recomendado si el precio es 21,99 €:
   el cliente ve 19,99 €).
2. **El creador comparte** su link: `https://miniaitura.com/es/pricing?ref=WACHI`
   (el código se autorrellena) o simplemente dice el código.
3. **El comprador** ve el campo "Código de creador" en /pricing; al pagar, el descuento se
   aplica solo en el Checkout de Stripe. Si el código no existe, se le avisa antes de pagar.
4. **Atribución automática**: el código viaja en la metadata de la suscripción de Stripe y
   queda fijado en el doc del usuario (`affiliate.referredBy`).
5. **Comisión automática**: CADA factura pagada (la primera y todas las renovaciones) escribe
   un asiento en la colección `affiliateCommissions`:
   `{ code, uid, invoiceId, amountPaidMinor, commissionMinor, commissionPct, currency, paidOut: false }`.
   Es idempotente (id = id de factura): los reintentos de webhook no duplican.

## Cómo liquidar a los creadores (mensual, manual)

En la consola de Firestore, colección `affiliateCommissions`, filtra `code == WACHI` y
`paidOut == false`, suma `commissionMinor` (céntimos), haz el pago (Bizum/transferencia/PayPal)
y marca esos docs `paidOut: true`. Cuando haya volumen, esto se puede automatizar con
Stripe Connect (el campo `stripeConnectId` ya está reservado en el doc del afiliado).

## Detalles de diseño

- El código se introduce en NUESTRA página, no en la de Stripe: así la atribución es exacta.
  Si el comprador no escribe código, el Checkout de Stripe muestra su campo nativo de códigos
  como red de seguridad (esos pagos aplican descuento pero NO generan asiento de comisión).
- Desactivar un creador: poner `active: false` en `affiliates/{CODE}` (deja de aceptarse en
  nuevas compras) y desactivar el promotion code en Stripe (corta también las renovaciones
  futuras de nuevos clientes; las suscripciones ya creadas conservan su descuento "forever").
- La comisión se calcula sobre lo pagado IVA incluido (`amount_paid` de la factura). Si se
  quiere sobre la base imponible, dividir por 1,21 al liquidar.
- Test end-to-end en modo test de Stripe: alta con el script, compra con tarjeta 4242...,
  verificar el descuento en el Checkout, `affiliate.referredBy` en el doc del usuario y el
  asiento en `affiliateCommissions`.
