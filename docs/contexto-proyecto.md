# MiniAItura — Contexto del proyecto (a 2026-06-12)

Documento de arranque para retomar el trabajo en una conversación nueva.
Resume estado, decisiones y trampas; el detalle fino está en el código y en
los otros docs de `docs/`.

## Qué es

Web para generar miniaturas de YouTube con IA (miniaitura.com). Next.js 16 +
Firebase (Auth/Firestore/Storage, todo vía Admin SDK en servidor; reglas
cliente deny-all) + Stripe (suscripción PRO) + Vercel (hosting, analytics,
crons). i18n es/en con next-intl (`messages/*.json`). **Lanzada y en
producción**, indexada en Google, con sus primeras visitas orgánicas.

- Equipo: Álvaro (AlvaroWarrior, producto) y Dani (Wachii/wachimingoHD,
  colabora con commits "cositas N"). Coordinarse: hacer `git pull` antes de
  trabajar — ya hubo merges con conflictos.
- El moat es producto/galería/UX, no el system prompt. La galería pública es
  el activo SEO: cada miniatura publicada es una página indexable (sitemap).

## Pipeline de generación

1. `POST /api/generate`: auth obligatoria, precio derivado en servidor de los
   params validados (nunca del cliente), cobro de créditos con reembolso
   automático en cada rama de fallo.
2. Enhancer (gemini-3.5-flash, "director de arte", cita imágenes de
   referencia `[Image N]`) → modelo de imagen Google
   `gemini-3.1-flash-image-preview` (tier flex si modo ahorro) → fallback a
   fal.ai nano-banana-2 (`safety_tolerance: "6"`) → upscale seedvr opcional.
3. **Todo Gemini de texto va sin thinking** (`thinkingBudget: 0`): enhancer y
   los 3 sugeridores (estilo/contenido/campo; cuestan 1 crédito, solo PRO,
   gemini-2.5-flash). El thinking añadía ~5 s sin mejorar estas tareas.
4. **Las imágenes de referencia del usuario NO se persisten** (solo van al
   proveedor de IA y se descartan; decisión de privacidad). Hay script
   `scripts/purge-reference-images.mjs` para limpiar las antiguas (dry-run por
   defecto). En Storage solo viven las miniaturas (`users/{uid}/...`).
5. Decisión consciente pendiente de revisar: el rechazo SAFETY de Google cae a
   fal con tolerancia máxima → contenido que Google bloquea puede generarse
   igual. Mitigado por: auth para generar, solo PRO publica, botón "Reportar"
   en el detalle público (`generation_reports`, revisar a mano).

## Créditos y planes

- 1 generación = 100 créditos base (PRO: −25 ahorro, +25 alta calidad, +25
  alta resolución → 75–150). FREE: 100/día fijo + límite de 1/día por IP.
  PRO: 550/día + bolsa 3.000/mes. Sugerencias: 1 crédito.
- `creditTransactions` = auditoría de cada movimiento (no borrar: es la caja
  negra para disputas y bugs).
- Margen analizado en `docs/costes-2026-06.md` (§8: decisión 17,99 € +
  "recargo fal" recomendado pero NO implementado). Precio actual en Stripe:
  21,99 €. Subir el límite de gasto de Gemini API si sigue en €5/mes.

## Stripe (auditado a fondo, sin bugs conocidos)

- Webhook: firma + idempotencia por `event.id` (lock con `create()`, se
  libera si el handler falla). `samePaidPeriod` evita recargar créditos al
  cancelar/reanudar. Comisiones idempotentes por id de factura.
- Fechas de periodo: helper `src/lib/stripe/periods.ts` (fix de Dani).
- Cancelar = `cancel_at_period_end` (acceso hasta fin de periodo); reanudar
  lo deshace. Re-compra bloqueada (Firestore + verificación directa en
  Stripe con self-heal). Customers de test→live obsoletos se auto-reparan.
- El customer de Stripe nunca se borra (facturas = obligación fiscal). Para
  ver suscriptores reales: pestaña Suscripciones, no Clientes.
- Cupón 100% → factura €0 pagada y sub activa es comportamiento normal
  (`no_payment_required`); con €0 no se genera asiento de comisión.
- Si algún día se reembolsa a mano en el dashboard: cancelar también la sub a
  mano (no hay handler de `charge.refunded`).

## Borrado de cuenta (diferido, anti-abuso)

- Exploit original: borrar+recrear cuenta regalaba 100 créditos frescos
  (con VPN saltaba el límite IP). Solución: el borrado se PROGRAMA
  (`deletionScheduledAt` +24h) y un cron diario
  (`/api/cron/process-account-deletions`, 2:30, `CRON_SECRET`) ejecuta los
  vencidos. Como los créditos FREE se renuevan cada 24h igual, el truco ya no
  aporta nada.
- Cualquier acción autenticada cancela la solicitud (lo hace
  `getOrCreateUserDocument`). No se puede programar con una sub que renueva
  (409: cancela primero) — comprobación y escritura en transacción atómica.
  El ejecutor re-verifica que sigue programado y vencido (carrera login/cron).
