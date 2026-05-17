import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  /** Couleur d'accent — pasteur (rouge) par défaut, "navy" pour les KPIs neutres. */
  accent?: 'pasteur' | 'navy' | 'success' | 'warning';
  /**
   * Progression 0..100 affichée en mini-bar en bas. Si undefined, on rend
   * un skeleton grisé (état "donnée pas encore disponible" — utile pour
   * les KPIs F1 dont la valeur viendra dans un sprint suivant).
   */
  progress?: number;
}

/**
 * Carte KPI réutilisable — bandeau gauche coloré (accent) + valeur grande
 * + label en muted + mini progress bar (ou skeleton si progress undefined).
 *
 * Sprint F1.1 — ajout de la progress bar (placeholder visuel jusqu'au
 * branchement réel sur les endpoints dashboard du sprint F2).
 */
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'pasteur',
  progress,
}: KpiCardProps) {
  const accentBg: Record<NonNullable<KpiCardProps['accent']>, string> = {
    pasteur: 'bg-pasteur',
    navy: 'bg-navy',
    success: 'bg-state-success',
    warning: 'bg-state-warning',
  };
  const isPlaceholder = progress === undefined;
  const clamped = Math.max(0, Math.min(100, progress ?? 0));
  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <CardContent className="p-0 flex items-stretch">
        <div className={cn('w-2', accentBg[accent])} aria-hidden />
        <div className="flex-1 p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-muted">{label}</p>
            {Icon && <Icon className="h-4 w-4 text-slate-muted" aria-hidden />}
          </div>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-text">{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-muted">{hint}</p>}

          {/* Progress bar (placeholder F1 ou réel F2) */}
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={isPlaceholder ? undefined : clamped}
            aria-label={`${label} — progression`}
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
          >
            {isPlaceholder ? (
              <div
                data-testid="kpi-skeleton"
                className="h-full w-1/4 animate-pulse bg-slate-200"
              />
            ) : (
              <div
                data-testid="kpi-progress"
                className={cn('h-full transition-[width] duration-500', accentBg[accent])}
                style={{ width: `${clamped}%` }}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
