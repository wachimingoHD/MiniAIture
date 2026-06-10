// Bus mínimo (CustomEvent en window) para que cualquier página que conozca un
// snapshot de créditos más fresco (p. ej. /generate tras cobrar una generación)
// se lo comunique a la cabecera global sin acoplarse a ella.

export interface CreditsBusSnapshot {
  plan: "free" | "pro" | null;
  credits: { daily: number; monthly: number } | null;
}

const EVENT_NAME = "miniaitura:credits";

export function publishCredits(snapshot: CreditsBusSnapshot): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CreditsBusSnapshot>(EVENT_NAME, { detail: snapshot }));
}

export function subscribeCredits(cb: (snapshot: CreditsBusSnapshot) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<CreditsBusSnapshot>).detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
