# ChangeLog - MiniAItures

This file is the running log of work done on the project. Every meaningful change to MiniAItureDOC.md, the codebase, or the operational state of the project should be reflected here so that the changelog acts as a faithful timeline of what has been built and what has changed.

**Convention:** when MiniAItureDOC.md is modified, the corresponding row here MUST be updated (or appended). The doc and the changelog are kept in sync by hand — if a change touches the doc, it touches this file too.

Format: `YYYY-MM-DD` headers (newest on top). Each entry is a bullet list. When a row contradicts something stated earlier, leave the older entry in place but mark the newer one with `(supersedes YYYY-MM-DD entry "title")` so the history stays intact.

---

## 2026-06-09 - Fix Stripe post-checkout, copy de pricing y limpieza de perfil

Entrada añadida tras corregir el caso real en el que una suscripción de Stripe completada en modo test no cambiaba el estado del usuario a PRO.

### Stripe y facturación
- Se añadió una reconciliación explícita post-checkout:
  - `src/lib/stripe/client.ts` ahora incluye `session_id={CHECKOUT_SESSION_ID}` y `billing=success` en `success_url`, aunque `STRIPE_CHECKOUT_SUCCESS_URL` no los traiga.
  - La sesión de Checkout guarda también `client_reference_id = uid` además de metadata, para tener una segunda forma fiable de enlazar Stripe -> Firebase.
  - Nuevo endpoint autenticado `POST /api/billing/sync` (`src/app/api/billing/sync/route.ts`) que recibe `sessionId`, recupera la Checkout Session desde Stripe, valida que pertenece al usuario logueado y aplica la suscripción en Firestore.
  - La página `src/app/[locale]/pricing/page.tsx` detecta `?billing=success&session_id=...` al volver de Stripe, llama a `/api/billing/sync`, refresca `/api/billing/status` y limpia esos parámetros de la URL.
- Se centralizó parte de la escritura de suscripciones en `src/lib/stripe/subscription-sync.ts`:
  - Busca el usuario por `uid`, `stripeSubscriptionId` o `stripeCustomerId`.
  - Protege contra mismatches de cliente Stripe.
  - Normaliza estados Stripe (`active`, `trialing`, `past_due`, `canceled`, etc.) al modelo de `UserDocument`.
  - Actualiza `plan`, ids de Stripe, estado/cancelación, periodo, créditos diarios y bolsa mensual.
- El webhook de Stripe (`src/app/api/webhooks/stripe/route.ts`) ahora maneja también `checkout.session.completed`, usando el mismo sincronizador. Esto hace que el alta PRO pueda entrar tanto por webhook como por la vuelta del usuario desde Checkout.
- `src/lib/stripe/client.ts` separa config core (`STRIPE_SECRET_KEY` + `STRIPE_PRO_PRICE_ID`) de config completa de webhook (`STRIPE_WEBHOOK_SECRET` incluido), para poder leer precio/crear sesiones aunque el secreto del webhook no aplique en una ruta concreta.

### Pricing
- Nuevo endpoint público `GET /api/billing/pricing` (`src/app/api/billing/pricing/route.ts`) que expone:
  - créditos `freeDaily`, `proDaily`, `proMonthly` desde `getRuntimeConfig()`;
  - snapshot del precio Pro desde Stripe (`STRIPE_PRO_PRICE_ID`), con cantidad, moneda e intervalo.
- `src/app/[locale]/pricing/page.tsx` muestra el precio Pro detectado desde Stripe cuando está disponible; si no, muestra un fallback traducido.
- Copy de pricing simplificado para cliente final:
  - Gratis: `0€ / mes`, créditos diarios reales, resolución media, baja prioridad, sin galería.
  - Pro: precio real, créditos diarios/mensuales reales, resolución hasta 4K, alta prioridad, galería persistente, renovación automática.
- Traducciones actualizadas en `messages/es.json` y `messages/en.json`.

