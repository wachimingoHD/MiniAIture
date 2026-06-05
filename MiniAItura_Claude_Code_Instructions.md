# MiniAItura — Instrucciones de implementación para Claude Code

## Contexto del proyecto

MiniAItura es un generador de miniaturas de YouTube con IA. Stack: Next.js + Firebase (Firestore + Cloud Functions) + Stripe. La generación de imágenes usa la API de Gemini (NanoBanana) con fallback a Fal AI.

Lee este documento completo antes de hacer ningún cambio. Ejecuta los cambios en el orden indicado. Después de cada sección, confirma qué has hecho y espera aprobación antes de continuar con la siguiente.

---

## SECCIÓN 1: Migración de base de datos (Firestore)

### 1.1 — Colección `users`

Modifica el modelo del documento de usuario. El nuevo schema es:

```typescript
interface User {
  displayName: string;          // nombre público editable, default: nombre de Google al registrarse
  email: string;
  plan: "free" | "pro";
  credits: {
    daily: number;              // créditos disponibles hoy (FREE: 100, PRO: 500)
    dailyResetAt: Timestamp;
    monthly: number;            // créditos disponibles este mes (FREE: 0, PRO: 3000)
    monthlyResetAt: Timestamp;
  };
  affiliate: {
    code: string | null;        // código de afiliado que usó al registrarse
    isAffiliate: boolean;       // si este usuario es afiliado
  };
  stats: {
    totalGenerated: number;
    totalCreditsUsed: number;
    monthsSubscribed: number;
  };
  stripeCustomerId: string;
  subscriptionId: string;
  subscriptionStatus: string;
  subscriptionStart: Timestamp;
  subscriptionEnd: Timestamp;
  createdAt: Timestamp;
}
```

Cambios respecto al modelo actual:
- Añadir campo `displayName` (string, editable por el usuario)
- Eliminar el campo `gallery` del documento de usuario. Las generaciones se mueven a su propia colección (ver 1.2)
- Verificar que NO se cree un nuevo documento de usuario por cada generación gratuita. Al generar, buscar el documento existente del usuario por su UID de Firebase Auth y actualizarlo. Este es un bug actual que hay que corregir

### 1.2 — Nueva colección `generations`

Crear la colección `generations`. Cada documento representa una imagen generada. Este reemplaza el array `gallery` que antes estaba dentro del documento de usuario.

```typescript
interface Generation {
  userId: string;
  videoTitle: string | null;
  userPrompt: string;               // lo que escribió el usuario en el campo de descripción
  enhancedPrompt: string;           // prompt final que generó el LLM para la IA de imagen
  referenceImageUrl: string | null;
  referenceInstructions: string | null;
  styleType: "preset" | "custom" | "gallery";
  styleId: string | null;           // ID del preset o del generationId de galería si usa estilo ajeno
  stylePrompt: string;              // texto del estilo visual usado
  imageUrl: string;
  provider: "gemini" | "fal";
  resolution: 512 | 1024;
  mode: "normal" | "flex" | "fetch";
  creditsUsed: number;
  isPublic: boolean;                // si el usuario publicó en galería global
  publishedAt: Timestamp | null;
  timesStyleCopied: number;         // contador de cuántas veces otros usuarios usaron este estilo
  nicho: string | null;
  createdAt: Timestamp;
}
```

Crear índices compuestos en Firestore para las queries más frecuentes:
- `userId` + `createdAt` DESC (galería personal)
- `isPublic` == true + `createdAt` DESC (galería pública)
- `isPublic` == true + `timesStyleCopied` DESC (galería pública ordenada por popularidad)

### 1.3 — Nueva colección `creditTransactions`

Crear colección para historial de auditoría de créditos:

```typescript
interface CreditTransaction {
  userId: string;
  type: "generation" | "refund" | "bonus" | "reset";
  amount: number;                   // negativo si es gasto, positivo si es ingreso
  balanceBefore: number;
  balanceAfter: number;
  generationId: string | null;      // referencia a la generación si type == "generation"
  createdAt: Timestamp;
}
```

