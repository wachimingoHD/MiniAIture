import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// /robots.txt — generado por Next. Indexa público (landing, galería, pricing),
// bloquea rutas privadas y de API.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard/", "/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
