# MiniAItura — Rediseño completo de la web

## Instrucciones para Claude Code

Lee este documento COMPLETO antes de escribir una sola línea de código. Este es un rediseño integral de la web de MiniAItura. El stack es Next.js + Tailwind CSS + Firebase. La web es un generador de miniaturas de YouTube con IA.

Don't hold back. Give it your all. Create an impressive, memorable, production-grade web application. Apply design principles: hierarchy, contrast, balance, and movement. Add thoughtful details like hover states, transitions, and micro-interactions. This should look like it was designed by a top-tier creative agency, not by an AI tool.

---

## CONTEXTO DEL PRODUCTO

MiniAItura genera miniaturas de YouTube con IA. El usuario describe lo que quiere, elige un estilo visual, y la IA genera una miniatura optimizada para conseguir clics en YouTube.

Hay dos tipos de usuario:
- FREE: 1 generación al día, resolución 512px, galería personal de las últimas 30 imágenes
- PRO (~20€/mes): 5 generaciones al día + 30 mensuales, resolución hasta 4K, galería ilimitada, puede publicar en galería pública

El nombre "MiniAItura" es un juego de palabras entre "miniatura" y "AI". El logo y título deben reflejar este juego.

---

## DIRECCIÓN ESTÉTICA

### Identidad visual: "Cartoon profesional con mascotas pixel art"

La estética es una fusión entre profesionalismo SaaS moderno y personalidad cartoon con mascotas pixel art. No es infantil, no es corporativo frío. Es cálido, memorable, con personalidad propia.

Piensa en la energía visual de Notion (personajes ilustrados consistentes que acompañan la experiencia) cruzada con la calidez de Stardew Valley (mascotas pixel art tipo Junimos, colores suaves, animaciones encantadoras).

### Mascotas

Las mascotas son criaturas pequeñas estilo pixel art, redondas, expresivas, con colores pastel suaves. Tienen entre 16px y 32px de tamaño sprite. Aparecen en momentos clave de la web interactuando con los elementos de la interfaz:

- En el carrusel de la landing: las mascotas "llevan" o "cargan" las miniaturas como si las transportasen
- Durante la generación de imágenes: las mascotas pintan en un lienzo, construyen con herramientas, hacen actividades creativas (esto reemplaza el spinner/barra de progreso convencional)
- En estados vacíos: una mascota sentada esperando, o dormida
- En errores: una mascota con expresión triste o confundida

Las mascotas son elementos de personalidad, NO el foco principal. No deben competir visualmente con el contenido generado por los usuarios (las miniaturas). Deben ser sutiles y encantadoras.

IMPORTANTE: Si no puedes generar sprites pixel art reales, crea placeholders SVG simples con la estética correcta (redondos, colores pastel, expresivos) y documenta dónde irían los sprites definitivos. No dejes espacios vacíos ni imágenes rotas.

### Paleta de colores

```css
:root {
  /* Fondo principal - oscuro pero cálido, no negro puro */
  --bg-primary: #1a1b2e;
  --bg-secondary: #232442;
  --bg-card: #2a2b4a;

  /* Acentos - colores vivos pero no agresivos */
  --accent-primary: #7c6ef0;      /* Violeta suave - acción principal */
  --accent-secondary: #f0a05e;    /* Naranja cálido - CTAs secundarios */
  --accent-success: #5ecf8b;      /* Verde suave - confirmaciones */
  --accent-warning: #f0d05e;      /* Amarillo - avisos */
  --accent-error: #f06e6e;        /* Rojo suave - errores */

  /* Texto */
  --text-primary: #f0f0f5;
  --text-secondary: #a0a0c0;
  --text-muted: #6a6a8a;

  /* Mascotas - paleta pastel */
  --mascot-pink: #f0a0c0;
  --mascot-blue: #a0c0f0;
  --mascot-green: #a0f0c0;
  --mascot-yellow: #f0e0a0;
  --mascot-lavender: #c0a0f0;
}
```

Esta paleta es orientativa. Puedes ajustarla para mejorar contraste y coherencia, pero mantén el espíritu: fondo oscuro cálido, acentos vivos sin ser agresivos, y pastel para las mascotas.

### Tipografía

NO uses Inter, Roboto, Arial, ni fuentes genéricas del sistema. Elige fuentes con personalidad:

- Títulos/headings: una fuente display redondeada y amigable con carácter (busca en Google Fonts: Quicksand, Nunito, Comfortaa, Baloo 2, o similar). Debe sentirse accesible y moderno, no corporativo
- Body text: una fuente legible pero con personalidad (DM Sans, Plus Jakarta Sans, Outfit, o similar)
- Logo "MiniAItura": tratamiento tipográfico especial donde "AI" tenga un color de acento diferente o un estilo visual que destaque el juego de palabras

