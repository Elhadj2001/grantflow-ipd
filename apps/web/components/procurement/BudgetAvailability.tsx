'use client';

import * as React from 'react';
import { ProjectPicker } from './pickers/ProjectPicker';
import { GrantPicker } from './pickers/GrantPicker';
import { BudgetLinePicker } from './pickers/BudgetLinePicker';
import { BudgetIndicator } from './BudgetIndicator';
import { Label } from '@/components/ui/label';

export interface BudgetAvailabilityValue {
  projectId: string | null;
  grantId: string | null;
  budgetLineId: string | null;
  /** Devise du grant sélectionné (XOF / EUR / USD). */
  currency: string | null;
  /** Solde disponible sur la ligne sélectionnée. */
  available: number | null;
  /** Budget alloué à la ligne sélectionnée. */
  budgeted: number | null;
}

export interface BudgetAvailabilityProps {
  value: BudgetAvailabilityValue;
  onChange: (next: BudgetAvailabilityValue) => void;
  /** Montant que l'utilisateur veut engager — alimente l'indicateur. */
  requestedAmount?: number;
  /** Masque le BudgetLinePicker (utile pour le header DA standard). */
  hideBudgetLine?: boolean;
  /** Désactive l'ensemble du composant. */
  disabled?: boolean;
  className?: string;
}

/**
 * Composite "imputation analytique" : Projet → Convention → Ligne
 * budgétaire, avec affichage temps réel du solde disponible.
 *
 * Pattern controlled : le parent passe `value` + `onChange` et reçoit
 * un objet plat à chaque modification. Le composant gère lui-même la
 * cascade (changer le projet vide la convention et la ligne).
 *
 * Note : pour une DA standard où chaque ligne a sa propre ligne
 * budgétaire mais le projet/grant sont partagés, utiliser plutôt
 * `ProjectPicker` + `GrantPicker` au niveau header puis
 * `BudgetLinePicker` au niveau de chaque ligne.
 */
export function BudgetAvailability({
  value,
  onChange,
  requestedAmount,
  hideBudgetLine = false,
  disabled,
  className,
}: BudgetAvailabilityProps) {
  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <Label className="mb-1.5 block text-xs uppercase tracking-wide text-slate-muted">
            Projet
          </Label>
          <ProjectPicker
            value={value.projectId}
            disabled={disabled}
            onChange={(projectId) => {
              // Cascade : changer le projet vide convention + ligne
              onChange({
                ...value,
                projectId,
                grantId: null,
                budgetLineId: null,
                currency: null,
                available: null,
                budgeted: null,
              });
            }}
          />
        </div>
        <div>
          <Label className="mb-1.5 block text-xs uppercase tracking-wide text-slate-muted">
            Convention
          </Label>
          <GrantPicker
            projectId={value.projectId}
            value={value.grantId}
            disabled={disabled}
            onChange={(grantId, grant) => {
              onChange({
                ...value,
                grantId,
                currency: grant?.currency ?? null,
                budgetLineId: null,
                available: null,
                budgeted: null,
              });
            }}
          />
        </div>
        {!hideBudgetLine && (
          <div>
            <Label className="mb-1.5 block text-xs uppercase tracking-wide text-slate-muted">
              Ligne budgétaire
            </Label>
            <BudgetLinePicker
              grantId={value.grantId}
              value={value.budgetLineId}
              requestedAmount={requestedAmount}
              currency={value.currency ?? undefined}
              disabled={disabled}
              onChange={(budgetLineId, entry) => {
                onChange({
                  ...value,
                  budgetLineId,
                  available: entry?.available ?? null,
                  budgeted: entry?.budgeted ?? null,
                });
              }}
            />
          </div>
        )}
      </div>

      {!hideBudgetLine && value.budgetLineId && value.budgeted !== null && value.available !== null && (
        <BudgetIndicator
          className="mt-3"
          budgeted={value.budgeted}
          available={value.available}
          requested={requestedAmount}
          currency={value.currency ?? 'XOF'}
        />
      )}
    </div>
  );
}
