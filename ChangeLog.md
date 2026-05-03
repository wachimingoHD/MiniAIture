# ChangeLog - MiniAItures

This file is the running log of work done on the project. Every meaningful change to MiniAItureDOC.md, the codebase, or the operational state of the project should be reflected here so that the changelog acts as a faithful timeline of what has been built and what has changed.

**Convention:** when MiniAItureDOC.md is modified, the corresponding row here MUST be updated (or appended). The doc and the changelog are kept in sync by hand — if a change touches the doc, it touches this file too.

Format: `YYYY-MM-DD` headers (newest on top). Each entry is a bullet list. When a row contradicts something stated earlier, leave the older entry in place but mark the newer one with `(supersedes YYYY-MM-DD entry "title")` so the history stays intact.

---

## 2026-05-03 - Hardening de seguridad (supersedes parts of "Phase 2 Core monetizable integrado" related to Stripe, /api/generate y /api/estimate-cost)

Auditoria de seguridad sobre el codigo generado por GPT, ejecutada antes de abrir el flujo a usuarios reales. Ver MiniAItureDOC.md seccion 0.0 para el detalle por subseccion.

### Validacion tecnica
- `npm run lint` OK.
- `npm run test` OK (16/16, incluye nuevo caso de dedup de webhook Stripe).
- `npm run build` OK.

### Bypass critico de pricing cerrado
- `POST /api/generate`: `userFacingResolution` y `lowPriorityMode` se derivan server-side desde los `params` validados. Helper `deriveUserFacingResolution` en `src/lib/nanoBanana.ts`.
- Antes del fix, un Pro podia generar 4K standard pagando 75 creditos en lugar de 150 (50% de descuento via decoupling cliente).

### Stripe - integridad financiera
- Webhook deduplicado por `event.id` mediante lock atomico en nueva coleccion `stripe_processed_events` (via `doc.create()`); en fallo del handler, libera el lock para reintento limpio.
- `POST /api/billing/checkout` reusa `stripeCustomerId` existente en lugar de crear un nuevo Customer en cada intento.
- `POST /api/billing/checkout` rechaza con 409 si la suscripcion Pro ya esta activa, evitando dobles cargos.
- Webhook hace cross-check de `metadata.uid` vs `stripeCustomerId` enlazado al doc; rehusa mutaciones si no coinciden.

### Validaciones de input
- `validateGenerationRequest` siempre computa `size` desde el base64 real (ignora `ref.size` del cliente).
- Cap por imagen ademas del cap total; truncado de `filename` a 256 chars.
- `sanitizeAffiliateCode` en checkout: max 64 chars, regex `[a-zA-Z0-9_-]+`.

### Endpoints
- `POST /api/estimate-cost`: ahora requiere auth + cache LRU 30s por `uid + sha256(body)` para absorber el debounce del frontend sin reabrir DoS contra cuota de Gemini.
- Frontend: omite la llamada al estimate cuando no hay sesion y muestra "Sign in to see cost estimates".

### Auth
- `verifyIdToken` activa `checkRevoked = true`: tokens revocados o usuarios deshabilitados son rechazados.

### Anti-spoof IP
- `getClientIp` prioriza headers de edge (`x-vercel-forwarded-for`, `cf-connecting-ip`, `x-real-ip`) antes del header configurable, dejando la IP del rate-limit Free no manipulable en Vercel/Cloudflare.

### SSRF y blast radius
- `fetchAsBase64` (post-proceso fal): allowlist `*.fal.media`, `*.fal.ai`, `*.fal.run` sobre HTTPS, cap 25 MB en bytes descargados.

### Concurrencia
- `getOrCreateUserDocument` envuelto en `runTransaction` (race en first-login).
- `GET /api/user/credits` aplica reset diario en transaccion solo cuando esta vencido (no toma lock en path de lectura).

### Headers HTTP
- Añadidos a `next.config.ts`: `Strict-Transport-Security` (preload), `Permissions-Policy` (camera/mic/geo/topics off), `X-DNS-Prefetch-Control: off`.
- CSP NO incluida en este pase (requiere tuning con dominios de Firebase y Stripe).