Cada vez que se gastan o añaden créditos en cualquier parte del código, escribir un documento en esta colección. Sin excepciones.

### 1.4 — Nueva colección `affiliates`

```typescript
interface Affiliate {
  userId: string;
  code: string;                     // código único del creador
  discountPct: number;              // 10
  commissionPct: number;            // 10
  totalReferrals: number;
  totalEarned: number;
  stripeConnectId: string;
  createdAt: Timestamp;
}
```

### 1.5 — Modificar colección `rateLimits`

Renombrar la colección de `rate_limits_free_ip_daily` a `rateLimits`. Añadir campo `expiresAt` a cada documento:

```typescript
interface RateLimit {
  ip: string;
  count: number;
  updatedAt: Timestamp;
  expiresAt: Timestamp;             // fecha del día siguiente a las 00:00 UTC
}
```

Crear una Cloud Function programada (Cloud Scheduler) que se ejecute una vez al día y elimine todos los documentos donde `expiresAt < now()`.

### 1.6 — Migración de datos existentes

Escribir un script de migración que:
1. Lea todos los documentos de `users` que tengan el campo `gallery`
2. Para cada entrada del array `gallery`, cree un documento en la colección `generations` con los campos disponibles (rellenar los campos nuevos con null o valores default)
3. Una vez confirmada la migración, elimine el campo `gallery` de cada documento de usuario
4. NO borrar los datos originales hasta que se confirme que la migración es correcta. Primero hacer la copia, verificar, y después limpiar

---

## SECCIÓN 2: Sistema de créditos

### 2.1 — Lógica de consumo de créditos

Localizar la función o servicio que gestiona el consumo de créditos al generar una imagen. Reescribirla con esta lógica:

```
FUNCIÓN consumirCreditos(userId, modo, plan):

  SI plan == "free":
    coste = 100                     // siempre 100, el fetch es su modo por defecto, no resta nada
  
  SI plan == "pro":
    coste = 100
    SI modo == "fetch":
      coste = 70                    // descuento de 30 solo para PRO

  // Orden de consumo: primero diarios, luego mensuales
  usuario = leer documento users/{userId}
  
  SI usuario.credits.daily >= coste:
    usuario.credits.daily -= coste
  SINO SI plan == "pro" Y (usuario.credits.daily + usuario.credits.monthly) >= coste:
    resto = coste - usuario.credits.daily
    usuario.credits.daily = 0
    usuario.credits.monthly -= resto
  SINO:
    LANZAR ERROR "No tienes créditos suficientes"

  // Escribir transacción de auditoría
  CREAR documento en creditTransactions:
    userId, type: "generation", amount: -coste,
    balanceBefore: creditosAntes, balanceAfter: creditosDespues,
    generationId: id de la generación, createdAt: now()

  ACTUALIZAR documento users/{userId} con nuevos créditos
```

### 2.2 — Reset diario de créditos

Localizar la Cloud Function que resetea créditos diarios. Verificar que:
- Usuarios FREE: daily se resetea a 100
- Usuarios PRO: daily se resetea a 500
- El reset solo ocurre si `dailyResetAt` < now()
- Al resetear, escribir un `creditTransaction` con type "reset"

### 2.3 — Reset mensual de créditos

Verificar la Cloud Function de reset mensual:
- Solo aplica a usuarios PRO
- monthly se resetea a 3000
- Solo si `monthlyResetAt` < now()
- Escribir `creditTransaction` con type "reset"

### 2.4 — Modo Fetch para usuarios FREE

Buscar toda la lógica donde el modo Fetch resta créditos. Modificar para que:
- Si el usuario es FREE, el modo Fetch es automático y obligatorio, NO resta créditos. El coste es 100
- Si el usuario es PRO, el modo Fetch es opcional (toggle en UI) y resta 30 créditos. El coste es 70
- En el frontend, el toggle de Fetch solo debe ser visible para usuarios PRO

---

## SECCIÓN 3: LLM Enhancer de prompts