### Animaciones

Todas las animaciones deben seguir estas reglas de rendimiento:

1. Usar sprites en vez de GIFs para las mascotas pixel art. Un sprite sheet es una sola imagen con todos los frames, CSS o JS la anima moviéndose por ella
2. Usar IntersectionObserver para activar animaciones solo cuando están en el viewport visible. Pausar cuando salen del viewport
3. Respetar `prefers-reduced-motion`: detectar la media query y pausar/eliminar animaciones para usuarios que lo soliciten
4. Usar `requestAnimationFrame` para animaciones JavaScript, nunca `setInterval`
5. Reservar siempre el espacio de los elementos animados en el layout con dimensiones fijas para evitar CLS (Cumulative Layout Shift)
6. CSS transitions y animations sobre `transform` y `opacity` solamente, nunca animar `width`, `height`, `top`, `left` porque fuerzan reflow

---

## PÁGINAS A IMPLEMENTAR

### Página 1: Landing page ( / )

La landing page es lo más importante. Un visitante nuevo debe entender en menos de 3 segundos qué hace MiniAItura y ver prueba real de la calidad.

#### Estructura de la landing (top to bottom):

**HERO SECTION (above the fold)**

```
┌─────────────────────────────────────────────────────┐
│  Nav: Logo MiniAItura | [Galería] [Precios] [Login] │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │                                              │    │
│  │  "Crea miniaturas de YouTube               │    │
│  │   que consiguen clics"                      │    │
│  │                                              │    │
│  │  Subtítulo: Describe tu vídeo y nuestra IA  │    │
│  │  genera la miniatura perfecta para tu nicho │    │
│  │                                              │    │
│  │  [Crear miniatura gratis]  [Ver galería]    │    │
│  │                                              │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ ejemplo1 │ │ ejemplo2 │ │ ejemplo3 │            │
│  │ miniatura│ │ miniatura│ │ miniatura│            │
│  └──────────┘ └──────────┘ └──────────┘            │
│  (3 miniaturas de ejemplo con animación de entrada) │
└─────────────────────────────────────────────────────┘
```

- Título grande con animación de entrada staggered (palabra por palabra o línea por línea)
- Las 3 miniaturas de ejemplo deben ser imágenes reales de alta calidad que demuestren lo que la herramienta puede hacer. Si no hay imágenes reales aún, usar placeholders de alta calidad y documentar dónde se reemplazan
- Las miniaturas de ejemplo deben tener una animación sutil de hover (ligero scale up + shadow) que invite a interactuar
- CTA principal ("Crear miniatura gratis") en color accent-primary, prominente, con micro-interacción de hover
- CTA secundario ("Ver galería") más sutil, outline o text link

**SECCIÓN: CARRUSEL DE COMUNIDAD**

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│  "Creado por nuestra comunidad"                     │
│                                                      │
│  ┌───┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌───┐  │
│  │🐾 │ │thumb │ │thumb │ │thumb │ │thumb │ │🐾 │  │
│  │   │ │  1   │ │  2   │ │  3   │ │  4   │ │   │  │
│  └───┘ └──────┘ └──────┘ └──────┘ └──────┘ └───┘  │
│  ^mascotas llevando/empujando las miniaturas^       │
│                                                      │
│  Scroll horizontal infinito o con flechas            │
│                                                      │
└─────────────────────────────────────────────────────┘
```

- Carrusel horizontal con miniaturas generadas por usuarios reales (query: generations where isPublic == true, orderBy timesStyleCopied DESC, limit 20)
- Las mascotas pixel art aparecen en los extremos del carrusel como si estuviesen empujando o cargando las imágenes. Animación sutil de caminar o esforzarse
- Cada miniatura es clickeable y lleva a /gallery/[id]
- Auto-scroll suave pero pausable al hacer hover
- En móvil: swipeable con touch

**SECCIÓN: CÓMO FUNCIONA**

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│  "Cómo funciona"                                    │
│                                                      │
│  1. Describe tu vídeo    2. Elige un estilo         │
│  [icono + texto]         [icono + texto]             │
│                                                      │
│  3. La IA genera          4. Publica y comparte     │
│  [icono + texto]         [icono + texto]             │
│                                                      │
└─────────────────────────────────────────────────────┘
```

