"use client";

// Selector de idioma. Cambia el locale manteniendo la misma ruta (next-intl
// reescribe el prefijo /en|/es y persiste la elección en cookie NEXT_LOCALE).
import { useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const LABELS: Record<string, string> = { en: "EN", es: "ES" };

export function LanguageSwitcher({ expanded }: { expanded: boolean }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchTo = (next: string) => {
    if (next === locale) return;
    router.replace(pathname, { locale: next });
  };

  return (
    <div
      className={`flex ${expanded ? "gap-1" : "flex-col gap-1"} items-center justify-center`}
      role="group"
      aria-label="Language"
    >
      {routing.locales.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => switchTo(l)}
            aria-current={active ? "true" : undefined}
            className={[
              "rounded-md px-2 py-1 text-xs font-semibold transition-colors",
              active
                ? "bg-[var(--color-accent)] text-white"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-panel-2)] hover:text-[var(--color-text-primary)]",
            ].join(" ")}
          >
            {LABELS[l] ?? l.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

export default LanguageSwitcher;
