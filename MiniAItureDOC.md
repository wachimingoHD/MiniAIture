# DocMiniAItures - Estado actual del proyecto

## 0) Actualización canónica (2026-05-03, Phase 2 Core monetizable)

Esta sección **supersede** cualquier apartado anterior que entre en conflicto (especialmente secciones 11, 16, 17, 22, 23 y 25).

### 0.1 Estado real verificado

- `npm run lint`: OK
- `npm run test`: OK (suite unitaria + smoke API)
- `npm run build`: OK

### 0.2 Lo que ya está implementado

- Auth real con Firebase:
  - cliente (`sign in` + ID token),
  - servidor (`verifyIdToken` con Firebase Admin).
- Firestore operativo para identidad, créditos, plan y estados de suscripción.
- Gating server-side en `POST /api/generate`:
  - auth obligatoria,
  - validaciones de plan Free/Pro,
  - débito atómico de créditos,
  - reembolso explícito ante fallo de generación,
  - errores de negocio (`401`, `402`, `429` y validaciones de plan).
- Stripe core monetizable:
  - `POST /api/billing/checkout`,
  - `GET /api/billing/status`,
  - `POST /api/webhooks/stripe` con verificación de firma y mutaciones en Firestore.
- Persistencia de galería Pro en servidor:
  - guardado de imágenes en **Firebase Storage**,
  - índice `gallery` en `users/{uid}` con política FIFO (máx. 200).
- Rate-limit mínimo para Free por IP (1 generación/día).
- App Check server-side activable por entorno (toggle).
- Logging estructurado para trazabilidad de créditos/webhooks/generación.

### 0.3 Cambios funcionales de frontend ya activos

- Página `/pricing` implementada.
- Flujo de suscripción desde botón de pricing hacia Stripe Checkout.
- Estado de suscripción reflejado en UI según `/api/billing/status`.
- Página `/gallery` para usuarios Pro con consulta de imágenes generadas.
- **Local history eliminado**: ya no se usa IndexedDB/localStorage para historial.

### 0.4 Decisión de almacenamiento (actual)

- Se descartó Cloudflare R2 para el sprint actual.
- El almacenamiento vigente de imágenes Pro es **Firebase Storage**.

### 0.5 Endpoints vigentes de negocio

- `POST /api/generate`
- `GET /api/user/credits`
- `POST /api/billing/checkout`
- `GET /api/billing/status`
- `POST /api/webhooks/stripe`
- `GET /api/gallery`

### 0.6 Notas de alcance

- Afiliados siguen fuera de sprint 1 (schema/preparación, sin activación comercial completa).
- Política de retención/borrado de imágenes tras cancelación Pro: pendiente de definición de negocio.

### 0.7 Actualizacion adicional (2026-05-03, supersede detalles anteriores en conflicto)

#### Frontend y UX (estado real actual)
- `DEFAULT_NANO_BANANA_PARAMS.aspect_ratio` ahora es `16:9`.
- El panel de usuario final fue separado del panel de desarrollador:
  - `User options` controla `Low priority mode` y resolucion orientada a negocio.
  - `Developer parameters` es desplegable e incluye `aspect_ratio` y vista JSON de params efectivos.
- `Reference images` esta debajo de `Prompt`.
- El boton de generacion muestra coste de creditos y saldo (`Daily/Monthly`).
- Se restauro la UI visual de `Estimated cost` (tarjetas) y de `Result` (preview de imagenes + descarga + metadata).
- En cabecera de la home se muestra de nuevo: email, plan y creditos del usuario autenticado.

#### Reglas de plan en UI de resolucion
- Free:
  - resolucion bloqueada en `512`.
  - opciones superiores marcadas como `Pro feature`.
  - `Low priority` forzado (sin descuento de creditos adicional por esta regla).
- Pro:
  - no se muestra la opcion `512` en selector principal.
  - puede activar/desactivar `Low priority` con descuento de creditos.

#### Mapeo funcional de resoluciones (UI -> params tecnicos)
- `512` -> base `512`, sin upscale.
- `1K` -> base `512` + upscale `1K`.
- `2K` -> base `1K` + upscale `2K`.
- `4K` -> base `1K` + upscale `4K`.

#### Pricing y Gallery
- `/pricing` ya no permite checkout cuando la suscripcion Pro ya esta activa/trialing:
  - boton deshabilitado.
  - texto `Already acquired`.
- `/gallery` permite abrir cada entrada en modal con imagen grande, prompt completo, provider y fecha.

#### Simulacion de desarrollador
- `POST /api/generate` soporta modo simulacion en entorno no productivo:
  - `success`: consume creditos y registra stats sin generar imagen real.
  - `reject`: simula rechazo y ejecuta reembolso.

#### Creditos y pricing dinamico
- El coste de generacion ya no es fijo en runtime para todas las variantes de UI.
- Formula activa:
  - base: 100 creditos.
  - `512`: -25%.
  - `1K`: sin cambio.
  - `2K`: +25%.
  - `4K`: +50%.
  - `low priority` en Pro: -25%.

#### Fechas en Firestore (normalizacion completa)
- Se unifico el formato de fechas a ISO string en documentos de negocio:
  - `credits.dailyResetAt`.
  - `credits.monthlyResetAt`.
  - `subscriptionStart`.
  - `subscriptionEnd`.
  - `gallery[].createdAt`.
- Se elimina el esquema dual anterior en nuevas escrituras.
- `GET /api/gallery` normaliza entradas legacy al vuelo para compatibilidad temporal y orden correcto.

#### Storage, stats y calidad
- Persistencia Pro confirmada en Firebase Storage + indice `gallery` en Firestore.
- Ajustado registro de stats para evitar desalineacion de `falGenerations` en fallback/proveedor efectivo.
- Estado verificado:
  - `npm run lint`: OK
  - `npm run test`: OK
  - `npm run build`: OK
## 1) Visión general del producto