### Perfil
- `src/app/[locale]/dashboard/settings/page.tsx` ya no muestra la sección visual de estadísticas de uso (`miniaturas`, `generaciones`, `meses PRO`). El endpoint puede seguir devolviendo `stats`, pero la UI del perfil no las renderiza.

### Validación
- `npm install` fue necesario en el entorno local porque faltaba `node_modules/next-intl`; el `package-lock.json` se dejó sin cambios.
- Se eliminó `.next` generado porque contenía validadores antiguos de rutas no localizadas; después de limpiarlo:
  - `npm run typecheck` OK.
  - `npm run test` OK: 10 archivos, 53 tests pasados.
  - `npx eslint` sobre los archivos modificados OK.
- `npm run lint` global sigue fallando por deuda preexistente fuera de este cambio:
  - `src/app/[locale]/generate/page.tsx`: `react-hooks/set-state-in-effect` y warning de dependencia `t`.
  - `src/components/ui/PenguinThumbnailMarquee.tsx`: `react-hooks/set-state-in-effect`.
  - `src/components/ui/PublishConfirmModal.tsx`: `react-hooks/set-state-in-effect`.
  - `src/app/[locale]/dashboard/gallery/page.tsx`: warning de dependencia `loadGallery`.

## 2026-06-09 - Sincronizacion de cambios no registrados: i18n, rediseño visual, galerias, prompts y flujo de producto (supersedes/actualiza el estado descrito en entradas 2026-05-03 cuando entren en conflicto)

Entrada añadida despues de una lectura completa del proyecto para que una futura IA/persona no tenga que reconstruir el estado real desde cero. **Importante:** esta entrada documenta cambios ya existentes en el repo; no introduce cambios funcionales de codigo.

### Estado operativo observado
- Rama actual: `cambios_codex_2`.
- Worktree limpio al momento de la auditoria.
- `HEAD`: `900cbbf cositas` (tambien `main` / `origin/main` en este checkout).
- Commits recientes no reflejados antes en este changelog:
  - `900cbbf cositas`: internacionalizacion completa con `next-intl`, rutas bajo `[locale]`, mensajes `en/es`, `LanguageSwitcher`, ajustes de layout, prompts y componentes.
  - `96ca8f1 cositas`: sugeridor de estilo con IA, mejoras fuertes en `/generate`, botones "Use in generator", confirmaciones de publicacion, `PageHeader`, `CopyButton` temporal, ajustes del enhancer.
  - `020ba0b penguino`: sprites/estado vacio, cancelacion Stripe al final de periodo, ajustes de pricing por modos, settings mas completo, script `delete-collection`.
  - `efe6f43 Merge feature/landing-redesign-light`: landing clara/beige, sidebar global, sprites de pingüino, galerias/SEO, reglas Firebase/Storage, sitemap/robots.
  - `265065d feat: galeria publica/privada production-ready, seguridad Firestore/Storage y SEO`: base de la nueva galeria con coleccion `generations`.
  - `74cb4d3 Rediseño de landing (tema claro beige) + navegacion y sprites en CSS`.
  - `807a6e5 Merge feature/miniaitura-instructions: rediseño, generations, galeria resiliente`.

### Validacion realizada durante esta sincronizacion
- `npm run test` OK: 10 archivos de test, 52 tests pasados.
- `npm run typecheck` falla en este checkout por entorno/local state, no necesariamente por codigo:
  - `node_modules` no contiene `next-intl`, aunque `package.json`/`package-lock.json` ya lo declaran.
  - `.next/types` y `.next/dev/types` conservan validadores de rutas antiguas (`src/app/page.js`, `src/app/gallery/page.js`, etc.) previas a `[locale]`.
  - Siguiente paso recomendado antes de validar build/typecheck: ejecutar `npm install`, limpiar `.next` si sigue apuntando a rutas antiguas, y repetir `npm run typecheck` + `npm run build`.
