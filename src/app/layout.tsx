import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MiniAItures - AI YouTube Thumbnails in Seconds",
  description:
    "Generate professional-looking YouTube thumbnails in seconds. Powered by Gemini and fal.ai. No design skills needed.",
  applicationName: "MiniAItures",
  authors: [{ name: "MiniAItures" }],
  keywords: [
    "YouTube thumbnails",
    "AI thumbnail generator",
    "Gemini",
    "fal.ai",
    "thumbnail design",
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