### 3.1 — System prompt base

Crear un archivo de configuración para el system prompt del LLM. Ubicarlo en un lugar accesible por el servicio de generación (sugerido: `lib/prompts/system-prompt.ts` o `constants/llm.ts`).

```typescript
export const THUMBNAIL_SYSTEM_PROMPT = `You are MiniAItura's thumbnail prompt engineer. Your job is to transform user inputs into optimized image generation prompts that produce high-CTR YouTube thumbnails.

CORE PRINCIPLES:
- Thumbnails are seen at small sizes on mobile. Every element must be readable at 160x90px. If it's not visible at that size, remove it.
- Maximum 4-6 words of text in the thumbnail. Less is better.
- The thumbnail and video title work as a PAIR. The thumbnail should complement the title, never repeat it. If the user provides a video title, ensure the thumbnail creates a curiosity gap or emotional contrast with it.
- Color palette must follow the 60/30/10 rule: 60% dominant background, 30% secondary elements, 10% accent. Elements must remain distinguishable in grayscale.

CONTENT TYPE RULES:
- Entertainment/storytelling/commentary: optimize for CURIOSITY. Use dramatic expressions, unexpected visual elements, unanswered questions.
- Tutorial/educational: optimize for CLARITY. Show the result or the tool prominently. The viewer should know exactly what they'll learn.
- Gaming: high energy, dynamic poses, bright saturated colors, recognizable game elements prominent.
- Finance/business: professional lighting, clean layouts, trust-building color schemes (blue, green, white).

FACE RULES:
- Faces with strong emotions attract clicks but should never dominate without purpose.
- Each face must show a SPECIFIC emotion that adds context to the thumbnail's story.
- If no face is provided or requested, use environmental storytelling instead.

COMPOSITION RULES:
- Never place important elements in the bottom-right corner where YouTube overlays the video duration.
- Use slightly low camera angles for heroic/powerful subjects.
- Use depth: sharp foreground subjects, slightly blurred or darker backgrounds.
- Leave visual breathing room. Cluttered thumbnails underperform.

TECHNICAL OUTPUT RULES:
- Always specify: composition, character details, expressions, color palette, lighting, camera angle, and style.
- Always end with: "16:9 aspect ratio. YouTube thumbnail style. High contrast. Bold and readable at small sizes."
- Never include UI elements, watermarks, or YouTube interface elements in the prompt.

When reference images are provided, extract STYLE elements (color palette, composition approach, lighting style, level of detail) but never reproduce specific copyrighted characters or branded elements. Describe the style, don't copy the content.

When a style preset is provided, integrate its visual direction with the user's content description seamlessly.`;
```

Este prompt NUNCA se muestra al usuario. Se inyecta siempre como system message en la llamada al LLM.

### 3.2 — Servicio de enhancer

Crear un servicio (sugerido: `lib/services/prompt-enhancer.ts`) que ensamble el prompt final. El flujo:

```typescript
interface EnhancerInput {
  videoTitle: string | null;
  userPrompt: string;                    // campo 2: descripción del contenido
  referenceImageBase64: string | null;   // imagen de referencia codificada
  referenceInstructions: string | null;  // instrucciones específicas de la imagen
  stylePrompt: string;                   // texto del estilo (de preset, custom o galería)
}