MiniAItures es una plataforma web de generación de miniaturas para YouTube con IA, construida en Next.js. El usuario introduce un prompt (y opcionalmente imágenes de referencia) y el sistema genera una imagen optimizada para miniatura usando Nano Banana 2 vía Gemini API, con upscaling posterior opcional vía fal.ai.

**Propuesta de valor:** Miniaturas de calidad profesional generadas en segundos, sin conocimientos de diseño, orientadas al nicho de creadores de YouTube.

---

## 2) Stack y versiones

- `next`: `16.2.4`
- `react`: `19.2.4`
- `react-dom`: `19.2.4`
- `typescript`: `^5`
- `tailwindcss`: `^4`
- `eslint`: `^9`

Scripts:

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`

Frontend en modo oscuro (tema oscuro por clases Tailwind).

---

## 3) Proveedores de IA y modelos

### 3.1 Generación de imagen

| Proveedor | Modelo | Rol |
|---|---|---|
| Google Gemini | `gemini-3.1-flash-image-preview` | Primario |
| fal.ai | `fal-ai/nano-banana-2` | Fallback (sin referencias) |
| fal.ai | `fal-ai/nano-banana-2/edit` | Fallback (con referencias) |

### 3.2 Upscaling

| Proveedor | Modelo | Rol |
|---|---|---|
| fal.ai | `fal-ai/seedvr/upscale/image` | Post-proceso opcional |

### 3.3 Tiers de capacidad Google (Flex vs Standard)

| Tier | Precio | Latencia | Falla cuando |
|---|---|---|---|
| **Standard** | Precio completo | Segundos, predecible | Errores de contenido, capacidad extrema |
| **Flex** | ~50% de Standard | Variable: 10-15s en horas bajas (mañana/mediodía España), 1-5 min en horas pico (tarde-noche España) | Solo falla con 503/429 cuando Google no tiene capacidad oportunista disponible |

Horas de baja carga europea coinciden con madrugada en California (centro de datos de Google). En esas ventanas, Flex es prácticamente igual de rápido que Standard a mitad de precio.

---

## 4) Variables de entorno

| Variable | Obligatoriedad | Efecto si falta |
|---|---|---|
| `GEMINI_API_KEY` | Obligatoria | Error 500 directo en `/api/generate` y `/api/estimate-cost` |
| `FAL_API_KEY` | Recomendada | Google funciona; fallback a fal y upscale quedan deshabilitados |
| `AUTO_FALLBACK_TO_FAL` | Opcional | Default efectivo: `true` |

---

## 5) Estructura principal

Archivos clave:

```
src/
├── lib/
│   └── nanoBanana.ts          # Tipos compartidos, defaults, enums, límites
├── app/
│   ├── api/
│   │   ├── generate/
│   │   │   └── route.ts       # Endpoint principal de generación
│   │   └── estimate-cost/
│   │       └── route.ts       # Precálculo de costes antes de generar
│   └── page.tsx               # UI completa
.env.example
```

---

## 6) Modelo de datos compartido (`src/lib/nanoBanana.ts`)

### Parámetros funcionales (`NanoBananaParams`)

| Parámetro | Tipo | Valores válidos |
|---|---|---|
| `prompt` | `string` | Texto libre, obligatorio no vacío |
| `num_images` | `number` | 1..4 |
| `flex_mode` | `boolean` | — |
| `enable_google_search` | `boolean` | — |
| `aspect_ratio` | `AspectRatio` | Enum definido en tipos |
| `resolution` | `Resolution` | `512`, `1K`, `2K`, `4K` |
| `upscale_enabled` | `boolean` | — |
| `upscale_resolution` | `UpscaleResolution` | `1K`, `2K`, `4K` |

### Defaults (`DEFAULT_NANO_BANANA_PARAMS`)

```
num_images           = 1
flex_mode            = false
enable_google_search = false
aspect_ratio         = "1:1"
resolution           = "1K"
upscale_enabled      = false
upscale_resolution   = "2K"
```

### Límites de referencias

```
MAX_REFERENCE_IMAGES             = 10
MAX_REFERENCE_IMAGES_TOTAL_BYTES = 5 MB
```

---

## 7) Backend - Arquitectura global

El backend está dividido en dos endpoints:

1. `/api/generate` → ejecución real de generación.
2. `/api/estimate-cost` → estimación previa de coste.

Ambos comparten la validación de entrada:

- prompt obligatorio no vacío
- enums estrictos: `resolution`, `aspect_ratio`, `upscale_resolution`
- límites de referencia por cantidad y tamaño

---

## 8) Endpoint `/api/generate` - Flujo detallado

### 8.1 Parseo y validación

Se valida `body` y se transforma a:

- `params: NanoBananaParams`
- `referenceImages: ReferenceImageInput[]`

Errores de entrada → `400`.

### 8.2 Intento primario Google (`runGoogleGeneration`)

**Construcción del payload:**
- `safetySettings`: todas las categorías soportadas en `OFF`
- `contents`: imágenes de referencia inline (si las hay) + texto del prompt
- `generationConfig.imageConfig`: `aspectRatio` e `imageSize` según parámetros
- `service_tier`: `"flex"` si `flex_mode=true`, `"standard"` si no
- `tools: [google_search]` solo si `enable_google_search=true`

**Ejecución:**
Genera `num_images` con bucle de requests individuales (1 request por imagen). Esto es por diseño: permite recolectar metadatos independientes por imagen y manejar fallos parciales.

**Timeouts por imagen:**
- Standard: 2 minutos
- Flex: 10 minutos

**Recolección de resultados:**
- Imágenes devueltas (base64)
- `requestIds`
- Usage y tokens consumidos
- Finish reasons, messages, texts
- Safety ratings
- Response IDs

**Si hay imágenes:** calcula coste token-based con `computeTokenCostSummary` y devuelve `GoogleSuccess`.

**Si no hay imágenes:** construye error enriquecido con `formatGoogleNoImageError` y devuelve `GoogleFailure` con razón categorizada.

### 8.3 Cálculo de coste Google en generación real

Método: `token_usage_estimate`.

**Tarifas internas (USD por 1M tokens):**

| Tier | Input | Output texto | Output imagen |
|---|---|---|---|
| Standard | 0.5 | 3 | 60 |
| Flex | 0.25 | 1.5 | 30 |

**Lógica especial:**
- Si faltan detalles de modalidad en el output, se asume output imagen (caso conservador).
- `enable_google_search` agrega nota de posible coste externo no modelable exactamente.

### 8.4 Regla especial: Flex → Standard por capacidad

Si el intento primario fue en Flex **y** falla por capacidad (`isGoogleCapacityFailure` detecta 503 o 429 relacionados con capacidad):

1. Se reintenta automáticamente en Google Standard.
2. Si Standard responde con imágenes → se devuelve resultado Google sin pasar a fal.
3. Si Standard también falla (sea por capacidad u otro motivo) → el flujo continúa y puede derivar a fal según las reglas globales.

Se expone `googleTierFallback: true` en la respuesta cuando este retry ocurre, junto con metadatos del fallo original de Flex.

### 8.5 Decisión de fallback a fal.ai (`shouldFallbackToFal`)

**Condiciones de elegibilidad (cualquiera activa el fallback):**
- `fallbackEligible: true` en el objeto de fallo Google
- Razón de fallo categorizada como `OTHER` o `IMAGE_OTHER`
- Código de estado HTTP `>= 500`
- Código de estado `429` (rate limit)
- Código de estado `422` (contenido rechazado por políticas)

**Requisitos de configuración (ambos necesarios):**
- `AUTO_FALLBACK_TO_FAL = true`
- `FAL_API_KEY` presente

Si no se cumplen los requisitos de configuración, el fallback no ocurre aunque sea elegible.

### 8.6 Ejecución fallback fal.ai (`runFalGeneration`)

Endpoint dinámico:
- sin referencias → `fal-ai/nano-banana-2`
- con referencias → `fal-ai/nano-banana-2/edit`

**Mapeo de parámetros Google → fal:**

| Parámetro Google | Parámetro fal | Nota |
|---|---|---|
| `prompt` | `prompt` | Directo |
| `num_images` | `num_images` | Directo |
| `aspect_ratio` | `aspect_ratio` | Directo |
| `resolution` | `resolution` | `512` → `0.5K`; resto igual |
| `enable_google_search` | `enable_web_search` | Renombrado |
| `flex_mode` | — | Sin equivalente. Registrado como unmapped |

**Parámetros fijos en fal (no configurables por el usuario):**
```
safety_tolerance : "6"
limit_generations: true
output_format    : "png"
sync_mode        : false
```

Referencias: se envían como data URLs en `image_urls`.

El payload enviado a fal es el original del request. Si hubo un retry Flex→Standard previo, ese intento no modifica el payload que recibe fal (solo el `service_tier` se gestiona internamente en Google).

### 8.7 Cálculo de coste fal en generación real

Método: `fal_rate_formula`.

**Flujo:**
1. Intenta leer pricing real desde `https://api.fal.ai/v1/models/pricing`.
2. Si falla, usa fallback estático interno (`0.08 USD` base).
3. Aplica multiplicador por resolución:

| Resolución | Multiplicador |
|---|---|
| `512` | ×0.75 |
| `1K` | ×1 |
| `2K` | ×1.5 |
| `4K` | ×2 |

4. Si `enable_web_search=true`, suma `0.015 USD/request`.

La respuesta incluye una nota indicando si el precio vino de la API real de fal o del fallback estático.

### 8.8 Upscale opcional post-proceso (`applyUpscaleIfEnabled`)

**Condiciones para ejecutar el upscale (todas deben cumplirse):**
- `upscale_enabled = true`
- `upscale_resolution` es mayor que `resolution` base
- `FAL_API_KEY` presente

**Modelo:** `fal-ai/seedvr/upscale/image`

**Mapeo de target:**

| `upscale_resolution` | Target fal | MP estimados (fallback) |
|---|---|---|
| `1K` | `1080p` | 2.0736 MP |
| `2K` | `1440p` | 3.6864 MP |
| `4K` | `2160p` | 8.2944 MP |

**Cálculo de coste de upscale:**
1. Intenta leer `unit_price` real desde pricing API de fal para `fal-ai/seedvr/upscale/image`.
2. Si falla → fallback: `0.001 USD/MP`.
3. Si la API devuelve dimensiones reales de la imagen generada → usa MP reales (`width × height`).
4. Si no → usa MP estimados del target (tabla arriba).

**Merge de coste (`mergeCostWithUpscale`):**
- Suma `totalUpscaleCost` al coste base del proveedor de generación.
- Recalcula `perImage`.
- Concatena notas de ambos costes.

**Salida visual:**
- `images`: imágenes finales (upscaled si aplicó el upscale).
- `originalImages`: imágenes pre-upscale (solo presente cuando se ejecutó upscale).

### 8.9 Timeouts por operación

| Operación | Timeout |
|---|---|
| Google Standard (por imagen) | 2 minutos |
| Google Flex (por imagen) | 10 minutos |
| fal generación | 10 minutos |
| fal upscale | 10 minutos |

### 8.10 Respuesta final de `/api/generate`

**Campos siempre presentes:**

```
providerUsed       : "google" | "fal"
fallbackTriggered  : boolean
fallbackReason     : string | null
endpointId         : string
requestId          : string
requestIds         : string[]
paramsUsed         : NanoBananaParams
referenceImages    : ReferenceImageMetadata[]
cost               : CostSummary
images             : GeneratedImage[]
startedAt          : string (ISO)
endedAt            : string (ISO)
createdAt          : string (ISO)
```

**Campos condicionales:**