- No se ejecuto `npm run build` en esta auditoria.

### Arquitectura frontend actual
- La app ya no vive en rutas planas sin idioma. El arbol principal es `src/app/[locale]/...`.
- `next-intl` esta integrado:
  - `src/i18n/routing.ts`: locales `en` y `es`, `defaultLocale = "en"`, `localePrefix = "always"`.
  - `src/middleware.ts`: redirige/gestiona prefijo de idioma y excluye APIs/assets.
  - `messages/en.json` y `messages/es.json`: todo el copy principal de landing, sidebar, pricing, galerias, settings, loader y generador.
  - `src/components/ui/LanguageSwitcher.tsx`: cambia idioma manteniendo ruta.
- `src/app/[locale]/layout.tsx` reemplaza el layout raiz anterior:
  - carga fuentes Google `Baloo_2` y `DM_Sans`;
  - inyecta `Sidebar` global;
  - añade JSON-LD `Organization` y `WebSite`;
  - usa `NextIntlClientProvider`.
- `src/app/globals.css` ya no representa el dark theme inicial. El tema vigente es claro/beige pastel:
  - fondos `--color-bg-base`, `--color-bg-panel`, `--color-bg-panel-2`;
  - acento principal violeta `--color-accent`;
  - acento secundario naranja;
  - colores pastel para decoracion/mascotas;
  - animaciones CSS para reveal, marquee, cuadrados flotantes y sprites.

### Identidad visual y navegacion
- La identidad actual gira en torno a un SaaS claro/beige con personalidad de sprites de pingüino, no al tema oscuro de Phase 1/2.
- `public/sprites/` contiene:
  - `penguin.png`: pingüino pintor del loader.
  - `penguin-slide.png`: pingüinos deslizandose/cargando thumbnails.
  - `penguin-stop.png`: frame parado al hacer hover.
  - `penguin-empty.png`: estado vacio.
- `src/components/ui/Sidebar.tsx` es la navegacion global:
  - sidebar fija de 64px colapsada / 216px expandida;
  - estado de expansion en `localStorage`;
  - links: home, generate, dashboard/gallery, gallery, pricing;
  - muestra avatar/login con Firebase;
  - incluye selector de idioma.
- `src/components/ui/PageHeader.tsx` unifica cabeceras internas con marca, nav y auth.
- `src/components/ui/PenguinThumbnailMarquee.tsx` renderiza el carrusel de la landing:
  - dos filas infinitas;
  - animaciones de sprite generadas por CSS;
  - pausa/estado parado en hover;
  - modal con imagen, estilo y autor;
  - link al detalle de galeria.

### Landing actual (`src/app/[locale]/page.tsx`)
- Server Component con `dynamic = "force-dynamic"` y runtime Node.
- Hero minimalista:
  - marca grande `MiniAItura` con `AI` destacado;
  - subtitulo traducido;
  - CTA a `/generate` y `/gallery`;
  - cuadrados pastel flotantes decorativos.
- Seccion inferior: `Latest community generations` / `Ultimas generaciones...` con `PenguinThumbnailMarquee`.
- Las miniaturas publicas se cargan server-side desde Firestore:
  - `getPublicGenerations(limit: 24, orderBy: "timesStyleCopied")`;
  - dedup de autores por `users/{uid}.displayName`;
  - si Firestore/Admin no esta configurado, muestra placeholders.

### Generador actual (`src/app/[locale]/generate/page.tsx`)
- Client Component grande; es la pagina principal de producto.
- Bug critico de perdida de formulario al navegar corregido con `sessionStorage`:
  - clave `miniaitura:genform:v1`;
  - conserva `params`, titulo, estilo, origen del estilo, toggles Pro, imagenes de referencia e instrucciones;
  - si excede cuota por imagenes grandes, guarda el formulario sin imagenes.