async function enhancePrompt(input: EnhancerInput): Promise<string> {
  // 1. Construir el mensaje del usuario para el LLM
  let userMessage = "";

  if (input.videoTitle) {
    userMessage += `VIDEO TITLE: "${input.videoTitle}"\n\n`;
  }

  userMessage += `THUMBNAIL DESCRIPTION: ${input.userPrompt}\n\n`;

  if (input.stylePrompt) {
    userMessage += `VISUAL STYLE DIRECTION: ${input.stylePrompt}\n\n`;
  }

  if (input.referenceInstructions) {
    userMessage += `REFERENCE IMAGE INSTRUCTIONS: ${input.referenceInstructions}\n\n`;
  }

  userMessage += `Generate an optimized image generation prompt based on all the above. Output ONLY the prompt, nothing else.`;

  // 2. Llamar al LLM (Gemini Flash)
  const messages = [];

  // Si hay imagen de referencia, incluirla como contenido multimodal
  if (input.referenceImageBase64) {
    messages.push({
      role: "user",
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: input.referenceImageBase64 } },
        { text: "This is a reference image. Extract its visual style (color palette, composition, lighting, level of detail) and apply it to the following request.\n\n" + userMessage }
      ]
    });
  } else {
    messages.push({
      role: "user",
      parts: [{ text: userMessage }]
    });
  }

  // 3. Llamar a Gemini Flash con el system prompt base
  const response = await callGeminiFlash({
    systemInstruction: THUMBNAIL_SYSTEM_PROMPT,
    contents: messages
  });

  // 4. Retornar el prompt enhanceado
  return response.text;
}
```

Adaptar `callGeminiFlash` a la implementación actual de llamadas a Gemini que ya exista en el proyecto. No crear una implementación nueva si ya hay una, reutilizar la existente.

### 3.3 — Integración del enhancer en el flujo de generación

Localizar la función que actualmente recibe el prompt del usuario y lo envía a la IA de generación de imagen. Modificarla para:

1. Recibir los 5 campos del usuario (videoTitle, userPrompt, referenceImage, referenceInstructions, stylePrompt, fetchMode)
2. Llamar a `enhancePrompt()` con los inputs
3. Guardar tanto `userPrompt` como `enhancedPrompt` en el documento de `generations`
4. Enviar el `enhancedPrompt` a la IA de generación de imagen (Gemini / Fal)

---

## SECCIÓN 4: Frontend — Formulario de generación

### 4.1 — Campos del formulario

Modificar o crear el componente del formulario de generación. Debe tener estos campos:

**Campo 1 — Título del vídeo**
- Input de texto simple
- Placeholder: "¿Cuál es el título de tu vídeo? (opcional)"
- Opcional, marcarlo visualmente como tal
- maxLength: 200

**Campo 2 — Descripción del contenido**
- Textarea
- Placeholder: "Describe qué quieres en tu miniatura..."
- Obligatorio
- maxLength: 2000

**Campo 3 — Imagen de referencia**
- Input de tipo file (solo imágenes: jpg, png, webp)
- Máximo 1 imagen
- Debajo del preview de la imagen: textarea para instrucciones específicas
  - Placeholder: "Instrucciones sobre esta imagen (ej: 'quiero esta cara pero sorprendida')"
  - Opcional
  - maxLength: 500
- Botón para eliminar la imagen subida
- Marcar todo el campo como opcional

**Campo 4 — Estilo visual**
- Tres opciones mutuamente excluyentes, presentadas como tabs o radio buttons:
  - (a) "Presets de MiniAItura": grid de cards con los presets disponibles. Cada card muestra nombre + miniatura de ejemplo + breve descripción del estilo. Al seleccionar una, se resalta
  - (b) "Estilo personalizado": textarea libre. Placeholder: "Describe el estilo visual que buscas..."
  - (c) "Estilos de la galería": abre un modal o sección con las miniaturas públicas que tienen estilo custom. Muestra imagen + nombre del autor + prompt de estilo. Al seleccionar una, se carga el prompt de estilo
- Si no se selecciona ninguno, usar un estilo default genérico

**Campo 5 — Modo Fetch**
- Toggle / checkbox
- SOLO VISIBLE para usuarios PRO
- Label: "Modo de baja prioridad"
- Sublabel: "Tu miniatura se genera cuando hay disponibilidad. Puede tardar más. Ahorras 30 créditos."
- Mostrar visualmente: "Coste: 100 → 70 créditos"
- Para usuarios FREE este campo NO existe en el formulario. El Fetch es automático y transparente

**Botón de generar:**
- Mostrar el coste en créditos: "Generar (100 créditos)" o "Generar (70 créditos)" si Fetch activado
- Deshabilitado si no hay créditos suficientes o si el campo 2 está vacío

### 4.2 — Estado de carga durante generación

Mientras se genera, mostrar:
- Indicador de carga (aquí irían las animaciones de mascotas pixel art en el futuro, por ahora un spinner o barra de progreso)
- Si es modo Fetch: mensaje "Tu miniatura se está generando en modo de baja prioridad. Puede tardar varios minutos. Te notificaremos cuando esté lista."
- Si es modo normal: mensaje "Generando tu miniatura..."

---

## SECCIÓN 5: Galería personal

### 5.1 — Página de galería del usuario

Crear o modificar la página de galería personal (ruta sugerida: `/dashboard/gallery` o `/profile/gallery`). Funcionalidad:

- Query a Firestore: `generations` where `userId == currentUser.uid` orderBy `createdAt` DESC
- Para usuarios FREE: limitar a los últimos 30 documentos
- Para usuarios PRO: sin límite, con paginación
- Cada miniatura muestra: imagen, fecha, nicho si existe
- Al hacer click en una miniatura: vista expandida con todos los detalles (prompt, estilo, provider, resolución)

### 5.2 — Límite de retención para FREE

Cuando un usuario FREE genera una nueva imagen y ya tiene 30 en su galería:
- Opción A (recomendada): no borrar automáticamente, simplemente no mostrar más de 30 en la UI. Los datos se quedan en Firestore por si el usuario upgradea a PRO
- Opción B: Cloud Function que borra la generación más antigua cuando se supera el límite de 30

Implementar opción A a menos que el coste de almacenamiento sea un problema.

---

## SECCIÓN 6: Galería pública

### 6.1 — Flujo de publicación

Después de que una imagen se genera exitosamente, mostrar el resultado con un botón "Publicar en la galería de MiniAItura".

Este botón SOLO es visible para usuarios PRO.

Al pulsar el botón:

**Si styleType == "custom":**
```
Modal de confirmación:
  ☑ "Acepto publicar mi miniatura y mi prompt de estilo en la galería 
     pública de MiniAItura. Acepto que otras personas puedan usar mi 
     prompt de estilo como referencia."
  [Cancelar] [Publicar]