```
originalImages     : GeneratedImage[]   — solo si hubo upscale
primaryFailure     : FailureDetail      — solo si hubo fallo en proveedor primario
fallbackInfo       : FallbackDetail     — solo si se usó fallback
googleTierFallback : TierFallbackDetail — solo si hubo retry Flex→Standard
```

---

## 9) Endpoint `/api/estimate-cost` - Flujo detallado

Objetivo: entregar precálculo separado para Google y fal **antes** de que el usuario genere.

Comparte con `/api/generate` la misma validación de entrada (prompt, enums, límites de referencia).

### 9.1 Estimación Google

1. Intenta `countTokens` de Gemini con el payload real construido igual que en generación.
2. Si falla, aplica fallback local:
   - Tokens de prompt: `prompt.length / 4`
   - Tokens por imagen de referencia: `560 tokens/imagen`

3. Estimación de tokens output por resolución:

| `resolution` | Output image tokens estimados |
|---|---|
| `512` | 560 |
| `1K` | 1120 |
| `2K` | 1120 |
| `4K` | 2000 |

4. Aplica tarifas según tier (Flex o Standard) para calcular coste total y por imagen.

### 9.2 Estimación fal

1. Determina endpoint: `fal-ai/nano-banana-2/edit` si hay referencias, `fal-ai/nano-banana-2` si no.
2. Lee pricing real de fal (o usa fallback estático si falla).
3. Aplica multiplicador por resolución (misma tabla que en generación real).
4. Si `enable_google_search=true`, suma `0.015 USD/request`.

### 9.3 Estimación de upscale

Misma lógica de validación que en generación real (`upscale_enabled`, target > base).
Lee pricing de `fal-ai/seedvr/upscale/image` y usa MP estimados por target.

### 9.4 Respuesta final de `/api/estimate-cost`

Tres bloques independientes. Los totales de `google` y `fal` **ya incluyen** el `upscaleEstimatedCost`:

```json
{
  "upscale": {
    "enabled": boolean,
    "targetResolution": string,
    "estimatedCostPerImage": number,
    "totalEstimatedCost": number,
    "notes": string
  },
  "google": {
    "total": number,
    "perImage": number,
    "breakdown": { "inputTokens", "outputTokens", "inputCost", "outputCost" },
    "includesUpscale": boolean
  },
  "fal": {
    "total": number,
    "perImage": number,
    "breakdown": { "baseCost", "resolutionMultiplier", "webSearchExtra" },
    "includesUpscale": boolean
  }
}
```

---

## 10) Costes de API: tarifas y aproximaciones

### 10.1 Tarifas Google (USD por 1M tokens)

| Tier | Input | Output texto | Output imagen |
|---|---|---|---|
| Standard | 0.5 | 3 | 60 |
| Flex | 0.25 | 1.5 | 30 |

### 10.2 Coste aproximado por imagen en euros

| Resolución | Standard | Flex |
|---|---|---|
| 512px | ~0.045€ | ~0.023€ |
| 1K | ~0.067€ | ~0.034€ |
| 2K | ~0.101€ | ~0.051€ |
| 4K | ~0.151€ | ~0.076€ |

> Aproximaciones basadas en tokens típicos. El coste real varía según longitud del prompt e imágenes de referencia.

### 10.3 Coste upscaling fal.ai

~0.003€ por imagen (leído en runtime de la API de fal; fallback estático: `0.001 USD/MP`).

### 10.4 Fallback estático interno (si falla pricing API de fal)

```
fal base     : 0.08 USD
fal upscale  : 0.001 USD/MP
```

---

## 11) Frontend - Estado funcional

### 11.1 Parámetros disponibles en UI

Todos los de `NanoBananaParams` están expuestos con control individual y botón "Por defecto" por parámetro:
`prompt`, `num_images`, `flex_mode`, `enable_google_search`, `aspect_ratio`, `resolution`, `upscale_enabled`, `upscale_resolution`.

### 11.2 Referencias de imagen

- Subida múltiple con drag & drop o selector
- Validaciones: máx 10 archivos, máx 5 MB total, solo `image/*`
- Conversión a base64 para envío a API
- Previsualización local con `URL.createObjectURL`
- Eliminación individual y clear all

### 11.3 Historial local (IndexedDB)

- Motor: IndexedDB (`nano-banana-2-db`, store `history`)
- Fallback y migración automática desde legacy localStorage
- Límite: máx 40 entradas (FIFO, elimina la más antigua)
- Solo persiste en el dispositivo actual; se pierde al limpiar datos del navegador

Cada entrada guarda:
```
proveedor API usado
endpoint fal (si aplica)
request ID
prompt + params completos usados
referencias usadas (metadata)
coste total y por imagen
duración de generación (ms)
originalImages (si hubo upscale)
images finales
```

### 11.4 Precálculo de coste en UI

Se llama a `/api/estimate-cost` antes de generar y se muestran tres bloques: upscale estimado, Google estimado, fal estimado. Permite al usuario comparar costes entre proveedores antes de lanzar la generación.

### 11.5 Estado de generación

- Botón `Generar imagen` → pasa a estado `Generando...` durante el proceso
- Banner informativo visible cuando `flex_mode=true` (avisa que puede tardar minutos)
- Errores de API capturados y mostrados en UI con detalle

---

## 12) Modelo de negocio

### 12.1 Planes

| Plan | Descripción |
|---|---|
| **Gratuito** | 100 créditos diarios, generación en 512px con marca de agua |
| **Pro** | Créditos diarios + pool mensual, resoluciones superiores, sin marca de agua, galería persistente |

### 12.2 Precio Pro

`[PENDIENTE: precio base €/mes sin definir.]`

Consideraciones para el cálculo:
- Coste de API por imagen × uso esperado medio por usuario activo
- Margen operativo
- Comisión afiliados: 10% de descuento al usuario + 10% de comisión al creador + Stripe ~3% = ~23% sobre precio bruto en usuarios afiliados
- Con programa de afiliados como canal principal de adquisición, la mayoría de usuarios iniciales serán afiliados, por lo que el margen efectivo en la base inicial será ~23% inferior al precio bruto