### Redaccion de errores en produccion
- Nuevo helper `safeErrorMessage` en `src/lib/server/errors.ts`.
- Aplicado en `/api/generate`, `/api/billing/checkout` y `/api/webhooks/stripe`: `err.message` interno se omite en `NODE_ENV=production`.

### Limpieza
- Eliminados de `src/lib/config/runtime.ts`: `AUTH_BYPASS_UIDS` (`getBypassAuthIds`, `parseCsv`) y `ALLOW_MOCK_STRIPE_WEBHOOK_IN_DEV`. Eran codigo muerto (declarado, nunca usado).
- Eliminado `googleImageSize` de `src/lib/nanoBanana.ts` (wrapper identidad); inlinada la referencia en `src/lib/google.ts`.

### Nueva coleccion Firestore
- `stripe_processed_events`: docs keyed por `event.id` con `{ type, receivedAt, completedAt? }`. Sirve como lock idempotente. Sin TTL automatico en este pase (sugerido 90 dias).

### Tests
- Añadido test de dedup en `src/app/api/webhooks/stripe/route.test.ts`.
- Mocks ampliados: soportan coleccion `stripe_processed_events` y `customerMatches` (lectura de `ref.get()` sobre el user ref).

### Pendientes conocidos no abordados
- CSP completa.
- `npm audit` reporta 12 vulnerabilidades transitivas (10 moderate, 2 low) pendientes de revisar.
- Tests son humo: cubren happy-path y 401, no la logica financiera profunda.
- Politica de retencion de imagenes Pro tras cancelacion sigue pendiente de definicion de negocio.

## 2026-05-03 - UX de producto, simulacion dev y unificacion de fechas ISO (supersedes parts of 2026-05-03 entry "Phase 2 Core monetizable integrado")

Iteracion de producto posterior al cierre de Phase 2 para alinear UX final, depuracion operativa y formato de datos.

### Validacion tecnica
- `npm run lint` OK.
- `npm run test` OK.
- `npm run build` OK.

### Home UX (app principal)
- Se separo la experiencia en dos capas:
  - `User options` (controles de negocio para usuario final),
  - `Developer parameters` (desplegable tecnico con estado real de params).
- `Aspect ratio` se movio al bloque de desarrollador.
- `Reference images` paso a mostrarse justo debajo de `Prompt`.
- El boton `Generate thumbnail` ahora muestra coste de creditos y saldo (`Daily`/`Monthly`).
- Se restauro la UI visual de:
  - `Estimated cost` (cards legibles),
  - `Result` (imagenes renderizadas, banners de fallback, descarga, metadata).
- Se restauro en cabecera la informacion de usuario autenticado (email, plan, creditos).

### Reglas de plan en UI de resolucion
- Free:
  - resolucion bloqueada en `512`,
  - opciones superiores mostradas como `Pro feature`,
  - low-priority forzado sin aplicar descuento extra de creditos por ese flag.
- Pro:
  - se oculta opcion `512` en selector principal.

### Mapeo de resoluciones y coste de creditos
- Mapeo funcional activo:
  - `512` -> base 512 sin upscale,
  - `1K` -> 512 + upscale 1K,
  - `2K` -> 1K + upscale 2K,
  - `4K` -> 1K + upscale 4K.
- Se implemento pricing dinamico de creditos request-level (frontend + backend):
  - base 100,
  - 512: -25%,
  - 1K: 0%,
  - 2K: +25%,
  - 4K: +50%,
  - low-priority Pro: -25%.
- `deductGenerationCredits` ahora recibe `cost` calculado en runtime en lugar de asumir solo coste fijo.

### Simulacion para desarrollo
- `POST /api/generate` admite modo simulacion en no-produccion:
  - `success`: gasta creditos y registra stats sin generar imagen real.
  - `reject`: simula rechazo con reembolso de creditos.

### Gallery y Pricing
- Gallery:
  - cada entrada abre modal ampliado con imagen, prompt completo y metadatos.
  - fix de visualizacion inconsistente de fecha entre entradas.