```
Al confirmar: actualizar el documento en `generations` → `isPublic: true`, `publishedAt: now()`

**Si styleType == "preset" o "gallery":**
```
Modal de confirmación:
  ☑ "Acepto publicar mi miniatura en la galería pública de MiniAItura."
  (Nota: el prompt de estilo no se compartirá porque pertenece a otro creador 
  o es un preset de MiniAItura.)
  [Cancelar] [Publicar]
```
Al confirmar: actualizar `isPublic: true`, `publishedAt: now()`. En la galería pública esta imagen se mostrará SIN prompt de estilo.

### 6.2 — Página de galería pública

Crear página pública (ruta sugerida: `/gallery`). No requiere autenticación para ver.

- Query: `generations` where `isPublic == true` orderBy `createdAt` DESC
- Paginación con cursor-based pagination (usar `startAfter` de Firestore)
- Cada card muestra: imagen, nombre del autor (`displayName`), fecha
- Filtro por nicho si existe

### 6.3 — Vista detalle de miniatura pública

Cada imagen pública debe tener su propia URL para SEO: `/gallery/[generationId]`

Esta página muestra:
- Imagen en grande
- "Estilo por: @{displayName}" (si styleType == "custom")
- Prompt de estilo visible (SOLO si styleType == "custom")
- Botón "Usar este estilo" (SOLO si styleType == "custom"). Al pulsar:
  - Si el usuario está logueado: redirige al formulario de generación con el campo 4 en modo (c) "galería", precargado con el stylePrompt y el styleId de esta generación
  - Si el usuario NO está logueado: redirige a login/registro y después al formulario
- Cuando alguien usa el estilo, incrementar `timesStyleCopied` en el documento original
- Mostrar contador de usos: "Este estilo ha sido usado X veces"

### 6.4 — SEO para páginas de galería

Cada página `/gallery/[generationId]` debe tener:

```html
<head>
  <title>{descripción corta} | MiniAItura Gallery</title>
  <meta name="description" content="AI-generated YouTube thumbnail: {primeras 150 chars del userPrompt}" />
  <meta property="og:image" content="{imageUrl}" />
  <meta property="og:type" content="article" />