### 12.3 Programa de afiliados

Dirigido a creadores de contenido del nicho "YouTube con IA".

**Mecánica:**
- El creador recibe un código de afiliado propio.
- El usuario aplica el código al suscribirse → **10% de descuento permanente** mientras mantenga la suscripción.
- El creador recibe **10% de comisión recurrente** del precio pagado por cada usuario referido mientras la suscripción esté activa.
- Stripe gestiona los pagos y las comisiones.

**Por qué este modelo:** alinea los incentivos del afiliado con la retención del usuario. El creador no cobra por venta única sino mientras el usuario permanece activo, por lo que tiene incentivo en recomendar la plataforma solo a su audiencia genuinamente interesada.

`[PENDIENTE: confirmar si el descuento y la comisión son permanentes sin fecha de caducidad o tienen condiciones de expiración.]`

### 12.4 Canal de adquisición MVP

Único canal planificado: contacto directo con creadores del nicho "YouTube con IA" (creadores de cursos y contenido sobre el tema). Se les muestra la plataforma funcionando y se les ofrece código de creador + código de descuento para su audiencia.

---

## 13) Sistema de créditos

### 13.1 Coste por acción

- Generar 1 imagen: **100 créditos** (fijo, independientemente de resolución o proveedor).

### 13.2 Plan Gratuito

**Asignación:** 100 créditos diarios. Reseteo relativo: 24h después del primer gasto del día (ver sección 13.4).

**Restricciones de generación:**
- Resolución fija: 512px
- Marca de agua obligatoria
- Motor: Gemini Flex obligatorio
- Sin upscaling
- Requiere registro con verificación de email para activación
- Sin galería persistente — las imágenes no se guardan en servidor

**Comportamiento ante fallos:**
- Gemini Flex falla por **saturación de capacidad** (503/429): se devuelven los créditos al usuario y se informa de que los servidores están saturados. **No** se intenta fal.ai como alternativa de capacidad.
- Gemini falla por **error de contenido** (políticas, famosos, etc.): fallback automático a fal.ai (que permite contenido restringido por Gemini: famosos, caras, eventos históricos).

**Protección anti-abuso (Free):**
- Rate limiting por IP: máximo 1 generación/día por IP, independientemente del número de cuentas. Aplicado solo a usuarios Free.
- Firebase App Check habilitado: verifica que los requests provienen de la app real, bloqueando scripts automatizados.
- Verificación de email obligatoria antes de poder generar.
- No se implementa bloqueo duro por IP como control principal (IPs dinámicas, compartidas, VPN lo hacen poco fiable); se usa como capa adicional, no única.

### 13.3 Plan Pro

`[PENDIENTE: elegir entre Opción A y Opción B. Fijar números exactos.]`

**Opción A — Reseteo 24h desde primer uso:**
- N créditos diarios que se resetean 24h después del primer gasto del día. Si no se usan, se pierden.
- Pool mensual de reserva: M créditos, no se regeneran hasta la siguiente renovación.
- `[PENDIENTE: N = 400 o 500 créditos diarios. M = 2.000 o 3.000 créditos mensuales.]`
- Resultado aproximado: 4-5 imágenes/día desde créditos diarios + 20-30 adicionales desde pool. Máximo mensual total: ~100-200 imágenes.

**Opción B — Recarga escalonada cada 5h:**
- Cada 5 horas el usuario recibe 100 créditos (máx 4-5 recargas/día = mismo techo diario que Opción A).
- Pool mensual de reserva: igual que Opción A.
- Ventaja frente a Opción A: distribuye el uso a lo largo del día, reduce spikes de coste de API, genera más puntos de retorno diario y percepción de beneficio continuo.

**Comportamiento Pro ante fallos de Gemini:**
- Fallo por **saturación de Flex**: reintento automático en Standard (diferencia de coste la asume la plataforma; el usuario descuenta siempre 100 créditos).
- Fallo por **error de contenido**: fallback a fal.ai (mismos 100 créditos).

### 13.4 Lógica de reseteo de créditos (Free y Pro)

El reseteo es **relativo por usuario**, no global. No hay cron job que recorra todos los usuarios a medianoche.

**Mecanismo:**
- Al primer gasto del día se registra `dailyResetAt = now + 24h` en Firestore.
- En cada request a `/api/generate`, antes de procesar, se comprueba: `if (now > dailyResetAt)` → se resetean los créditos diarios y se actualiza `dailyResetAt`.
- Esto funciona igual para todos los husos horarios sin configuración adicional: cada usuario tiene su propio reloj de 24h desde su primer uso.

**Por qué no usar hora fija (00:00 UTC):** penaliza usuarios en zonas horarias donde medianoche UTC no coincide con el final natural del día de uso. El sistema relativo es más justo y globalmente neutral.

**UX:** mostrar en la interfaz el contador "próximo reseteo en X horas Y minutos" para eliminar la frustración de no saber cuándo se recuperan los créditos.

### 13.5 Opciones de calidad para Pro

| Tier de calidad | Flujo técnico | Coste para usuario |
|---|---|---|
| **Base** | Generación 512px vía Gemini Flex + upscaling a 1K vía fal.ai | 100 créditos |
| **Calidad media** | Generación nativa 1K vía Gemini | 100 créditos |
| **Alta calidad** | Generación nativa 1K vía Gemini + upscaling a 2K o 4K vía fal.ai | 100 créditos |

> El coste en créditos es igual en los tres tiers. La diferencia es el coste real de API que absorbe la plataforma. El tier Base cuesta ~0.023€ (Flex 512px) + ~0.003€ (upscale) = ~0.026€. El tier Calidad media cuesta ~0.067€ (Standard 1K). Validar que el margen del precio Pro cubre todos los tiers antes de activarlos.

---

## 14) Estrategia de resiliencia

