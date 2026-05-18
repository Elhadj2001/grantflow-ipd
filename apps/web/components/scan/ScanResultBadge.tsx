'use client';

import { CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ScanResultKind = 'ok' | 'warn' | 'error' | null;

export interface ScanResultBadgeProps {
  kind: ScanResultKind;
  message: string | null;
  className?: string;
}

/**
 * Feedback visuel court après un scan. Pensé pour s'afficher en
 * overlay au-dessus de la liste de progression. Couleurs aqua IPD
 * pour le succès, état warning/error pour les cas dégradés.
 *
 *   ok    : "Ligne XX +1" (ligne matchée, qté incrémentée)
 *   warn  : "Quantité dépassée — confirmer ?"
 *   error : "Code XXX non reconnu"
 */
export function ScanResultBadge({ kind, message, className }: ScanResultBadgeProps) {
  if (!kind || !message) return null;

  const config = configFor(kind);

  return (
    <div
      role="status"
      data-testid="scan-result-badge"
      data-kind={kind}
      className={cn(
        'pointer-events-none flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-md backdrop-blur-sm',
        config.classes,
        className,
      )}
    >
      <config.Icon className="h-4 w-4" />
      <span>{message}</span>
    </div>
  );
}

function configFor(kind: NonNullable<ScanResultKind>) {
  if (kind === 'ok') {
    return {
      Icon: CheckCircle2,
      classes: 'border-state-success bg-state-success/15 text-state-success',
    };
  }
  if (kind === 'warn') {
    return {
      Icon: AlertTriangle,
      classes: 'border-state-warning bg-state-warning/15 text-state-warning',
    };
  }
  return {
    Icon: AlertCircle,
    classes: 'border-state-error bg-state-error/15 text-state-error',
  };
}