</head>
```

En el body, usar elementos semánticos:
```html
<article>
  <figure>
    <img src="{imageUrl}" alt="{alt text generado del prompt}" loading="lazy" />
    <figcaption>{stylePrompt o descripción}</figcaption>
  </figure>
</article>
```

Incluir datos estructurados JSON-LD:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ImageObject",
  "contentUrl": "{imageUrl}",
  "name": "{título generado del prompt}",
  "description": "{userPrompt}",
  "dateCreated": "{createdAt ISO}",
  "creator": {
    "@type": "Person",
    "name": "{displayName}"
  }
}
</script>
```

### 6.5 — Galería en la landing page

En la página principal (`/`), mostrar una sección visible de miniaturas generadas por usuarios reales. Implementar como:

- Título de sección: "Creado por nuestra comunidad" o similar
- Query: `generations` where `isPublic == true` orderBy `timesStyleCopied` DESC limit 12 (las más populares)
- Grid responsive de miniaturas
- Cada miniatura enlaza a su página `/gallery/[generationId]`
- Esta sección debe estar en el HTML inicial (SSR o SSG), no cargada con JavaScript del lado del cliente, para que Google la indexe

---

## SECCIÓN 7: Display name

### 7.1 — Campo en registro

Al registrarse un usuario nuevo (OAuth con Google), rellenar `displayName` con el nombre que provee Google Auth (`user.displayName`).

### 7.2 — Edición de display name

En la página de perfil / settings del usuario, añadir campo editable para `displayName`:
- Input de texto
- maxLength: 30
- minLength: 3
- Validación: no permitir caracteres especiales excepto guiones, guiones bajos y puntos. Regex sugerida: `/^[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ._-]+$/`
- Filtro básico de palabras ofensivas (crear array de palabras prohibidas en español e inglés)
- Verificar unicidad: no permitir dos usuarios con el mismo displayName (query a Firestore antes de guardar)

---

## SECCIÓN 8: Presets de estilo

### 8.1 — Estructura de presets

Los presets son estilos predefinidos por el equipo de MiniAItura. No son documentos de Firestore (son estáticos). Crear archivo de configuración (sugerido: `lib/constants/style-presets.ts`):

```typescript
export interface StylePreset {
  id: string;
  name: string;
  description: string;
  thumbnailUrl: string;          // imagen de ejemplo del estilo
  prompt: string;                // prompt de estilo que se inyecta al LLM
  nicho: string;                 // gaming, finance, tutorial, entertainment, etc.
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "gaming-epic",
    name: "Gaming Épico",
    description: "Alta energía, colores saturados, iluminación dramática",
    thumbnailUrl: "/presets/gaming-epic.jpg",
    prompt: "Hyper-expressive gaming thumbnail aesthetic. Bright saturated colors, dramatic volumetric lighting with strong light rays, dynamic poses, slight motion blur on edges, particle effects. Dark background with high contrast foreground subjects. Bold and energetic composition.",
    nicho: "gaming"
  },
  {
    id: "tutorial-clean",
    name: "Tutorial Limpio",
    description: "Profesional, claro, fondo limpio con elemento central",
    thumbnailUrl: "/presets/tutorial-clean.jpg",
    prompt: "Clean professional tutorial thumbnail style. Soft gradient background, centered subject with clear space around it, clean typography area. Professional lighting, minimal shadows, trust-building blue and white color scheme. Clear and readable at any size.",
    nicho: "tutorial"
  },
  // AÑADIR MÁS PRESETS: finance-pro, vlog-casual, reaction-dramatic, etc.
  // Mínimo 6 presets para lanzamiento
];
```

Crear al menos 6 presets iniciales cubriendo los nichos más comunes: gaming, tutorial, finanzas, vlog/entretenimiento, reacción/comentario, y uno genérico.