```
┌─────────────────────────────────────────────────────────────────┐
│ Request entra a /api/generate                                   │
│                                                                 │
│  1. Intento primario: Google Gemini (Flex o Standard)           │
│     ├── Éxito con imágenes → resultado Google                   │
│     └── Fallo                                                   │
│         ├── Si fue Flex + fallo por capacidad:                  │
│         │   └── Retry automático en Google Standard             │
│         │       ├── Éxito → resultado Google (con metadata      │
│         │       │   googleTierFallback)                         │
│         │       └── Fallo → evaluar fallback a fal              │
│         └── Si fue Standard (o Flex por razón no-capacidad):    │
│             └── Evaluar fallback a fal                          │
│                                                                 │
│  2. Fallback a fal.ai (si shouldFallbackToFal = true)           │
│     ├── Éxito → resultado fal                                   │
│     └── Fallo → error final al cliente                          │
│                                                                 │
│  3. Upscale opcional (independiente del proveedor de generación)│
│     └── Corre si upscale_enabled=true y FAL_API_KEY presente   │
└─────────────────────────────────────────────────────────────────┘
```

**Por qué este orden:** Flex es más barato pero puede fallar por capacidad. Standard es la red de seguridad dentro de Google. fal.ai es el fallback de último recurso para errores de contenido y fallos no recuperables de Google.

**Diferencia por plan:**
- **Gratuito:** si Flex falla por saturación, se devuelven los créditos y se informa al usuario. No se intenta Standard ni fal.
- **Pro:** si Flex falla por saturación, reintento automático en Standard (coste lo asume la plataforma). Si falla por contenido, fallback a fal.

---

## 15) Protección financiera y operativa

- **Hard cap de gasto mensual** configurado en fal.ai y Gemini API desde el primer día. Límite máximo de gasto en API independiente de la lógica de la aplicación.
- **Rate limiting** por IP para usuarios gratuitos (protección ante abuso): máx 1 generación/día por IP.
- **Separación de ingresos:** los ingresos de cada mes se mantienen en cuenta separada hasta que el mes termine, como protección ante devoluciones y chargebacks.
- **Cierre de servicio:** Stripe gestiona devoluciones proporcionales automáticamente si la plataforma cierra.
- **Stripe comisión estándar:** 2.9% + 0.30€ por transacción.

---

## 16) Infraestructura y stack de datos

### 16.1 Stack completo

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend + API Routes | Next.js en Vercel | Backend suficiente para toda la lógica de servidor |
| Autenticación | Firebase Auth (Google Sign-In) | Login con Google, sin fricción |
| Base de datos | Firestore (Firebase) | Documentos por usuario, lecturas/escrituras bajas |
| Storage de imágenes | Cloudflare R2 | Egress gratuito; mucho más barato que Firebase Storage |
| Pagos | Stripe | Suscripciones, webhooks, comisiones de afiliados |
| Cron jobs | Vercel Cron | Tareas periódicas si se necesitan; integrado sin infra extra |
| Seguridad app | Firebase App Check | Bloquea requests que no provienen de la app real |

### 16.2 Lógica de servidor: dónde se ejecuta cada cálculo

Todo corre en **Next.js API Routes** (Node.js en Vercel). No se necesita Go ni servidor separado para el MVP.

Endpoints clave adicionales a los ya existentes:

```
/api/generate              → verifica créditos, llama APIs, descuenta créditos, guarda imagen
/api/user/credits          → devuelve estado de créditos del usuario autenticado
/api/webhooks/stripe       → recibe eventos de Stripe y actualiza Firestore
```

**Flujo de una generación con autenticación y créditos:**
1. Frontend llama a `/api/generate` con token Firebase Auth en header.
2. API Route verifica el token → identifica `uid`.
3. Lee Firestore: ¿tiene créditos suficientes? ¿el `dailyResetAt` ha pasado?
4. Si créditos insuficientes → responde 402, no genera.
5. Si suficientes → abre **transacción atómica** en Firestore.
6. Dentro de la transacción: descuenta 100 créditos.
7. Llama a Gemini/fal.
8. Si éxito → guarda imagen en R2, actualiza galería en Firestore, actualiza stats, cierra transacción.
9. Si fallo de API → revierte transacción (créditos devueltos automáticamente).
10. Responde al frontend.

**Nota crítica sobre concurrencia:** las transacciones atómicas de Firestore (`runTransaction`) garantizan que dos requests simultáneos del mismo usuario no pueden generar con los mismos créditos. Firestore reintenta automáticamente la transacción que llegue segunda. Sin esto, un usuario podría explotar race conditions para generar más de lo permitido.

### 16.3 Integración Stripe → Firestore (webhooks)

Stripe envía eventos a `/api/webhooks/stripe`. Cada evento actualiza Firestore:

| Evento Stripe | Acción en Firestore |
|---|---|
| `customer.subscription.created` | `plan = "pro"`, inicializar créditos Pro |
| `invoice.payment_succeeded` | `monthsSubscribed++`, renovar `subscriptionEnd` |
| `invoice.payment_failed` | `subscriptionStatus = "past_due"`, notificar usuario |
| `customer.subscription.deleted` | `plan = "free"`, limpiar acceso Pro |

**Crítico:** verificar la firma del webhook con el secret de Stripe en cada request. Sin esto, cualquiera puede hacer un POST falso activando plan Pro sin pagar.

**Orden correcto de operaciones para evitar estados inconsistentes:**
1. Descontar créditos (transacción atómica).
2. Llamar a la API de generación.
3. Si la API falla → devolver créditos explícitamente (otra transacción).
4. Si éxito → guardar imagen, confirmar.

---

## 17) Esquema de base de datos Firestore

### 17.1 Documento de usuario (`users/{uid}`)

