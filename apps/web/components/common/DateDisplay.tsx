'use client';

export interface DateDisplayProps {
  value: string | Date | null | undefined;
  /** Format complet (par défaut "17 mai 2026"). */
  format?: 'long' | 'short' | 'datetime';
  /** Ajoute "il y a X jours" en tooltip + sous-titre. */
  relative?: boolean;
}

const LONG_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const SHORT_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const RELATIVE_FMT = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

function relativeFromNow(d: Date): string {
  const diffMs = d.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return RELATIVE_FMT.format(diffSec, 'second');
  if (abs < 3600) return RELATIVE_FMT.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return RELATIVE_FMT.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 30 * 86400) return RELATIVE_FMT.format(Math.round(diffSec / 86400), 'day');
  if (abs < 365 * 86400) return RELATIVE_FMT.format(Math.round(diffSec / (30 * 86400)), 'month');
  return RELATIVE_FMT.format(Math.round(diffSec / (365 * 86400)), 'year');
}

/**
 * Date formatée FR. Si `relative=true`, ajoute "il y a X jours" en sous-titre.
 * Renvoie em-dash "—" si la valeur est null/undefined/invalide.
 */
export function DateDisplay({ value, format = 'long', relative = false }: DateDisplayProps) {
  if (!value) return <span className="text-slate-muted">—</span>;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return <span className="text-slate-muted">—</span>;

  const main =
    format === 'short' ? SHORT_FMT.format(d) : format === 'datetime' ? DATETIME_FMT.format(d) : LONG_FMT.format(d);
  const rel = relative ? relativeFromNow(d) : null;

  if (!rel) return <time dateTime={d.toISOString()}>{main}</time>;
  return (
    <time dateTime={d.toISOString()} title={d.toISOString()} className="inline-flex flex-col leading-tight">
      <span>{main}</span>
      <span className="text-xs text-slate-muted">{rel}</span>
    </time>
  );
}
