import type { Metadata } from "next";
import { Baloo_2, DM_Sans } from "next/font/google";
import "./globals.css";

const display = Baloo_2({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display-next",
  display: "swap",
});

const body = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body-next",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://miniaitura.com"),
  title: {
    default: "MiniAItura — Miniaturas de YouTube con IA",
    template: "%s | MiniAItura",
  },
  description:
    "Describe tu vídeo y nuestra IA genera la miniatura perfecta para tu nicho. Miniaturas de YouTube que consiguen clics, sin saber diseñar.",
  applicationName: "MiniAItura",
  keywords: [
    "miniaturas YouTube",
    "generador de miniaturas IA",
    "thumbnails YouTube",
    "MiniAItura",
  ],
  openGraph: {
    title: "MiniAItura — Miniaturas de YouTube con IA",
    description:
      "Describe tu vídeo y la IA genera la miniatura perfecta para tu nicho.",
    type: "website",
    siteName: "MiniAItura",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`dark ${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