- 4 pasos con iconos (pueden ser mascotas haciendo la acción correspondiente)
- Animación de entrada cuando el usuario hace scroll hasta esta sección (IntersectionObserver)
- Limpio, espaciado, no saturado

**SECCIÓN: PRECIOS**

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│  "Planes"                                            │
│                                                      │
│  ┌─────────────────┐   ┌─────────────────────┐     │
│  │     GRATIS       │   │      PRO             │     │
│  │                  │   │   ~20€/mes           │     │
│  │  ✓ 1 al día      │   │                     │     │
│  │  ✓ Galería 30    │   │  ✓ 5 al día          │     │
│  │  ✓ Estilos       │   │  ✓ +30 mensuales    │     │
│  │    predefinidos  │   │  ✓ Alta resolución   │     │
│  │                  │   │  ✓ Galería ilimitada │     │
│  │  [Empezar]       │   │  ✓ Publicar estilos │     │
│  │                  │   │  ✓ Modo ahorro       │     │
│  └─────────────────┘   │                       │     │
│                         │  [Suscribirse]        │     │
│                         └─────────────────────┘     │
│                                                      │
└─────────────────────────────────────────────────────┘
```

- Dos cards, la PRO visualmente destacada (borde accent, badge "Popular", o efecto glow sutil)
- Lenguaje de beneficios, NO de características técnicas. No mencionar píxeles, créditos internos, ni jerga técnica
- No mencionar "512px" ni "1024px". Decir "resolución estándar" vs "alta resolución"
- Los checkmarks deben tener animación de entrada staggered

**FOOTER**

Simple: logo, enlaces a términos de uso, política de privacidad, contacto.

### Página 2: Dashboard / Generador ( /generate o /dashboard )

Esta es la página principal de la app después del login. Contiene el formulario de generación.

#### BUG CRÍTICO A CORREGIR PRIMERO:
Actualmente, cuando el usuario está escribiendo un prompt y navega al apartado de galería dentro de la app, el texto que estaba escribiendo se borra. Esto es inaceptable. ANTES de hacer cualquier cambio de diseño en esta página:

1. Identificar por qué se pierde el estado del formulario al navegar
2. Implementar persistencia del estado del formulario. Opciones:
   - Guardar el estado del formulario en un Context de React que persista entre navegaciones
   - Usar un layout compartido donde el formulario no se desmonte al cambiar de pestaña
   - Guardar en sessionStorage como fallback (NO localStorage, no funciona en artifacts)
3. Verificar que al ir a galería y volver, TODO el contenido del formulario está intacto (todos los campos, imagen subida, estilo seleccionado)

#### Estructura del formulario de generación:

El formulario tiene 5 campos. No los presentes como un formulario aburrido. Cada campo debe sentirse como un paso del proceso creativo:

**Campo 1 — Título del vídeo (opcional)**
- Input de texto
- Placeholder: "¿Cuál es el título de tu vídeo?"
- Label: "Título del vídeo" con badge "opcional" sutil
- Icono de YouTube sutil al lado

**Campo 2 — Descripción del contenido (obligatorio)**
- Textarea con más altura que un input normal (mínimo 4 líneas visibles)
- Placeholder: "Describe qué quieres en tu miniatura... Cuantos más detalles, mejor resultado"
- Label: "Descripción de la miniatura"
- Contador de caracteres (máx 2000)
- Este es el campo más prominente del formulario

**Campo 3 — Imagen de referencia (opcional)**
- Zona de drop (drag & drop) con borde dashed y texto "Arrastra una imagen o haz click para subir"
- Al subir: preview de la imagen con botón X para eliminar
- Debajo del preview: textarea para instrucciones específicas
  - Placeholder: "Instrucciones sobre esta imagen (ej: 'quiero esta cara pero sorprendida', 'usa esta composición pero con colores fríos')"
- Aceptar solo: jpg, png, webp. Máximo 1 imagen
- Animación suave al subir/eliminar

**Campo 4 — Estilo visual**
- Tres tabs horizontales: "Presets" | "Personalizado" | "Galería"
- Tab "Presets": grid de cards con miniatura de ejemplo + nombre del estilo. Al seleccionar una, borde accent + checkmark. Estilos disponibles: Gaming Épico, Tutorial Limpio, Finanzas Pro, Vlog Casual, Reacción Dramática, Genérico
- Tab "Personalizado": textarea libre. Placeholder: "Describe el estilo visual que buscas..."
- Tab "Galería": grid scrollable de miniaturas públicas con estilo custom. Cada una muestra imagen + "@autor". Al seleccionar, carga el stylePrompt
- Si no se selecciona nada: usar preset genérico por defecto

**Campo 5 — Modo Fetch (SOLO visible para PRO)**
- Toggle con label "Modo de baja prioridad"
- Sublabel: "Tu miniatura se genera cuando hay disponibilidad. Puede tardar más."
- Al activar, mostrar visualmente el cambio de coste: "100 → 70 créditos" con animación de tachado y nuevo precio

**Botón de generar**
- Prominente, ancho completo del formulario
- Texto: "Generar miniatura" con el coste entre paréntesis: "(100 créditos)"
- Si no hay créditos suficientes: deshabilitado con tooltip "No tienes créditos suficientes"
- Si el campo 2 está vacío: deshabilitado
- Al pulsar: transición a estado de carga

**Estado de carga (reemplaza el formulario o se superpone)**
- Las mascotas pixel art pintando un lienzo, construyendo, o haciendo actividades creativas
- Si puedes implementar la animación de sprites: una mascota con un pincel pintando un canvas que se va llenando de color
- Si no puedes implementar sprites: crear una animación CSS elegante con los SVG placeholder de mascotas haciendo movimientos creativos (rebotando, girando un pincel, etc.)
- Texto debajo: "Creando tu miniatura..." con puntos suspensivos animados
- Si es modo Fetch: "Tu miniatura se está generando en modo de baja prioridad. Puede tardar varios minutos."
- NO usar un spinner convencional ni una barra de progreso

**Resultado después de generar**
- Imagen generada a tamaño grande
- Debajo de la imagen:
  - Botón "Descargar" (icono de descarga)
  - Botón "Generar otra" (vuelve al formulario)
  - Botón "Publicar en galería" (SOLO PRO, con el flujo de confirmación/tick que se describe en la sección de galería)
- Transición animada suave desde estado de carga a resultado

#### Sidebar o header de la página:
- Mostrar créditos disponibles: "Hoy: 4/5 | Mensuales: 28/30" (para PRO) o "Hoy: 0/1" (para FREE)
- Enlace a galería personal
- Enlace a galería pública
- Enlace a ajustes de perfil

### Página 3: Galería personal ( /dashboard/gallery )

- Grid responsive de miniaturas del usuario
- Cada card: imagen + fecha + nicho si existe
- Click en una card: modal o página con vista expandida que muestra todos los detalles (prompt, estilo, provider, resolución, créditos usados)
- Usuarios FREE: mostrar las últimas 30 con mensaje sutil "Actualiza a PRO para galería ilimitada" si hay exactamente 30
- Usuarios PRO: todas, con paginación o infinite scroll
- Cada imagen tiene botón "Publicar en galería" si no está publicada aún (SOLO PRO)

### Página 4: Galería pública ( /gallery )

- Accesible sin login
- Grid responsive de miniaturas publicadas por la comunidad
- Cada card: imagen + "@autor" (displayName)
- Filtro por nicho (chips horizontales: Todos, Gaming, Tutorial, Finanzas, Vlog, etc.)
- Ordenar por: Recientes | Más populares (timesStyleCopied)
- Infinite scroll o paginación
- SSR o SSG para SEO (las miniaturas deben estar en el HTML inicial, no cargadas con JavaScript del lado del cliente)

### Página 5: Detalle de miniatura pública ( /gallery/[id] )

- URL única por imagen para SEO
- Imagen en grande
- Si styleType == "custom":
  - "Estilo por: @{displayName}"
  - Prompt de estilo visible en un bloque con fondo diferenciado
  - Botón "Usar este estilo" → redirige a /generate con el estilo precargado en campo 4 tab "Galería"
  - Contador: "Este estilo se ha usado X veces"
- Si styleType != "custom":
  - Solo la imagen, sin prompt de estilo
- Sección "Miniaturas similares" debajo con 4-6 imágenes relacionadas del mismo nicho
- SEO: meta tags, og:image, JSON-LD con schema ImageObject (ver instrucciones de SEO abajo)

### Página 6: Precios ( /pricing )

- Puede ser la misma sección de precios de la landing pero como página completa
- Añadir FAQ debajo con preguntas comunes:
  - "¿Qué pasa si no uso todos mis créditos diarios?" → Se recargan al día siguiente
  - "¿Puedo cancelar en cualquier momento?" → Sí
  - "¿Qué calidad tienen las imágenes?" → Resolución profesional para YouTube (1280x720 mínimo)
- Botón de suscripción conectado a Stripe

### Página 7: Perfil / Settings ( /profile o /settings )

- Editar displayName (con validación: 3-30 chars, regex alfanumérica con tildes y guiones)
- Ver plan actual
- Ver créditos disponibles
- Historial de generaciones (enlace a galería personal)
- Gestionar suscripción (enlace a portal de Stripe)
- Si es afiliado: ver código de afiliado, estadísticas de referidos, ganancias

---

## NAVEGACIÓN

### Nav principal (header fijo)
- Logo "MiniAItura" (con "AI" destacado en color accent)
- Links: Galería | Precios
- Si no logueado: [Iniciar sesión] [Crear cuenta gratis]
- Si logueado: Indicador de créditos compacto + avatar/nombre con dropdown (Mi galería, Generar, Perfil, Cerrar sesión)
- Responsive: en móvil colapsa a hamburger menu

### Navegación dentro de la app (después de login)
- Las pestañas internas (Generar, Mi galería, Galería pública) NO deben desmontar el componente del formulario al cambiar entre ellas. Usar routing que preserve el estado o un layout compartido con tabs

---

## SEO TÉCNICO

Cada página debe tener:

```html
<head>
  <title>{título único por página} | MiniAItura</title>
  <meta name="description" content="{descripción única por página, max 155 chars}" />
  <meta property="og:title" content="{título}" />
  <meta property="og:description" content="{descripción}" />
  <meta property="og:image" content="{imagen representativa}" />
  <meta property="og:type" content="website" />
  <link rel="canonical" href="https://miniaitura.com{path}" />
