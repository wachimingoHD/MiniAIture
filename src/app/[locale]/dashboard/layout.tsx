// El dashboard es privado (galería personal, ajustes): fuera del índice de
// buscadores. robots.txt ya lo bloquea; esto añade la señal noindex explícita.

import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