- Pricing:
  - si la suscripcion ya esta activa/trialing, el CTA se deshabilita y muestra `Already acquired`.

### Firestore - unificacion de fechas
- Se migro el formato de fechas de negocio a ISO string para consistencia futura:
  - `credits.dailyResetAt`,
  - `credits.monthlyResetAt`,
  - `subscriptionStart`,
  - `subscriptionEnd`,
  - `gallery[].createdAt`.
- Se elimino el esquema dual nuevo-viejo en escrituras actuales.
- `GET /api/gallery` mantiene normalizacion de lecturas legacy para no romper datos previos de pruebas.

### Correcciones operativas
- Ajuste en persistencia de stats para evitar desalineacion de `falGenerations` en escenarios de proveedor efectivo/fallback.
- Limpieza de texto mojibake visible en varias superficies UI reescritas durante la iteracion.

## 2026-05-03 - Phase 2 Core monetizable integrado (supersedes 2026-05-03 entry "Phase 1 scaffolding")

Cierre de la brecha entre el scaffold de Phase 1 y el objetivo monetizable/operativo definido para Phase 2.

### Validación técnica final
- `npm run lint` OK.
- `npm run test` OK (unit + API smoke).
- `npm run build` OK.

### Auth + identidad (Firebase)
- Implementado cliente Firebase Auth (sign-in y obtención de ID token para llamadas autenticadas).
- Implementado Firebase Admin server-side (`verifyIdToken`) para proteger endpoints.
- Integrado el estado de sesión real en frontend.

### Créditos, planes y gating de generación
- Activado `GET /api/user/credits` con lectura real en Firestore (ya no 501).
- Integrado sistema de créditos con transacciones atómicas (`runTransaction`) para débito y reembolso.
- Reglas Free/Pro aplicadas server-side en `POST /api/generate`:
  - coste fijo de 100 créditos por generación,
  - restricciones de Free (resolución/pipeline/capacidades permitidas),
  - errores de negocio claros (`401`, `402`, `429` y validaciones de plan).
- Reembolso explícito de créditos cuando la generación falla tras un débito exitoso.

### Stripe (core de suscripción)
- Implementado cliente Stripe real para checkout y webhook signature verification.
- Nuevo endpoint `POST /api/billing/checkout` para iniciar suscripción Pro.
- Nuevo endpoint `GET /api/billing/status` para estado de suscripción en frontend.
- `POST /api/webhooks/stripe` pasó de stub a operativo:
  - validación de firma,
  - mapeo de eventos a mutaciones Firestore (upgrade/downgrade/renovación/past_due).

### Persistencia de galería Pro
- Migración de enfoque: se abandona R2 para este sprint y se usa **Firebase Storage**.
- Subida server-side de la imagen final de usuarios Pro.
- Escritura de índice `gallery` en `users/{uid}` con límite FIFO de 200 entradas.
- Nuevo endpoint `GET /api/gallery` para listar galería del usuario.
- Nueva página `/gallery` para consulta visual de imágenes generadas (solo Pro).

### UI de monetización
- Nueva página `/pricing`.
- Integración del texto/enlace `Pricing` de la web hacia la sección de precios.
- Botón de suscripción conectado a Stripe Checkout (sandbox/test mode).

### Seguridad y anti-abuso mínimo
- Rate-limit Free por IP: 1 generación/día en capa API.
- Validación App Check server-side con posibilidad de activar/desactivar por entorno.
- Logging estructurado para trazabilidad operacional (créditos, webhooks, generación).

### Limpieza y correcciones relevantes
- Eliminado por completo el historial local (IndexedDB/localStorage) para evitar conflictos con el modelo de galería persistente.
- Corregidos issues de bootstrap de historial local (`IDBObjectStore index not found`) al retirar la capa legacy.
- Se añadieron trazas de debug para diagnosticar persistencia de galería y se retiraron después de estabilizar el flujo.