```
users/{uid}
├── email: string
├── plan: "free" | "pro"
├── stripeCustomerId: string
├── stripeSubscriptionId: string
├── subscriptionStatus: "active" | "canceled" | "past_due"
├── subscriptionStart: timestamp
├── subscriptionEnd: timestamp
│
├── credits
│   ├── daily: number                  — créditos diarios restantes
│   ├── dailyResetAt: timestamp        — cuándo se resetean (now + 24h desde primer uso)
│   ├── monthly: number                — pool mensual (solo Pro)
│   └── monthlyResetAt: timestamp      — cuándo se renueva el pool mensual
│
├── affiliate
│   ├── referredBy: string             — código del afiliado que trajo al usuario
│   └── discountActive: boolean
│
├── stats
│   ├── totalImagesGenerated: number
│   ├── totalCreditsUsedFree: number   — créditos gastados mientras era Free (histórico)
│   ├── totalCreditsUsedPro: number    — créditos gastados siendo Pro
│   ├── monthsSubscribed: number       — para calcular LTV
│   ├── googleGenerations: number      — generaciones vía Google API
│   └── falGenerations: number         — generaciones vía fal.ai
│
└── gallery: ImageEntry[]              — solo Pro; máx 200 entradas (array)
```

**`ImageEntry` (cada elemento del array `gallery`):**
```
{
  url: string,          — URL en Cloudflare R2
  prompt: string,
  createdAt: timestamp,
  provider: "google" | "fal"
}
```

### 17.2 Galería por plan

| Plan | Galería |
|---|---|
| **Free** | Sin galería. Las imágenes no se guardan en servidor. El historial local (IndexedDB) persiste solo en el dispositivo. |
| **Pro** | Array `gallery` en Firestore con hasta 200 entradas. Al superar el límite, se elimina la entrada más antigua (FIFO). Las imágenes se almacenan en Cloudflare R2; Firestore guarda solo la URL de referencia. |

**Por qué galería completa para Pro y no solo las últimas 3:** los creadores de YouTube generan múltiples variantes por proyecto y necesitan comparar y reutilizar imágenes anteriores. Limitar a 3 generaría churn. El coste real es despreciable: ~50MB por usuario activo en R2, con egress gratuito en Cloudflare.

**Guardado:** ocurre en la API Route de Next.js en el momento de generación exitosa (server-side), no en el cliente. Esto garantiza que la imagen persiste aunque el usuario cierre el navegador antes de ver el resultado.

### 17.3 Analytics de fallos Flex (documento agregado)

Para monitorizar a qué horas falla Gemini Flex por saturación de capacidad, se mantiene un documento agregado por día (no un documento por fallo):

```
analytics/flex_failures/{YYYY-MM-DD}
├── hour_00: number
├── hour_01: number
├── ...
└── hour_23: number
```

Cada fallo de Flex por capacidad incrementa el contador de la hora correspondiente (UTC). Esto permite identificar ventanas horarias problemáticas con coste mínimo: 1 escritura por fallo, 1 lectura para ver el día completo.

---

## 18) Autenticación y gestión de usuarios

### 18.1 Registro y onboarding

- Autenticación exclusivamente vía **Firebase Auth con Google Sign-In**.
- Registro obligatorio para generar (incluso en plan Free).
- Verificación de email requerida para activar el plan Free y poder generar.

### 18.2 Transición Free → Pro

- Al pasar a Pro, la cuenta continúa siendo la misma. Los datos históricos de Free se preservan.
- `totalCreditsUsedFree` queda congelado como registro histórico; no se borra ni se mezcla con `totalCreditsUsedPro`.
- Si un usuario Pro cancela y vuelve a Free, `totalCreditsUsedFree` refleja el acumulado histórico total (previo y posterior a la sub Pro).
- La galería Pro (hasta 200 imágenes) se mantiene accesible mientras el plan sea Pro. Si cancela y vuelve a Free, las imágenes existentes en R2 quedan huérfanas — `[PENDIENTE: decidir política de retención/borrado al cancelar]`.

### 18.3 Firebase App Check

Habilitado en producción. Verifica que los requests a las API Routes provienen de la aplicación real (no de scripts, bots o clientes alternativos). Capa de seguridad adicional que complementa el rate limiting por IP y la verificación de token Firebase Auth.

---

## 19) Idioma de la plataforma

La web estará **en inglés** como idioma principal y único en el MVP. Razones:

- El mercado de creadores de YouTube en inglés es ~10x mayor que el hispanohablante.
- El canal de adquisición (creadores de contenido "YouTube con IA") consume contenido mayoritariamente en inglés.
- Implementar i18n (internacionalización) en el MVP añade complejidad sin retorno inmediato.

**Decisión sobre i18n:** no se implementa internacionalización en la fase inicial. Todo el copy se escribe directamente en inglés (no en español para traducir después). Se revisará cuando haya demanda explícita de usuarios.

**Si en el futuro se implementa i18n**, la solución estándar para Next.js es `next-intl`:
- Archivos de traducción por idioma: `messages/en.json`, `messages/es.json`, etc.
- Detección automática de idioma via header `Accept-Language` del navegador.
- Redirección a URL con prefijo de idioma (`/en/`, `/es/`).
- Preferencia guardada en cookie para visitas posteriores.

---

## 20) Estrategia de resiliencia

```
┌─────────────────────────────────────────────────────────────────┐
│ Request entra a /api/generate                                   │
│                                                                 │
│  1. Intento primario: Google Gemini (Flex o Standard)           │
│     ├── Éxito con imágenes → resultado Google                   │
│     └── Fallo                                                   │
│         ├── Si fue Flex + fallo por capacidad:                  │
│         │   └── Retry automático en Google Standard             │
│         │       ├── Éxito → resultado Google (con metadata      │
│         │       │   googleTierFallback)                         │
│         │       └── Fallo → evaluar fallback a fal              │
│         └── Si fue Standard (o Flex por razón no-capacidad):    │
│             └── Evaluar fallback a fal                          │
│                                                                 │
│  2. Fallback a fal.ai (si shouldFallbackToFal = true)           │
│     ├── Éxito → resultado fal                                   │
│     └── Fallo → error final al cliente                          │
│                                                                 │
│  3. Upscale opcional (independiente del proveedor de generación)│
│     └── Corre si upscale_enabled=true y FAL_API_KEY presente   │
└─────────────────────────────────────────────────────────────────┘
```

