// Contenido de las páginas legales (es/en).
// =============================================================================
// El texto vive aquí (no en messages/*.json) porque son documentos largos con
// estructura propia, no microcopy de UI. La ruta /[locale]/legal/[slug] los
// renderiza.
//
// Tono deliberadamente llano y sin citas de leyes: es una web pequeña. Los
// números de créditos/planes están escritos en el texto: si cambian los
// allowances o el precio, actualizar aquí también.
// =============================================================================

export const LEGAL_CONTACT_EMAIL = "wachimingoyt.hd@gmail.com";

export const LEGAL_SLUGS = ["legal-notice", "privacy", "terms", "cookies"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  list?: string[];
}

export interface LegalDocument {
  title: string;
  /** Fecha de última actualización, ISO yyyy-mm-dd. */
  updated: string;
  sections: LegalSection[];
}

const UPDATED = "2026-06-11";

const es: Record<LegalSlug, LegalDocument> = {
  "legal-notice": {
    title: "Aviso legal",
    updated: UPDATED,
    sections: [
      {
        heading: "1. Quién está detrás",
        paragraphs: [
          "MiniAItura es un proyecto independiente operado por su titular desde España.",
          `Para cualquier consulta: ${LEGAL_CONTACT_EMAIL}`,
        ],
      },
      {
        heading: "2. Qué es MiniAItura",
        paragraphs: [
          "Una herramienta en línea para generar miniaturas de vídeo (por ejemplo, de YouTube) mediante inteligencia artificial, con una galería pública de miniaturas creadas por la comunidad.",
        ],
      },
      {
        heading: "3. Propiedad intelectual",
        paragraphs: [
          "El diseño del sitio, su código, textos, logotipos y elementos gráficos propios pertenecen al titular o se usan con licencia. Usar el Servicio no te da ningún derecho sobre ellos.",
          "Las miniaturas generadas por los usuarios se rigen por lo dispuesto en las Condiciones de uso.",
        ],
      },
      {
        heading: "4. Responsabilidad",
        paragraphs: [
          "No garantizamos la disponibilidad ininterrumpida del Servicio ni respondemos de los daños derivados de un uso contrario a la ley o a estas condiciones. Los enlaces externos se facilitan a título informativo.",
          "El contenido generado, subido o publicado por los usuarios (incluidas las imágenes de referencia y las miniaturas de la galería pública) es responsabilidad exclusiva de quien lo crea o publica. No supervisamos previamente ese contenido y no respondemos de él, aunque retiraremos con diligencia cualquier contenido ilícito en cuanto tengamos conocimiento de él.",
        ],
      },
      {
        heading: "5. Ley aplicable",
        paragraphs: [
          "Este aviso y el uso del sitio se rigen por la legislación española.",
        ],
      },
    ],
  },
  privacy: {
    title: "Política de privacidad",
    updated: UPDATED,
    sections: [
      {
        heading: "1. Responsable",
        paragraphs: [
          `El titular de MiniAItura. Contacto: ${LEGAL_CONTACT_EMAIL}. Puedes ejercer cualquiera de tus derechos escribiendo a este correo.`,
        ],
      },
      {
        heading: "2. Qué datos tratamos",
        list: [
          "Datos de cuenta: al iniciar sesión con Google recibimos tu nombre, correo electrónico y foto de perfil.",
          "Contenido: los textos (prompts) que escribes, las imágenes de referencia que subes y las miniaturas que generas, asociados a tu cuenta.",
          "Pago: si contratas PRO, el pago lo procesa Stripe. Nunca vemos ni guardamos tu tarjeta; solo identificadores de cliente y suscripción de Stripe.",
          "Datos técnicos: tu dirección IP, usada únicamente para limitar el abuso del plan gratuito y proteger la plataforma.",
        ],
      },
      {
        heading: "3. Para qué los usamos",
        list: [
          "Prestarte el Servicio: tu cuenta, la generación de imágenes, la galería y la suscripción.",
          "Facturación y obligaciones fiscales.",
          "Prevención de abuso y seguridad.",
        ],
      },
      {
        heading: "4. Con quién se comparten",
        paragraphs: [
          "Usamos proveedores que tratan datos por nuestra cuenta: Google Firebase (autenticación, base de datos y almacenamiento), Google Gemini y fal.ai (modelos de IA que generan las imágenes), Stripe (pagos) y Vercel (alojamiento y analítica agregada sin cookies). Algunos están en Estados Unidos y operan bajo las garantías europeas para transferencias internacionales de datos.",
          "Tus prompts e imágenes de referencia se envían a los proveedores de IA únicamente para generar tu miniatura. No vendemos tus datos a nadie.",
        ],
      },
      {
        heading: "5. Cuánto tiempo",
        paragraphs: [
          "Conservamos tus datos mientras tengas cuenta. Puedes borrar tu cuenta en cualquier momento desde Ajustes: se eliminan tus miniaturas, tus créditos y tus datos, y si tienes suscripción se cancela. Los datos de facturación se conservan el tiempo que exige la normativa fiscal.",
        ],
      },
      {
        heading: "6. Tus derechos",
        paragraphs: [
          `Puedes pedirnos acceso, corrección, copia o eliminación de tus datos escribiendo a ${LEGAL_CONTACT_EMAIL}, o borrar tu cuenta directamente desde Ajustes. También puedes reclamar ante la Agencia Española de Protección de Datos si crees que algo no se ha hecho bien.`,
        ],
      },
    ],
  },
  terms: {
    title: "Condiciones de uso",
    updated: UPDATED,
    sections: [
      {
        heading: "1. El Servicio",
        paragraphs: [
          "MiniAItura permite generar miniaturas mediante IA. Usar el Servicio implica aceptar estas condiciones. Necesitas una cuenta de Google y ser mayor de 14 años (o contar con autorización de tus padres o tutores).",
        ],
      },
      {
        heading: "2. Créditos, planes y precios",
        paragraphs: [
          "El Servicio funciona con créditos. Generar una miniatura cuesta 100 créditos aproximadamente: 100 es la base, y las opciones la ajustan (el modo ahorro resta 25; la alta calidad y la alta resolución suman 25 cada una, así que una generación va de 75 a 150 créditos). Las sugerencias de la IA (estilo, contenido) cuestan 1 crédito. Si una generación falla, sus créditos se devuelven automáticamente.",
          "Plan GRATIS: 100 créditos al día (aproximadamente una miniatura diaria), que se renuevan cada 24 horas y no se acumulan.",
          "Plan PRO (suscripción mensual): 550 créditos al día más una bolsa de 3.000 créditos al mes, junto con funciones extra como mayor resolución y publicar en la galería pública. El precio vigente es el que se muestra en la página de Precios e incluye los impuestos aplicables.",
          "Los créditos no son dinero: no se reembolsan ni se transfieren.",
        ],
      },
      {
        heading: "3. Suscripción y cancelación",
        paragraphs: [
          "La suscripción PRO se cobra por adelantado a través de Stripe y se renueva automáticamente cada mes. Puedes cancelarla cuando quieras desde Ajustes: la cancelación surte efecto al final del periodo ya pagado, y hasta entonces conservas todos los beneficios PRO. También puedes deshacer la cancelación antes de esa fecha.",
          "Como los créditos PRO se activan en el momento del pago, al suscribirte aceptas que el servicio empieza de inmediato. Si no has usado ningún crédito ni función PRO, tienes 14 días para pedir la devolución escribiendo al correo de contacto.",
        ],
      },
      {
        heading: "4. Tu contenido",
        paragraphs: [
          "Las miniaturas que generes son tuyas: puedes usarlas para lo que quieras, incluido el uso comercial, bajo tu responsabilidad.",
          "Eres el único responsable del contenido que generes, de las imágenes de referencia que subas y de lo que publiques en la galería, así como de tener los derechos necesarios sobre ello. No revisamos el contenido de los usuarios antes de publicarse y no respondemos de él; somos intermediarios y retiraremos cualquier contenido ilícito en cuanto tengamos conocimiento (puedes señalarlo con el botón de reporte o por correo).",
          "Si publicas una miniatura en la galería pública, aceptas que se muestre públicamente en el sitio (incluida la portada) y que otros usuarios puedan reutilizar su contenido y estilo como punto de partida para sus creaciones. Puedes despublicarla cuando quieras.",
        ],
      },
      {
        heading: "5. Uso aceptable",
        list: [
          "No generes ni publiques contenido ilegal, difamatorio, sexual explícito, de odio o que infrinja derechos de otros (incluidos derechos de imagen y propiedad intelectual).",
          "No subas imágenes de referencia sobre las que no tengas derechos.",
          "No intentes saltarte los límites de uso, automatizar el acceso ni interferir con el Servicio.",
        ],
      },
      {
        heading: "6. Moderación",
        paragraphs: [
          "Podemos retirar de la galería pública cualquier contenido que incumpla estas condiciones y, si el incumplimiento es grave o reiterado, suspender la cuenta.",
        ],
      },
      {
        heading: "7. Garantías y responsabilidad",
        paragraphs: [
          "El Servicio se ofrece «tal cual». La generación depende de proveedores de IA externos y puede fallar o dar resultados imprecisos. En la medida que permita la ley, nuestra responsabilidad total se limita a lo que hayas pagado en los últimos 12 meses. Nada de esto recorta los derechos que como consumidor te reconoce la ley.",
        ],
      },
      {
        heading: "8. Cambios",
        paragraphs: [
          "Podemos actualizar estas condiciones; si el cambio es relevante lo anunciaremos con antelación razonable. Se rigen por la ley española.",
        ],
      },
    ],
  },
  cookies: {
    title: "Política de cookies",
    updated: UPDATED,
    sections: [
      {
        heading: "1. Qué cookies usamos",
        paragraphs: [
          "Solo almacenamiento técnico imprescindible para que el sitio funcione: la sesión de inicio de sesión (Firebase/Google) y las preferencias básicas. Por eso no verás banner de cookies: no usamos cookies de publicidad ni de rastreo.",
        ],
      },
      {
        heading: "2. Terceros",
        paragraphs: [
          "Durante el pago, Stripe puede usar sus propias cookies para procesar la transacción y prevenir fraude.",
          "La analítica del sitio (Vercel Analytics) es agregada, no usa cookies y no identifica a nadie.",
        ],
      },
      {
        heading: "3. Cómo gestionarlas",
        paragraphs: [
          "Puedes borrarlas o bloquearlas desde tu navegador, pero al ser técnicas es posible que sin ellas no puedas iniciar sesión o pagar.",
        ],
      },
    ],
  },
};

