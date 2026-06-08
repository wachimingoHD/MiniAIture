import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Detecta el idioma en la primera visita (header Accept-Language) y redirige a la
// URL con prefijo de locale. También gestiona el cambio de idioma vía cookie.
export default createMiddleware(routing);

export const config = {
  // Excluye rutas de API, assets internos de Next y cualquier ruta con extensión
  // (robots.txt, sitemap.xml, imágenes, etc.) del routing de idioma.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