- Prefill desde galeria publica:
  - clave `miniaitura:prefill`;
  - `UseInGenerator` permite traer contenido, estilo o ambos desde `/gallery/[generationId]` a `/generate`;
  - se tuvo en cuenta React StrictMode con cache de modulo `pendingPrefill`.
- Campos reales del formulario:
  - `videoTitle` opcional;
  - contenido/prompt obligatorio (`params.prompt`);
  - estilo como textarea editable;
  - presets como botones rapidos desde `STYLE_PRESETS`;
  - boton "Suggest style with AI" que cobra 1 credito y llama a `/api/suggest-style`;
  - imagenes de referencia multiples hasta `MAX_REFERENCE_IMAGES` (actualmente 10), no una sola;
  - instrucciones por imagen;
  - boton para insertar tokens `[Image N]` en el contenido.
- Referencias:
  - el frontend envia cada imagen como base64 + mime + filename + size;
  - las instrucciones se combinan como lineas `Image N: ...`;
  - el enhancer sabe asociar `[Image N]` con la imagen adjunta N.
- Opciones por plan:
  - FREE: fuerza `flex_mode = true`, `resolution = "512"`, sin upscale, coste fijo 100.
  - PRO: toggles `saver`, `highQuality`, `highRes`.
  - Derivacion tecnica PRO:
    - default: base 512 + upscale 1K;
    - `highQuality`: nativo 1K sin upscale;
    - `highRes`: upscale 2K;
    - `saver`: flex/baja prioridad.
- Coste actual por modos (`src/lib/firestore/credit-pricing.ts`):
  - FREE siempre 100.
  - PRO base 100.
  - `saver`: -25.
  - `highQuality`: +25.
  - `highRes`: +25.
  - Son acumulables.
- Resultado:
  - muestra imagenes base64 devueltas por `/api/generate`;
  - lightbox con navegacion/descarga;
  - si el usuario es Pro y la respuesta trae `generationIds`, muestra publicacion a galeria con modal de confirmacion.

### Prompt enhancer y sugeridor de estilo
- `src/lib/prompts/system-prompt.ts` fue reescrito como prompt de direccion artistica:
  - prioriza CTR real de thumbnails;
  - distingue nichos: entertainment/commentary, gaming, tutorial, finance/business, vlog/reaction;
  - define reglas para texto en imagen, composicion, caras, contraste, mobile readability;
  - incluye protocolo explicito para imagenes citadas `[Image N]` vs referencias no citadas.
- `src/lib/services/prompt-enhancer.ts`:
  - construye mensaje de usuario con titulo, descripcion, estilo, referencias e instrucciones;
  - adjunta todas las imagenes al LLM de texto con etiquetas `Image 1`, `Image 2`, etc.;
  - normaliza citas `[Image N]` y `[Imagen N]`;
  - si Gemini texto falla o falta API key, genera prompt fallback determinista.
- `src/lib/geminiText.ts`:
  - wrapper REST para Gemini texto;
  - `DEFAULT_GEMINI_TEXT_MODEL = "gemini-3.5-flash"`;
  - `GEMINI_TEXT_MODEL` permite override.
- Nuevo endpoint `/api/suggest-style`:
  - cobra `STYLE_SUGGESTION_CREDITS = 1`;
  - usa `gemini-2.5-flash`;
  - devuelve solo una direccion de estilo reutilizable, en ingles;
  - reembolsa si falla la llamada al LLM.
- `src/lib/prompts/style-suggestion.ts` contiene el prompt y builder del mensaje.