- Lo que borra: sub Stripe (inmediata), Storage `users/{uid}/`, docs de
  `generations` + `creditTransactions` + reserva en `usernames` + `users`,
  y el usuario de Auth. Si Stripe falla, aborta y reintenta al día siguiente.
- El webhook `subscription.deleted` decrementa `activeReferrals` UNA vez (vía
  metadata de la sub, fuente única) y usa `update()` para no resucitar docs
  fantasma. (Hubo un doble decremento 1→-1: corregir a mano el doc R241 si
  sigue en -1.)

## Afiliados / códigos de creador

- Operativa completa en `docs/codigos-creador.md`. Alta:
  `node scripts/create-creator-code.mjs CODIGO "Nombre"` (−10% cliente, 10%
  comisión recurrente). Link `?ref=CODIGO` autorrellena.
- En `affiliates/{CODE}`: `totalEarnedMinor` = histórico PERMANENTE (nunca
  bajar) y `pendingPayoutMinor` = lo debido ahora (ponerlo a 0 a mano al
  pagar). Solo los incrementa el webhook de factura pagada; nada más los toca.
- Liquidación: día 1–5 de cada mes, PayPal/Bizum, mínimo 10 € (rollover).
  Playbook de outreach a "vendecursos" ya definido (DM corto y concreto,
  cuenta PRO regalada con `grant-pro.mjs`, prueba = redenciones del promo en
  Stripe + CSV de `affiliateCommissions`).

## Legal / privacidad

- 4 páginas en `/[locale]/legal/[slug]` con contenido en
  `src/lib/legal/content.ts` (es/en). Tono llano SIN citas de leyes y SIN
  datos personales del titular (decisión consciente: se asume el riesgo LSSI
  de no poner nombre/NIF). Soporte: `wachimingoyt.hd@gmail.com`.
- Condiciones con números reales de créditos/planes. Privacidad: refs no se
  guardan, borrado efectivo en 24-48h cancelable al iniciar sesión. Cookies:
  solo técnicas → sin banner (Vercel Analytics es cookieless).
- Footer global con los 4 enlaces. Borrado de cuenta desde Ajustes.

## SEO / marketing

- Hecho y funcionando: sitemap (con una URL por miniatura pública + hreflang),
  robots, canonicals por página, JSON-LD (Organization/WebSite/ImageObject/
  SoftwareApplication), og.png 1200×630 de marca, favicon = pingüino con
  pincel (frame 0 de `penguin-empty.png`), títulos "MiniAItura | Sección",
  Search Console verificado + sitemap enviado. Google Imágenes ya posiciona
  miniaturas de la galería; el AI Overview describe bien el producto.
- Las IAs/crawlers solo leen TEXTO: el copy debe contar lo que las imágenes
  demuestran (p. ej. "sube tu foto y sal tú con tu cara real" — el
  diferenciador — ya está en landing y metas).
- Carrusel de la portada: muestra aleatoria SSR (cursor aleatorio +
  Fisher-Yates, mitades distintas por fila) + lotes extra bajo demanda
  (`/api/gallery/marquee`, máx. 4 lotes/visita, solo al completar una vuelta;
  dedupe; si no hay material nuevo, repite). La galería pública tenía ~39
  horizontales — los lotes lucirán al pasar de ~48.

## Trampas conocidas (no tropezar otra vez)

- **PowerShell 5.1 corrompe los acentos UTF-8**: editar archivos SOLO con
  herramientas de edición o Python; nunca `Get-Content`+`Set-Content`.
- JSON de i18n: editarlos con Python (`ensure_ascii=False, indent=2`).
- next-intl: `Link` de `@/i18n/navigation`; el middleware excluye `__`
  (handler de Firebase Auth con dominio propio: proxy `/__/auth/*` en
  `next.config.ts` + `X-Frame-Options` relajado SOLO en `/__/`; el authDomain
  custom exige el redirect URI en el cliente OAuth de Google Cloud).
- El header X-Frame-Options DENY global rompía el popup de login (ya resuelto
  con la excepción de arriba).
- Headers de seguridad y CSP: CSP sigue pendiente (probar en report-only).
- Gates antes de commitear: `npm run typecheck && npm test && npm run lint`
  (62 tests). Commits con mensaje descriptivo.

## Hilos abiertos (prioridad aproximada)

1. **App Check sin activar**: cableado entero (cliente y servidor), falta
   clave reCAPTCHA v3 (`NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`) y
   `ENFORCE_FIREBASE_APP_CHECK=true`. Es la defensa contra abuso automatizado.
2. **Límite de gasto de Gemini API** (€5/mes se agota con 2-3 PRO).
3. **Recargo fal** (docs/costes §8): sin implementar; decidir.
4. **R241**: poner `activeReferrals` a 0 a mano si sigue en -1.
5. Ejecutar `purge-reference-images.mjs --apply` (limpia refs antiguas).
6. Curar la galería pública (es el escaparate en Google Imágenes) y crecerla
   más allá de ~48 para que el carrusel por lotes luzca.
7. Outreach a creadores (el cuello de botella real ahora es promoción).
8. Instagram de marca: llenarlo con 9-12 posts antes de usarlo; enlazarlo en
   el footer cuando exista.
