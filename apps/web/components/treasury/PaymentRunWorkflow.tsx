'use client';

import {
  Check,
  FileText,
  Send,
  ShieldCheck,
  Banknote,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type PaymentRunStatus =
  | 'draft'
  | 'prepared'
  | 'executed'
  | 'rejected'
  | 'cancelled';

export interface PaymentRunWorkflowProps {
  status: PaymentRunStatus;
  /** Date d'approbation (optionnelle). */
  approvedAt?: string | null;
  /** Date d'exécution (optionnelle). */
  executedAt?: string | null;
  /** Date de génération SEPA (optionnelle). */
  sepaGeneratedAt?: string | null;
  className?: string;
}

interface Step {
  key: 'draft' | 'prepared' | 'sepa' | 'executed';
  label: string;
  icon: LucideIcon;
}

const STEPS: Step[] = [
  { key: 'draft', label: 'Brouillon', icon: FileText },
  { key: 'prepared', label: 'Préparé', icon: ShieldCheck },
  { key: 'sepa', label: 'SEPA généré', icon: Send },
  { key: 'executed', label: 'Exécuté', icon: Banknote },
];

/**
 * Timeline horizontale 4 étapes du cycle de vie d'un PaymentRun :
 * draft → prepared → SEPA généré → executed. Les étapes alternatives
 * (rejected / cancelled) sont affichées en bandeau séparé au-dessus.
 *
 * Sprint F4b — visuel pour le détail PaymentRun.
 */
export function PaymentRunWorkflow({
  status,
  approvedAt,
  executedAt,
  sepaGeneratedAt,
  className,
}: PaymentRunWorkflowProps) {
  // Cas terminaux négatifs : on n'affiche pas la timeline mais un
  // bandeau d'état spécifique.
  if (status === 'rejected' || status === 'cancelled') {
    return (
      <div
        data-testid="payment-run-workflow"
        data-status={status}
        className={cn(
          'flex items-center gap-2 rounded-md border-2 border-state-error/40 bg-state-error/10 px-4 py-3 text-sm font-medium text-state-error',
          className,
        )}
      >
        <X className="h-5 w-5" />
        {status === 'rejected' ? 'Rejeté par le DAF' : 'Annulé en brouillon'}
      </div>
    );
  }

  // Détermine l'avancement
  const currentIndex = computeCurrentIndex(status, !!sepaGeneratedAt);

  return (
    <ol
      data-testid="payment-run-workflow"
      data-status={status}
      data-current-index={currentIndex}
      className={cn('flex items-center justify-between gap-2', className)}
    >
      {STEPS.map((step, idx) => {
        const completed = idx < currentIndex;
        const active = idx === currentIndex;
        const Icon = step.icon;
        return (
          <li key={step.key} className="flex flex-1 items-center gap-3" data-testid={`workflow-step-${step.key}`}>
            <div className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border-2',
                  completed && 'border-state-success bg-state-success text-white',
                  active && 'border-ipd-dark bg-ipd-50 text-ipd-darker',
                  !completed && !active && 'border-slate-200 bg-white text-slate-muted',
                )}
              >
                {completed ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <span
                className={cn(
                  'text-xs',
                  completed && 'font-medium text-state-success',
                  active && 'font-semibold text-ipd-darker',
                  !completed && !active && 'text-slate-muted',
                )}
              >
                {step.label}
              </span>
              {/* Date sous-titre selon étape */}
              {completed && (
                <span className="text-[10px] text-slate-muted">
                  {dateFor(step.key, { approvedAt, executedAt, sepaGeneratedAt })}
                </span>
              )}
            </div>
            {idx < STEPS.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'h-0.5 flex-1 -mt-5',
                  completed ? 'bg-state-success' : 'bg-slate-200',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function computeCurrentIndex(status: PaymentRunStatus, sepaGenerated: boolean): number {
  if (status === 'draft') return 0;
  if (status === 'prepared') return sepaGenerated ? 2 : 1;
  if (status === 'executed') return 3;
  return 0;
}

function dateFor(
  step: Step['key'],
  d: { approvedAt?: string | null; executedAt?: string | null; sepaGeneratedAt?: string | null },
): string {
  if (step === 'prepared' && d.approvedAt) return d.approvedAt.slice(0, 10);
  if (step === 'sepa' && d.sepaGeneratedAt) return d.sepaGeneratedAt.slice(0, 10);
  if (step === 'executed' && d.executedAt) return d.executedAt.slice(0, 10);
  return '';
}