Las imágenes de ejemplo de cada preset (`thumbnailUrl`) deben ser generadas previamente y almacenadas como assets estáticos en `/public/presets/`.

---

## SECCIÓN 9: Corrección de bugs

### 9.1 — Bug: nuevo registro de usuario por cada generación FREE

Localizar el código que gestiona la generación para usuarios gratuitos. Actualmente crea un nuevo documento en `users` cada vez que se genera. Corregir para que:

1. Al generar, verificar si existe un documento en `users` con el UID del usuario autenticado
2. Si existe, usar ese documento
3. Si no existe (primer uso), crear uno nuevo con los valores default
4. NUNCA crear documentos duplicados

Buscar en el código patrones como `addDoc(collection(db, "users"), ...)` que deberían ser `setDoc(doc(db, "users", uid), ..., { merge: true })`.

### 9.2 — Bug: Fetch mode resta créditos a usuarios FREE

Buscar toda la lógica donde se calcula el coste de generación teniendo en cuenta el modo Fetch. Verificar que:

```
SI usuario.plan == "free":
  coste = 100                    // SIEMPRE 100, no importa el modo
  modo = "fetch"                 // SIEMPRE fetch para FREE
SI usuario.plan == "pro":
  SI fetchModeActivado:
    coste = 70
    modo = "fetch"
  SINO:
    coste = 100
    modo = "normal"              // o "flex" si Gemini rechaza
```

---

## SECCIÓN 10: Flujo completo de generación (resumen)

Para verificar que todo está conectado, el flujo completo de una generación debe ser:

```
1. Usuario rellena formulario (campos 1-5)
2. Frontend envía al backend:
   - videoTitle, userPrompt, referenceImage, 
     referenceInstructions, styleType, styleId, 
     stylePrompt, fetchMode
3. Backend verifica créditos suficientes
4. Backend llama a enhancePrompt() con los inputs
5. enhancePrompt() llama a Gemini Flash con system prompt + inputs del usuario
6. Gemini Flash retorna el prompt optimizado (enhancedPrompt)
7. Backend envía enhancedPrompt a la IA de generación de imagen:
   a. Intenta con Gemini API (modo normal)
   b. Si Gemini rechaza (ej: caras de famosos), fallback a Fal AI (modo flex)
   c. Si es modo fetch, enviar como petición asíncrona no prioritaria
8. Se recibe la imagen generada
9. Se sube la imagen a Firebase Storage
10. Se crea documento en generations/ con todos los campos
11. Se consume créditos y se escribe creditTransaction
12. Se actualiza stats del usuario (totalGenerated, totalCreditsUsed)
13. Se retorna la imagen al frontend
14. Frontend muestra la imagen + opción de publicar en galería (solo PRO)
```

---

## Orden de implementación recomendado

1. Sección 9 (bugs) — corregir primero lo que está roto
2. Sección 1 (base de datos) — migrar estructura
3. Sección 2 (créditos) — nueva lógica de consumo
4. Sección 3 (LLM) — implementar enhancer
5. Sección 7 (display name) — campo simple necesario para galerías
6. Sección 8 (presets) — crear archivo de presets
7. Sección 4 (formulario) — nuevo frontend de generación
8. Sección 5 (galería personal) — página de galería del usuario
9. Sección 6 (galería pública) — página pública + SEO + publicación
10. Sección 10 — verificación del flujo completo

---

## Notas importantes

- NO borrar datos sin confirmar primero. Todas las migraciones deben ser reversibles
- Reutilizar código y servicios existentes siempre que sea posible. No reescribir lo que ya funciona
- Si encuentras algo en el código actual que contradiga estas instrucciones, PREGUNTA antes de cambiarlo
- Commitear después de cada sección completada con mensaje descriptivo
- No instalar dependencias nuevas sin justificación. El stack actual (Next.js + Firebase + Stripe + Gemini) debería ser suficiente para todo lo descrito

---

*Documento de instrucciones generado el 30 de mayo de 2026.*
