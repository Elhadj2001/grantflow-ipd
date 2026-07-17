'use client';

import { ShieldAlert } from 'lucide-react';
import type { ApiError } from '@/lib/api-client';

export const ELIGIBILITY_ERROR_CODE = 'BUSINESS.ELIGIBILITY_VALIDATION_FAILED';

/**
 * US-064 — restitution LISIBLE d'un refus d'éligibilité au submit d'une DA
 * (EligibilityValidationException, ADR-007) : panneau dédié sous le header
 * du détail DA, pas un toast générique. Traduit chaque code PPT bloquant
 * en libellé métier français ; le message serveur complet reste affiché
 * en dessous (il porte le détail par règle).
 */
const PPT_CODE_LABELS: Record<string, string> = {
  ELIG_NATURE_NOT_ALLOWED: 'Nature de dépense non autorisée par la convention',
  ELIG_DATE_OUT_OF_WINDOW: 'Date hors période de validité de la convention',
  ELIG_LINE_BUDGET_EXCEEDED: 'Ligne budgétaire dépassée',
  ELIG_LINE_NATURE_INCOHERENT: 'Nature incohérente avec la catégorie de la ligne',
  ELIG_PASTEUR_PARIS_REIMBURSED: 'Dépense déjà refacturée à Pasteur Paris',
  ELIG_PERIOD_CLOSED: 'Période fiscale close',
};

export function isEligibilityError(err: ApiError | null | undefined): boolean {
  return err?.body?.code === ELIGIBILITY_ERROR_CODE;
}

export function EligibilityErrorAlert({ error }: { error: ApiError }) {
  const blockedCodes = Array.isArray(error.body?.details?.blockedCodes)
    ? (error.body.details.blockedCodes as string[])
    : [];

  return (
    <div
      role="alert"
      data-testid="eligibility-error"
      className="rounded-carte border border-ipd-rouge-bordure bg-ipd-rouge-tint p-4"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-ipd-rouge" />
        <div className="space-y-2">
          <p className="font-titre text-sm font-semibold text-ipd-rouge">
            Soumission refusée par le contrôle d&apos;éligibilité
          </p>
          {blockedCodes.length > 0 && (
            <ul className="list-inside list-disc space-y-1 text-sm text-foreground">
              {blockedCodes.map((code) => (
                <li key={code} data-testid={`eligibility-error-${code}`}>
                  {PPT_CODE_LABELS[code] ?? code}
                  <span className="ml-1 font-mono text-xs text-slate-muted">({code})</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-muted">{error.body?.message}</p>
          <p className="text-xs text-slate-muted">
            Corrigez la demande (nature, dates, montants) ou rapprochez-vous du
            Grant Office pour la Note Technique applicable.
          </p>
        </div>
      </div>
    </div>
  );
}