const en: Record<LegalSlug, LegalDocument> = {
  "legal-notice": {
    title: "Legal notice",
    updated: UPDATED,
    sections: [
      {
        heading: "1. Who is behind this",
        paragraphs: [
          "MiniAItura is an independent project operated by its owner from Spain.",
          `For any enquiry: ${LEGAL_CONTACT_EMAIL}`,
        ],
      },
      {
        heading: "2. What MiniAItura is",
        paragraphs: [
          "An online tool to generate video thumbnails (e.g. for YouTube) using artificial intelligence, with a public gallery of community-made thumbnails.",
        ],
      },
      {
        heading: "3. Intellectual property",
        paragraphs: [
          "The site design, code, texts, logos and original graphics belong to the owner or are used under licence. Using the Service grants you no rights over them.",
          "Thumbnails generated by users are governed by the Terms of Service.",
        ],
      },
      {
        heading: "4. Liability",
        paragraphs: [
          "We do not guarantee uninterrupted availability of the Service and are not liable for damages arising from use contrary to the law or these terms. External links are provided for information only.",
          "Content generated, uploaded or published by users (including reference images and public-gallery thumbnails) is the sole responsibility of whoever creates or publishes it. We do not pre-screen user content and are not liable for it, though we will diligently remove any unlawful content as soon as we become aware of it.",
        ],
      },
      {
        heading: "5. Governing law",
        paragraphs: ["This notice and the use of the site are governed by Spanish law."],
      },
    ],
  },
  privacy: {
    title: "Privacy policy",
    updated: UPDATED,
    sections: [
      {
        heading: "1. Controller",
        paragraphs: [
          `The owner of MiniAItura. Contact: ${LEGAL_CONTACT_EMAIL}. You can exercise any of your rights by writing to this address.`,
        ],
      },
      {
        heading: "2. Data we process",
        list: [
          "Account data: when you sign in with Google we receive your name, email address and profile photo.",
          "Content: the prompts you write, the reference images you upload and the thumbnails you generate, linked to your account.",
          "Payment: PRO subscriptions are processed by Stripe. We never see or store your card; we only keep Stripe customer and subscription identifiers.",
          "Technical data: your IP address, used solely to limit free-plan abuse and keep the platform secure.",
        ],
      },
      {
        heading: "3. What we use it for",
        list: [
          "Providing the Service: your account, image generation, the gallery and the subscription.",
          "Billing and tax obligations.",
          "Abuse prevention and security.",
        ],
      },
      {
        heading: "4. Who it is shared with",
        paragraphs: [
          "We rely on providers that process data on our behalf: Google Firebase (authentication, database, storage), Google Gemini and fal.ai (the AI models that generate the images), Stripe (payments) and Vercel (hosting and cookieless aggregated analytics). Some are located in the United States and operate under the European safeguards for international data transfers.",
          "Your prompts and reference images are sent to the AI providers only to generate your thumbnail. We never sell your data.",
        ],
      },
      {
        heading: "5. For how long",
        paragraphs: [
          "We keep your data while your account exists. You can delete your account at any time from Settings: your thumbnails, credits and data are removed, and any subscription is cancelled. Billing records are kept for as long as tax law requires.",
        ],
      },
      {
        heading: "6. Your rights",
        paragraphs: [
          `You can request access, correction, a copy or deletion of your data by writing to ${LEGAL_CONTACT_EMAIL}, or delete your account directly from Settings. You can also complain to the Spanish Data Protection Agency if you believe something was handled wrongly.`,
        ],
      },
    ],
  },
  terms: {
    title: "Terms of service",
    updated: UPDATED,
    sections: [
      {
        heading: "1. The Service",
        paragraphs: [
          "MiniAItura lets you generate thumbnails with AI. Using the Service implies accepting these terms. You need a Google account and must be at least 14 years old (or have parental consent).",
        ],
      },
      {
        heading: "2. Credits, plans and prices",
        paragraphs: [
          "The Service runs on credits. Generating a thumbnail costs roughly 100 credits: 100 is the base, and options adjust it (saver mode subtracts 25; high quality and high resolution add 25 each, so a generation ranges from 75 to 150 credits). AI suggestions (style, content) cost 1 credit. If a generation fails, its credits are refunded automatically.",
          "FREE plan: 100 credits per day (roughly one thumbnail a day), renewed every 24 hours, non-accumulating.",
          "PRO plan (monthly subscription): 550 credits per day plus a 3,000-credit monthly pool, along with extra features such as higher resolution and publishing to the public gallery. The current price is the one shown on the Pricing page and includes applicable taxes.",
          "Credits are not money: they are non-refundable and non-transferable.",
        ],
      },
      {
        heading: "3. Subscription and cancellation",
        paragraphs: [
          "The PRO subscription is charged in advance through Stripe and renews automatically every month. You can cancel any time from Settings: cancellation takes effect at the end of the paid period, and you keep all PRO benefits until then. You can also undo the cancellation before that date.",
          "Since PRO credits activate the moment you pay, by subscribing you accept that the service starts immediately. If you have not used any PRO credit or feature, you have 14 days to request a refund by writing to the contact email.",
        ],
      },
      {
        heading: "4. Your content",
        paragraphs: [
          "The thumbnails you generate are yours: use them for anything you like, including commercially, at your own responsibility.",
          "You are solely responsible for the content you generate, the reference images you upload and what you publish to the gallery, as well as for holding the necessary rights over it. We do not review user content before it is published and are not liable for it; we act as intermediaries and will remove any unlawful content as soon as we become aware of it (you can flag it with the report button or by email).",
          "If you publish a thumbnail to the public gallery, you accept that it is displayed publicly on the site (including the home page) and that other users may reuse its content and style as a starting point for their own creations. You can unpublish it at any time.",
        ],
      },
      {
        heading: "5. Acceptable use",
        list: [
          "Do not generate or publish content that is illegal, defamatory, sexually explicit, hateful, or that infringes the rights of others (including image rights and intellectual property).",
          "Do not upload reference images you do not hold rights to.",
          "Do not try to bypass usage limits, automate access, or interfere with the Service.",
        ],
      },
      {
        heading: "6. Moderation",
        paragraphs: [
          "We may remove from the public gallery any content that breaches these terms and, for serious or repeated breaches, suspend the account.",
        ],
      },
      {
        heading: "7. Warranties and liability",
        paragraphs: [
          "The Service is provided “as is”. Generation depends on external AI providers and may fail or produce inaccurate results. To the extent the law allows, our total liability is limited to what you paid in the last 12 months. Nothing here limits your statutory consumer rights.",
        ],
      },
      {
        heading: "8. Changes",
        paragraphs: [
          "We may update these terms; significant changes will be announced with reasonable notice. They are governed by Spanish law.",
        ],
      },
    ],
  },
  cookies: {
    title: "Cookie policy",
    updated: UPDATED,
    sections: [
      {
        heading: "1. Cookies we use",
        paragraphs: [
          "Only the technical storage the site needs to work: the sign-in session (Firebase/Google) and basic preferences. That is why there is no cookie banner: we use no advertising or tracking cookies.",
        ],
      },
      {
        heading: "2. Third parties",
        paragraphs: [
          "During checkout, Stripe may use its own cookies to process the transaction and prevent fraud.",
          "Site analytics (Vercel Analytics) are aggregated, cookieless and identify no one.",
        ],
      },
      {
        heading: "3. Managing cookies",
        paragraphs: [
          "You can delete or block them in your browser, but since they are technical you may not be able to sign in or pay without them.",
        ],
      },
    ],
  },
};

const CONTENT: Record<string, Record<LegalSlug, LegalDocument>> = { es, en };

export function getLegalDocument(locale: string, slug: string): LegalDocument | null {
  const byLocale = CONTENT[locale] ?? CONTENT.en;
  return (LEGAL_SLUGS as readonly string[]).includes(slug)
    ? byLocale[slug as LegalSlug]
    : null;
}