### API de generacion actual (`src/app/api/generate/route.ts`)
- Sigue aceptando el envelope antiguo `{ params, referenceImages }`, pero si vienen campos nuevos (`userPrompt`, `videoTitle`, `stylePrompt`, etc.) ejecuta el flujo nuevo.
- Flujo actual:
  1. Valida `params` y referencias con `validateGenerationRequest`.
  2. Deriva coste/modos desde params validados, nunca desde campos de coste del cliente.
  3. Ejecuta enhancer si viene `userPrompt`; sustituye `params.prompt` por `enhancedPrompt`.
  4. Verifica auth y App Check opcional.
  5. Crea/backfillea usuario con `displayName` si procede.
  6. Aplica reglas de plan.
  7. FREE consume rate limit por IP en `rateLimits`.
  8. Cobra creditos mediante transaccion.
  9. Dev simulation no-produccion: `success` o `reject`.
  10. Llama Gemini imagen; si Pro + flex falla por capacidad, reintenta standard.
  11. Si procede, fallback a fal.
  12. Aplica upscale opcional.
  13. Registra stats.
  14. Sube imagenes finales a Firebase Storage.
  15. Crea documentos en `generations` para todos los usuarios si Storage esta configurado.
  16. Devuelve `GenerateResponse` + `durationMs` + `generationIds`.
- Persistencia:
  - las imagenes finales se guardan en Firebase Storage;
  - se crea un documento por imagen en `generations`;
  - tambien intenta subir la primera referencia como `referenceImageUrl`.
- Matiz/deuda importante:
  - los `creditTransactions` de tipo `generation` se escriben al cobrar, antes de crear el documento `generations`, por lo que normalmente `generationId` queda `null` aunque el schema lo contempla.
  - si falla la persistencia en Storage/generations despues de generar, se loguea `console.warn` pero no se considera fallo fatal de generacion ni se reembolsa.

### Datos y Firestore
- El modelo vigente ya no es `users/{uid}.gallery` como fuente principal.
- Colecciones vigentes:
  - `users`: perfil, plan, creditos, stats, Stripe, `displayName`, `cancelAtPeriodEnd`.
  - `generations`: una imagen generada por documento.
  - `creditTransactions`: auditoria de creditos.
  - `affiliates`: scaffold de afiliados.
  - `rateLimits`: rate limit diario por IP con `expiresAt`.
  - `stripe_processed_events`: idempotencia de webhooks.
  - `usernames`: reservas case-insensitive de `displayName` en `/api/user/profile`.
- `src/lib/firestore/schema.ts`:
  - `gallery` esta marcado deprecated y solo deberia usarse para migracion/lectura legacy.
  - `ImageEntry` tambien deprecated.
- `src/lib/firestore/users.ts`:
  - `getOrCreateUserDocument` usa transaccion y backfill de `displayName`.
  - `deductGenerationCredits` aplica resets y escribe `creditTransactions`.
  - `recordGenerationSuccess` actualiza stats.
  - `checkAndConsumeFreeIpRateLimit` usa `rateLimits`.
  - **Legacy/deuda:** `storeProGalleryImages` sigue existiendo y escribe `users.gallery`, pero el flujo principal actual ya usa `generations`.
- `src/lib/firestore/generations.ts`:
  - `createGeneration`, `getUserGenerations`, `getPublicGenerations`, `getGenerationById`;
  - `publishGeneration`, `unpublishGeneration`, `deleteGeneration`;
  - `incrementTimesStyleCopied`;
  - `toPublicDTO` oculta campos sensibles y solo expone `stylePrompt` si `styleType === "custom"`.
- `firestore.indexes.json` define indices compuestos:
  - `generations`: `userId + createdAt desc`;
  - `isPublic + createdAt desc`;
  - `isPublic + timesStyleCopied desc`.
- `firestore.rules` niega todo acceso directo cliente; todo pasa por API routes con Admin SDK.
- `storage.rules` tambien niega todo acceso directo cliente; las imagenes se sirven con URLs de Firebase Storage con token.