**Por qué este orden:** Flex es más barato pero puede fallar por capacidad. Standard es la red de seguridad dentro de Google. fal.ai es el fallback de último recurso para errores de contenido y fallos no recuperables de Google.

**Diferencia por plan:**
- **Gratuito:** si Flex falla por saturación, se devuelven los créditos y se informa al usuario. No se intenta Standard ni fal.
- **Pro:** si Flex falla por saturación, reintento automático en Standard (coste lo asume la plataforma). Si falla por contenido, fallback a fal.

---

## 21) Protección financiera y operativa

- **Hard cap de gasto mensual** configurado en fal.ai y Gemini API desde el primer día. Límite máximo de gasto en API independiente de la lógica de la aplicación.
- **Rate limiting** por IP para usuarios gratuitos: máx 1 generación/día por IP.
- **Separación de ingresos:** los ingresos de cada mes se mantienen en cuenta separada hasta que el mes termine, como protección ante devoluciones y chargebacks.
- **Cierre de servicio:** Stripe gestiona devoluciones proporcionales automáticamente si la plataforma cierra.
- **Stripe comisión estándar:** 2.9% + 0.30€ por transacción.

---

## 22) Estado técnico y calidad

| Check | Estado |
|---|---|
| `npm run lint` | ✅ Sin errores (warnings de `<img>` vs `next/image`, no bloqueantes) |
| `npm run build` | ✅ OK |
| Generación Google | ✅ Operativa |
| Fallback fal.ai | ✅ Operativo |
| Retry Flex→Standard | ✅ Operativo |
| Upscale fal.ai | ✅ Operativo con coste agregado |
| Historial persistente | ✅ Operativo (IndexedDB + migración localStorage) |
| Precálculo doble Google/fal + upscale | ✅ Operativo |
| Firebase Auth | ⏳ Pendiente de implementar |
| Firestore (créditos y usuarios) | ⏳ Pendiente de implementar |
| Cloudflare R2 (galería Pro) | ⏳ Pendiente de implementar |
| Stripe (pagos y webhooks) | ⏳ Pendiente de implementar |
| Firebase App Check | ⏳ Pendiente de implementar |
| Rate limiting por IP (Free) | ⏳ Pendiente de implementar |

**Warning conocido:** Next.js recomienda `next/image` en lugar de `<img>`. No es bloqueante para runtime actual.

---

## 23) Riesgos y puntos a vigilar

- Las fórmulas de coste (Google/fal) son aproximaciones en varios escenarios. El coste real varía según tokens de prompt, número de referencias e imágenes generadas.
- El pricing real de fal puede cambiar. Si el fallback estático queda desactualizado, las estimaciones de coste serán incorrectas.
- `enable_google_search` puede implicar cargos externos de Google no plenamente modelados.
- El historial local (IndexedDB) se pierde si el usuario cambia de dispositivo o limpia datos. La galería Pro en servidor resuelve esto para usuarios de pago, pero no para Free.
- El fallback a fal usa el `input` original (si hubo retry Google standard, no modifica payload salvo flex internamente en Google).
- El programa de afiliados con 10% descuento + 10% comisión + Stripe ~3% reduce el margen efectivo en ~23% en usuarios afiliados. Si el canal de adquisición principal son afiliados, la mayoría del volumen inicial opera con ese margen reducido. El precio Pro debe calcularse con esto en cuenta.
- Los tiers de calidad Pro (especialmente "Alta calidad" con generación 1K + upscale 4K) tienen un coste de API significativamente mayor que el tier Base. Validar margen antes de activarlos.
- Las transacciones atómicas de Firestore son obligatorias para el descuento de créditos. Sin ellas, requests simultáneos pueden generar con créditos negativos o duplicar generaciones.
- La verificación de firma de webhooks de Stripe es obligatoria. Sin ella, cualquiera puede activar plan Pro con un POST falso.
- La política de retención de imágenes R2 al cancelar suscripción Pro está sin definir.

---

## 24) Guía rápida de diagnóstico

Si falla la generación:

1. Verificar `GEMINI_API_KEY` presente y válida.
2. Verificar `FAL_API_KEY` si se espera fallback o upscale.
3. Identificar tipo de fallo en respuesta JSON:
   - `primaryFailure.reason`: categoría del error Google
   - `primaryFailure.statusCode`: código HTTP del fallo
4. Revisar si hubo retry Flex→Standard: campo `googleTierFallback` en respuesta.
5. Si se esperaba fallback a fal y no ocurrió: verificar que `AUTO_FALLBACK_TO_FAL=true` y `FAL_API_KEY` presente.
6. Si la UI muestra resultado sin imágenes: verificar que `images` no venga vacío. `originalImages` solo aparece si hubo upscale.

---

## 25) Pendientes de decisión

| # | Decisión | Bloquea |
|---|---|---|
| 1 | Precio base suscripción Pro (€/mes) | Toda la sostenibilidad financiera; sin esto no se puede validar margen en ningún escenario |
| 2 | Modelo de créditos diarios Pro: Opción A (reseteo 24h desde primer uso) vs Opción B (recarga cada 5h) | Implementación del sistema de créditos |
| 3 | Créditos diarios Pro: 400 vs 500 | Implementación del sistema de créditos |
| 4 | Pool mensual Pro: 2.000 vs 3.000 créditos | Implementación del sistema de créditos |
| 5 | Caducidad del programa de afiliados: permanente sin condiciones vs condicionado | Contratos con afiliados, implementación en Stripe |
| 6 | Política de retención de imágenes en R2 al cancelar suscripción Pro | UX de cancelación, costes de almacenamiento a largo plazo |

