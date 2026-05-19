'use client';

import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type IbanAlertLevel = 'ok' | 'warn' | 'critical';

export interface IbanAlertBadgeProps {
  level: IbanAlertLevel;
  /** Nombre d'alertes (affiché en suffixe si > 0). */
  count?: number;
  className?: string;
}

/**
 * Badge anti-fraude IBAN à 3 niveaux :
 *   - ok       : aucune alerte (vert)
 *   - warn     : alertes présentes mais toutes acknowledgées (orange)
 *   - critical : alertes non-acknowledgées — bloque l'approbation (rouge)
 *
 * Pensé pour l'affichage compact dans la liste des PaymentRuns.
 */
export function IbanAlertBadge({ level, count, className }: IbanAlertBadgeProps) {
  const config = configFor(level);
  return (
    <Badge
      variant={config.variant}
      data-testid="iban-alert-badge"
      data-level={level}
      className={cn('text-[10px]', className)}
    >
      <config.Icon className="mr-1 h-3 w-3" />
      {config.label}
      {count !== undefined && count > 0 && level !== 'ok' && (
        <span className="ml-1 font-mono">({count})</span>
      )}
    </Badge>
  );
}

function configFor(level: IbanAlertLevel) {
  if (level === 'ok') {
    return {
      Icon: ShieldCheck,
      label: 'IBAN OK',
      variant: 'success' as const,
    };
  }
  if (level === 'warn') {
    return {
      Icon: ShieldAlert,
      label: 'IBAN acknowledgé',
      variant: 'warning' as const,
    };
  }
  return {
    Icon: ShieldX,
    label: 'IBAN à vérifier',
    variant: 'error' as const,
  };
}