### Galeria personal
- Ruta: `src/app/[locale]/dashboard/gallery/page.tsx`.
- Client page autenticada via Firebase client.
- Backend: `GET /api/gallery`.
- FREE: muestra ultimas 30 generaciones; no borra datos antiguos (opcion A de retencion).
- PRO: paginacion por cursor `createdAt`.
- Cada item abre modal con:
  - imagen grande;
  - prompt de usuario;
  - estilo;
  - visibilidad publica/privada;
  - link a la pagina publica si esta publicada;
  - descargar;
  - publicar/despublicar;
  - borrar.
- Publicar usa `PublishConfirmModal`; publicar exige plan Pro en API.
- Borrar elimina documento `generations` y limpia imagen en Storage best-effort.

### Galeria publica y SEO
- Ruta grid publica: `src/app/[locale]/gallery/page.tsx`.
  - Server Component SSR/dynamic.
  - Carga `generations` publicas (`isPublic == true`) ordenadas por `createdAt`.
  - Renderiza tarjetas en HTML inicial para SEO.
  - Usa `next/image` y `generateAltText`.
- Ruta detalle publica: `src/app/[locale]/gallery/[generationId]/page.tsx`.
  - Server Component SSR/dynamic.
  - Solo muestra generaciones `isPublic`.
  - Metadata dinamica: title, description, OG image, Twitter card.
  - JSON-LD `ImageObject`.
  - Muestra contenido, estilo, autor, nicho, contador de uso.
  - `UseInGenerator` permite usar contenido, estilo o ambos en `/generate`.
- APIs:
  - `GET /api/gallery/public`: galeria publica no autenticada; DTO seguro.
  - `GET /api/generations/[id]`: detalle publico seguro.
  - `DELETE /api/generations/[id]`: propietario autenticado.
  - `POST /api/generations/[id]/publish`: propietario Pro.
  - `POST /api/generations/[id]/unpublish`: propietario autenticado.
  - `POST /api/generations/[id]/use-style`: incrementa `timesStyleCopied` para estilos custom publicos.
- Matices:
  - El filtro `nicho` de `/api/gallery/public` se hace en memoria despues de cargar una pagina, asi que puede devolver menos de `PAGE_SIZE`.
  - La paginacion por cursor solo esta implementada para `sort=recent`; `sort=popular` no usa cursor.

### Pricing, billing y settings
- `src/app/[locale]/pricing/page.tsx`:
  - client page traducida;
  - lee estado de billing con `/api/billing/status`;
  - bloquea checkout si ya es Pro active/trialing;
  - inicia Stripe Checkout con `/api/billing/checkout`.
- `src/app/[locale]/pricing/layout.tsx`:
  - metadata localizada;
  - JSON-LD `SoftwareApplication`.
- `/api/billing/checkout`:
  - auth obligatoria;
  - reusa `stripeCustomerId`;
  - rechaza doble suscripcion Pro activa con 409;
  - sanea `affiliateCode`.
- `/api/billing/cancel`:
  - programa `cancel_at_period_end` en Stripe;
  - marca `cancelAtPeriodEnd: true`;
  - el usuario conserva Pro hasta fin de periodo.
- `/api/webhooks/stripe`:
  - conserva idempotencia por `stripe_processed_events`;
  - maneja `customer.subscription.created/updated/deleted`, `invoice.payment_succeeded/failed`;
  - lee defensivamente `current_period_*` por cambios recientes de tipos/API Stripe;
  - guarda `cancelAtPeriodEnd`;
  - hace cross-check de customer.
- `src/app/[locale]/dashboard/settings/page.tsx`:
  - perfil visual con foto/nombre/email;
  - creditos diarios/mensuales y countdown;
  - plan, renovacion/cancelacion;
  - stats;
  - edicion de `displayName`.
- `/api/user/profile`:
  - valida `displayName` (3-30 chars, regex, palabras prohibidas);
  - unicidad con coleccion `usernames`.

### SEO, robots, sitemap y config
- `src/lib/seo.ts`:
  - `SITE_URL = "https://miniaitura.com"`;
  - `generateAltText` para miniaturas.
