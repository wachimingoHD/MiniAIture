# MiniAItura

Generador de miniaturas de YouTube con IA. Describe tu vídeo y un director de arte con IA convierte tu idea en una miniatura optimizada para CTR, con galería personal, galería de la comunidad con estilos copiables y plan PRO por suscripción.

**Web oficial:** <https://miniaitura.com>

## Stack

- Next.js (App Router) + Tailwind CSS
- Firebase (Auth, Firestore, Storage, App Check)
- Stripe (suscripción PRO)
- Gemini (texto + imagen) y fal.ai (fallback + upscale)

## Desarrollo

```bash
npm install
npm run dev        # servidor de desarrollo
npm run test       # tests (vitest)
npm run typecheck  # tsc --noEmit
```

Requiere variables de entorno propias (Firebase, Stripe, Gemini, fal.ai) en `.env.local`.

## Licencia

Este proyecto se publica bajo la **[PolyForm Noncommercial License 1.0.0](LICENSE.md)**.

Required Notice: Copyright (c) 2026 MiniAItura (https://miniaitura.com)

En resumen (el texto legal completo en [LICENSE.md](LICENSE.md) es el que manda):

- ✅ Puedes leer, usar, modificar y compartir este código **para fines no comerciales** (estudio personal, investigación, hobby).
- ❌ **No puedes** usar este código, ni versiones modificadas, con fines comerciales: desplegarlo como servicio o SaaS con pagos, suscripciones, publicidad, donaciones u otra monetización, sin permiso previo por escrito del titular del copyright.

Para licencias comerciales, contacta con los autores.
