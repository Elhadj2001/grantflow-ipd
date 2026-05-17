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
}

/**
 * Carte KPI réutilisable — bloc gauche coloré (accent) + valeur grande
 * + label en muted. À utiliser dans le dashboard et autres pages
 * agrégeant des métriques.
 */
export function KpiCard({ label, value, hint, icon: Icon, accent = 'pasteur' }: KpiCardProps) {
  const accentClasses: Record<NonNullable<KpiCardProps['accent']>, string> = {
    pasteur: 'bg-pasteur text-white',
    navy: 'bg-navy text-white',
    success: 'bg-state-success text-white',
    warning: 'bg-state-warning text-white',
  };
  return (
    <Card>
      <CardContent className="p-0 flex items-stretch">
        <div className={cn('w-2 rounded-l-lg', accentClasses[accent].split(' ')[0])} />
        <div className="flex-1 p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-muted">{label}</p>
            {Icon && <Icon className="h-4 w-4 text-slate-muted" />}
          </div>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-text">{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-muted">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
