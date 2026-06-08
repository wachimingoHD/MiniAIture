import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Wrappers de navegación conscientes del idioma. Usar estos `Link`/`useRouter`/
// `usePathname`/`redirect` en lugar de los de `next/navigation` para que los
// enlaces mantengan el prefijo de locale automáticamente.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