- `src/app/robots.ts`:
  - permite publico;
  - bloquea `/en/dashboard/`, `/es/dashboard/` y `/api/`;
  - apunta a sitemap.
- `src/app/sitemap.ts`:
  - incluye paginas estaticas por locale;
  - incluye hasta 5000 generaciones publicas por locale;
  - añade `alternates` hreflang;
  - `revalidate = 3600`.
- `next.config.ts`:
  - usa plugin `next-intl`;
  - `images.remotePatterns` permite `firebasestorage.googleapis.com`;
  - mantiene headers de seguridad del hardening;
  - `serverActions.bodySizeLimit = "12mb"` aunque el flujo principal usa API routes.
- `vercel.json`:
  - cron diario `0 1 * * *` a `/api/cron/cleanup-rate-limits`.

### Scripts y migracion
- `scripts/migrate-gallery-to-generations.ts`:
  - migra `users.gallery[]` legacy a `generations`;
  - dry-run por defecto;
  - fases `copy`, `verify`, `cleanup`;
  - usa ids deterministas `${uid}__mig__${i}` para idempotencia.
- `scripts/delete-collection.ts`:
  - one-off dry-run por defecto para borrar todos los docs de una coleccion;
  - requiere `--commit`.

### Tests actuales
- Suite actual: 52 tests.
- Cobertura añadida/no documentada previamente:
  - `prompt-enhancer`: builder, fallback, normalizacion `[Image N]`/`[Imagen N]`.
  - `style-presets`: minimo 6 presets, ids unicos, nichos clave.
  - `display-name`: validacion de nombres.
  - `credit-pricing`: coste FREE fijo y PRO por modos.
  - resets diarios/mensuales.
  - humo de `/api/generate`, `/api/user/credits`, webhooks Stripe.
- Limitacion: siguen siendo tests mayormente unitarios/smoke; no hay integracion completa end-to-end con Firebase/Stripe/Gemini/fal reales.

### Documentacion antigua que ya no debe tratarse como canonica si contradice al codigo
- `MiniAItureDOC.md` conserva secciones antiguas que hablan de:
  - R2/Cloudflare como storage;
  - `gallery` dentro del documento de usuario;
  - historial local/IndexedDB;
  - ausencia de i18n;
  - rutas planas sin `[locale]`;
  - estados de calidad pendientes ya implementados parcialmente.
- `MiniAItura_Claude_Code_Instructions.md` y `MiniAItura_Redesign_Claude_Code.md` son utiles como intencion de producto, pero el codigo actual ya diverge en detalles:
  - el generador permite varias referencias, no una;
  - el estilo es textarea editable + presets rapidos + sugeridor, no tabs completos;
  - la landing actual es minimalista con marquee de pingüinos, no una landing larga completa con todas las secciones;
  - el modelo de pricing actual por modos es 100 +/- 25, no exactamente 100 -> 70.
- Para continuar trabajo, tomar esta entrada + codigo actual como referencia primaria. Usar los docs grandes solo para entender intencion y gaps.

### Deuda/puntos a vigilar antes de nuevos cambios
- Instalar/actualizar dependencias locales (`npm install`) y limpiar `.next` antes de validar typecheck/build.
- Revisar y decidir si eliminar `storeProGalleryImages` y `users.gallery` legacy tras migracion real.
- Si se exige auditoria exacta, enlazar `creditTransactions.generationId` con el documento `generations` creado.
- Definir comportamiento si Storage/generations falla despues de generar: ahora el usuario recibe la imagen aunque no se persista.
- Endurecer paginacion/filtros de galeria publica si crece el volumen.
- Revisar copy de pricing: todavia menciona detalles tecnicos como `512px` en traducciones, aunque los docs de rediseño pedian copy mas orientado a beneficios.
- `MiniAItureDOC.md` y este changelog vuelven a estar desincronizados en muchas secciones historicas; este changelog ahora documenta el estado real mas reciente.

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
