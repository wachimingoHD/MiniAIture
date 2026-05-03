// Helpers for safe error reporting on API routes.
// In production we redact internal error messages so we don't leak stack
// traces, library internals, or hints about infrastructure to clients.

export function safeErrorMessage(err: unknown, fallback: string): string {
  if (process.env.NODE_ENV === "production") return fallback;
  return err instanceof Error ? err.message : fallback;
}
