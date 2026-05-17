import { Check, Circle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DateDisplay } from './DateDisplay';

export interface WorkflowStep {
  /** Identifiant unique de l'étape (UUID approval_step). */
  id: string;
  /** Numéro de séquence (1, 2, 3…). */
  stepOrder: number;
  /** Rôle attendu (PI, CG, DAF, …). */
  approverRole: string | null;
  /** UUID de l'approbateur effectif (si décidée). */
  approverId: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'returned';
  decidedAt: string | null;
  decisionNotes?: string | null;
  /** Optionnel : nom de l'approbateur résolu côté serveur. */
  approverName?: string | null;
}

/**
 * Affiche l'historique d'approbation d'une DA sous forme de timeline
 * verticale : un point par étape + label rôle + statut + date décision.
 */
export function WorkflowTimeline({ steps }: { steps: WorkflowStep[] }) {
  if (steps.length === 0) {
    return <p className="text-sm text-slate-muted">Aucune étape d'approbation enregistrée.</p>;
  }
  return (
    <ol className="space-y-4">
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1;
        const Icon =
          step.status === 'approved'
            ? Check
            : step.status === 'rejected'
              ? XCircle
              : Circle;
        const iconBg =
          step.status === 'approved'
            ? 'bg-state-success text-white'
            : step.status === 'rejected'
              ? 'bg-state-error text-white'
              : step.status === 'returned'
                ? 'bg-state-warning text-white'
                : 'bg-slate-200 text-slate-muted';

        return (
          <li
            key={step.id}
            data-testid={`workflow-step-${step.stepOrder}`}
            className="relative flex gap-3 pb-2"
          >
            {/* Connecteur vertical (sauf dernière étape) */}
            {!isLast && (
              <span aria-hidden className="absolute left-3 top-7 h-full w-px bg-slate-200" />
            )}
            <span className={cn('relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', iconBg)}>
              <Icon className="h-3 w-3" aria-hidden />
            </span>
            <div className="flex-1 -mt-0.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-text">
                  Étape {step.stepOrder} — {step.approverRole ?? '(inconnu)'}
                </p>
                <span className="text-xs text-slate-muted">
                  {step.decidedAt ? <DateDisplay value={step.decidedAt} format="datetime" /> : 'En attente'}
                </span>
              </div>
              {step.approverName && (
                <p className="mt-0.5 text-xs text-slate-muted">par {step.approverName}</p>
              )}
              {step.decisionNotes && (
                <p className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-text">
                  « {step.decisionNotes} »
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
