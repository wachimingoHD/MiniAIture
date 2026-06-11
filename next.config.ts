import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  // Proxy del handler de Firebase Auth para poder usar el dominio propio como
  // authDomain: el popup de Google pasa de decir "Ir a miniaitures-f3818.
  // firebaseapp.com" a "Ir a miniaitura.com". Inerte hasta que
  // NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN apunte al dominio propio (ver README de
  // pasos: dominio autorizado en Firebase Auth + redirect URI en el cliente
  // OAuth de Google Cloud).
  async rewrites() {
    return [
      {
        source: "/__/auth/:path*",
        destination: "https://miniaitures-f3818.firebaseapp.com/__/auth/:path*",
      },
      {
        source: "/__/firebase/:path*",
        destination: "https://miniaitures-f3818.firebaseapp.com/__/firebase/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
      {
        // Las rutas proxificadas de Firebase Auth (/__/auth/iframe) deben poder
        // incrustarse en NUESTRAS páginas (el SDK las usa para entregar el
        // resultado del login). El DENY global las rompía: popup en blanco.
        // Esta regla va después del catch-all para sobreescribir solo aquí.
        source: "/__/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