</head>
```

Para las páginas de galería individual (/gallery/[id]):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ImageObject",
  "contentUrl": "{imageUrl}",
  "name": "{título derivado del prompt}",
  "description": "{userPrompt, primeros 200 chars}",
  "dateCreated": "{createdAt en ISO}",
  "creator": {
    "@type": "Person",
    "name": "{displayName}"
  }
}
</script>
```

Todas las imágenes de miniaturas deben tener:
- `alt` text descriptivo derivado del prompt o estilo
- `loading="lazy"` excepto las que están above the fold
- Nombres de archivo descriptivos si es posible (configurar en Firebase Storage)

Usar elementos HTML semánticos:
- `<nav>` para navegación
- `<main>` para contenido principal
- `<article>` para cada miniatura en galería
- `<figure>` + `<figcaption>` para imágenes con prompt
- `<section>` para bloques de la landing
- Jerarquía de headings coherente: un solo `<h1>` por página, `<h2>` para secciones, `<h3>` para subsecciones

---

## RESPONSIVE

- Desktop: ancho máximo ~1200px centrado
- Tablet: grid de 2 columnas para galerías, formulario a ancho completo
- Móvil: todo a 1 columna, carrusel swipeable con touch, nav colapsada
- El formulario de generación debe ser completamente usable en móvil con campos a ancho completo
- Las mascotas pueden ser más pequeñas o simplificadas en móvil para no sobrecargar

