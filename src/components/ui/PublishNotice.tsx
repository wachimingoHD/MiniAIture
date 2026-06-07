// Aviso de privacidad al publicar una miniatura en la galería de la comunidad.
// Se reutiliza en la página de generación y en la galería privada para que el
// mensaje sea coherente en toda la app (doc §5/§6: el estilo se comparte; el
// contenido es personal).

export function PublishNotice() {
  return (
    <div className="rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] p-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
      <p className="mb-2 flex items-center gap-1.5 font-semibold text-[var(--color-text-primary)]">
        <span aria-hidden>🌐</span>
        Al publicar en la galería de la comunidad:
      </p>
      <ul className="space-y-1">
        <li className="flex gap-1.5">
          <span aria-hidden className="text-[var(--color-accent)]">•</span>
          <span>Tu miniatura será <strong className="font-semibold text-[var(--color-text-primary)]">visible públicamente</strong> para cualquiera.</span>
        </li>
        <li className="flex gap-1.5">
          <span aria-hidden className="text-[var(--color-accent)]">•</span>
          <span>Otras personas podrán <strong className="font-semibold text-[var(--color-text-primary)]">copiar tu contenido y tu estilo</strong> (por separado o juntos) para sus propias miniaturas.</span>
        </li>
        <li className="flex gap-1.5">
          <span aria-hidden className="text-[var(--color-accent)]">•</span>
          <span>Aparecerás como <strong className="font-semibold text-[var(--color-text-primary)]">autor</strong> con tu nombre público.</span>
        </li>
      </ul>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Podrás hacerla privada de nuevo cuando quieras desde tu galería.
      </p>
    </div>
  );
}

export default PublishNotice;