### Decisiones de alcance confirmadas en esta fase
- Scope: Core monetizable.
- Configuración: parámetros de negocio configurables (env + defaults tipados).
- Entorno: sandbox/test first.
- Testing: unit + API smoke.
- Afiliados: pospuestos a sprint 2.

## 2026-05-03 - Phase 1 scaffolding (full MVP frontend + AI APIs)

Initial bootstrap of the Next.js project from scratch based on `MiniAItureDOC.md` (sections 1–11 fully implemented, sections 12+ scaffolded with TODOs).

### Tech foundation
- Initialized Next.js 16.2.4 + React 19.2.4 + TypeScript 5 + Tailwind 4.
- Created `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `next-env.d.ts`, `.gitignore`, `.env.example`.
- Dark-mode visual theme with custom CSS variables in `src/app/globals.css` (yellow accent on near-black surfaces — placeholder design, intentionally subdued; ready to be re-skinned).

### Shared domain (Phase 1)
- `src/lib/nanoBanana.ts`: full type system (`NanoBananaParams`, `GeneratedImage`, `CostSummary`, `FailureDetail`, etc.), enums (`AspectRatio`, `Resolution`, `UpscaleResolution`), default params, reference-image limits, request validator (`validateGenerationRequest`), capacity-failure detection (`isGoogleCapacityFailure`), fallback eligibility (`shouldFallbackToFal`).
- `src/lib/cost.ts`: token-based Google cost (`computeTokenCostSummary`), fal rate-based cost (`computeFalCostSummary`), upscale cost (`computeUpscaleCost`), merge logic (`mergeCostWithUpscale`), live fal pricing fetch with 5-minute in-process cache.

### Provider integrations (Phase 1)
- `src/lib/google.ts`: REST integration with `gemini-3.1-flash-image-preview`. Per-image request loop, `service_tier` ("flex"/"standard"), `safetySettings: OFF` for all categories, optional `google_search` tool, configurable timeouts (2 min standard, 10 min flex), full HTTP error classification, `formatGoogleNoImageError` for content/safety/finish-reason failures, modality-aware token usage accumulator, `estimateGoogleTokens` with `countTokens` API + local fallback.
- `src/lib/fal.ts`: REST integration. Generation via `fal-ai/nano-banana-2` (no refs) or `fal-ai/nano-banana-2/edit` (with refs). Param mapping: `512` → `0.5K`, `enable_google_search` → `enable_web_search`, fixed `safety_tolerance: "6"`, `limit_generations: true`, `output_format: "png"`. Upscale via `fal-ai/seedvr/upscale/image` with target mapping (`1K`→`1080p`, `2K`→`1440p`, `4K`→`2160p`). 10-minute timeout for both gen and upscale. Image fetch helper to inline base64.

### API routes (Phase 1)
- `src/app/api/generate/route.ts`: full resilience flow per doc section 8/14:
  1. Parse + validate (400 on bad input).
  2. Google primary attempt (Flex if `flex_mode`, else Standard).
  3. Flex → Standard automatic retry on capacity failure (503/429), exposed as `googleTierFallback`.
  4. fallback to fal.ai when eligible AND `AUTO_FALLBACK_TO_FAL=true` AND `FAL_API_KEY` present.
  5. Optional upscale post-process (only if target > base).
  6. Returns full `GenerateResponse` (provider used, fallback metadata, cost, images, originalImages if upscale ran, primary failure if any, timestamps).
- `src/app/api/estimate-cost/route.ts`: doubles-cost precalculation. Live fal pricing API + countTokens with fallbacks. Returns `{ upscale, google, fal }` blocks where Google and fal totals already include the upscale portion.

### Frontend (Phase 1)
- `src/app/page.tsx`: complete UI in English, dark theme.
  - Two-column layout (controls left, results right). Responsive collapse on `<lg`.
  - All `NanoBananaParams` exposed individually with per-parameter "Default" reset link.
  - Reference uploader: drag & drop + file picker, multi-file, individual remove + clear all, live previews via `URL.createObjectURL`, validated against the 10-file / 5 MB limits.
  - Auto-running cost estimator (debounced 600ms) showing three cards: upscale, Google, fal — highlighting the cheaper provider.
  - Flex banner shown when `flex_mode = true`.
  - Generation result panel with image grid, per-image download, "View originals" disclosure when upscale ran, JSON metadata disclosure for debugging.
  - Local history list with thumbnails, individual delete, clear-all, time/duration/provider/cost badges.
  - Header with brand mark + nav placeholders (Pricing / For creators / Affiliates / Sign in).
  - Footer with one-line summary of the credit/plan model.
- `src/app/layout.tsx`: root layout, metadata (title, description, keywords), `lang="en"`.
- `src/app/globals.css`: Tailwind v4 `@theme` block with custom CSS variables, dark scrollbar, shimmer + soft pulse keyframes for the loading state.

### Local persistence (Phase 1)
- `src/lib/history.ts`: IndexedDB-backed history (`nano-banana-2-db`, store `history`), keyed by id, indexed by `createdAt` (descending listing). One-time migration from legacy `localStorage` key, FIFO trim at 40 entries, full CRUD + clear.

### Phase 2 stubs (created but not active — require external service setup)
- `src/lib/auth/firebase-client.ts`: config getter from `NEXT_PUBLIC_FIREBASE_*` env, exported stubs (`signInWithGoogle`, `signOutUser`, `getCurrentIdToken`) that throw or return null until Firebase SDK is installed and the implementation is uncommented. Step-by-step activation comments at the top of the file.
- `src/lib/auth/firebase-admin.ts`: server-side admin stubs (`verifyIdToken`, `adminFirestore`).
- `src/lib/firestore/schema.ts`: full type model from doc section 17 (`UserDocument`, `UserCredits`, `UserAffiliate`, `UserStats`, `ImageEntry`), constants (`CREDITS_PER_IMAGE = 100`, `FREE_DAILY_CREDITS = 100`, `MAX_PRO_GALLERY_ENTRIES = 200`), placeholder `PRO_DAILY_CREDITS_DEFAULT = 500` and `PRO_MONTHLY_POOL_DEFAULT = 3000` flagged as PENDING in code comments, `buildInitialUserDocument` factory.
- `src/lib/firestore/credits.ts`: pure framework-free credit logic (`applyDailyResetIfDue`, `tryDeductCredits` with daily-then-monthly draw, `refundCredits`) ready to drop into a Firestore transaction.
- `src/lib/r2/client.ts`: config getter + `uploadGalleryImage` stub.
- `src/lib/stripe/client.ts`: config getter + `createProCheckoutSession` and `verifyWebhookSignature` stubs.
- `src/app/api/user/credits/route.ts`: GET handler that verifies Bearer token and returns 501 until Phase 2 is active.
- `src/app/api/webhooks/stripe/route.ts`: POST handler that requires `stripe-signature` header and returns 501 until Phase 2 is active.

### Documentation
- Created this `ChangeLog.md`.

### What is NOT in Phase 1
- Firebase Auth, Firestore writes, App Check (stubs only).
- Cloudflare R2 image storage (stub only).
- Stripe subscriptions, webhooks, affiliate commissions (stubs only).
- Rate limiting per IP for Free users (depends on auth + a request store).
- Server-side gallery, watermarking, plan-based feature gating.
- Analytics aggregation document for Flex failures.
- Tests (none defined yet; doc doesn't request a test framework).

### Pending decisions still surfaced from MiniAItureDOC.md section 25
1. Pro plan base price (€/month).
2. Pro daily credit model: Option A (24h reset since first use) vs Option B (recharge every 5h).
3. Pro daily credit volume: 400 vs 500.
4. Pro monthly pool: 2000 vs 3000.
5. Affiliate program duration policy (permanent vs conditional).
6. R2 image retention policy on Pro cancellation.

These remain open. The codebase carries placeholders (`PRO_DAILY_CREDITS_DEFAULT`, `PRO_MONTHLY_POOL_DEFAULT`) that should be revisited once decisions land. No business logic in Phase 1 depends on these values.