---

## ACCESIBILIDAD

- Todos los botones interactivos deben tener `aria-label` si el texto no es suficiente
- Contraste de texto sobre fondo debe cumplir WCAG AA (ratio mínimo 4.5:1)
- Los toggles y checkboxes deben ser operables con teclado
- Las animaciones respetan `prefers-reduced-motion`
- Focus visible en todos los elementos interactivos (outline personalizado que encaje con la estética, no el default del browser)

---

## ORDEN DE IMPLEMENTACIÓN

1. PRIMERO: corregir el bug del formulario que pierde el texto al navegar a galería
2. Sistema de diseño base: variables CSS, tipografía, componentes básicos (botones, cards, inputs)
3. Layout y navegación (header, routing, responsive)
4. Landing page completa
5. Formulario de generación con todos los campos
6. Estado de carga con animación de mascotas
7. Galería personal
8. Galería pública + página de detalle
9. Página de precios
10. Página de perfil
11. Pulido final: micro-interacciones, transiciones entre páginas, animaciones de scroll

Después de cada paso, confirma qué has hecho y espera aprobación antes de seguir.

---

## NOTAS FINALES

- NO instalar dependencias innecesarias. Tailwind + CSS nativo cubren el 90% de lo necesario. Framer Motion o similar solo si las animaciones CSS no son suficientes
- NO usar components libraries genéricas (Material UI, Chakra, etc.) que anulen la identidad visual
- Cada componente debe sentirse parte de MiniAItura, no de una plantilla genérica
- Si algún elemento de diseño no está claro, toma la decisión más coherente con la estética descrita y documéntala
- Commitear después de cada sección completada con mensaje descriptivo

---

*Documento de rediseño generado el 30 de mayo de 2026.*
