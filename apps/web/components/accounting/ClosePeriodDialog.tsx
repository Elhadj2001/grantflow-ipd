'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ClosePeriodInput } from '@/lib/api/accounting';

export interface ClosePeriodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nombre de findings BLOCKING détectés au dernier précheck. */
  blockingCount: number;
  /** Indique si l'utilisateur courant peut overrider (DAF / SUPER_ADMIN). */
  canOverride: boolean;
  loading?: boolean;
  errorMessage?: string | null;
  onConfirm: (input: ClosePeriodInput) => Promise<void> | void;
}

/**
 * Dialog de clôture d'une période. Logique :
 *  - Pas de finding BLOCKING : on demande juste reason optionnel,
 *    `acknowledgeWarnings` reste false côté payload.
 *  - Findings BLOCKING + canOverride : checkbox "Override DAF" obligatoire
 *    + reason ≥ 5 caractères (validé côté backend).
 *  - Findings BLOCKING + !canOverride : bouton Confirmer désactivé,
 *    message expliquant que seul le DAF peut overrider.
 */
export function ClosePeriodDialog({
  open,
  onOpenChange,
  blockingCount,
  canOverride,
  loading,
  errorMessage,
  onConfirm,
}: ClosePeriodDialogProps) {
  const [acknowledge, setAcknowledge] = useState(false);
  const [reason, setReason] = useState('');

  // Reset à chaque ouverture
  useEffect(() => {
    if (!open) {
      setAcknowledge(false);
      setReason('');
    }
  }, [open]);

  const requiresReason = blockingCount > 0;
  const reasonValid = !requiresReason || reason.trim().length >= 5;
  const overrideValid = !requiresReason || acknowledge;
  const canSubmit = canOverride || blockingCount === 0
    ? reasonValid && overrideValid
    : false;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    await onConfirm({
      acknowledgeWarnings: requiresReason ? acknowledge : false,
      reason: reason.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="close-period-dialog">
        <DialogHeader>
          <DialogTitle>Clôturer la période</DialogTitle>
          <DialogDescription>
            La clôture rend la période immutable (aucune écriture ne peut plus y être posted).
          </DialogDescription>
        </DialogHeader>

        {requiresReason && (
          <div
            data-testid="close-blocking-banner"
            className="flex items-start gap-2 rounded-md border border-state-error/40 bg-state-error/5 px-3 py-2 text-sm text-state-error"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <strong>{blockingCount}</strong> finding{blockingCount > 1 ? 's' : ''} bloquant
              {blockingCount > 1 ? 's' : ''} non résolu{blockingCount > 1 ? 's' : ''}.
              {canOverride
                ? ' L\'override DAF est requis (cocher + motif).'
                : ' Seul un DAF / SUPER_ADMIN peut clôturer.'}
            </p>
          </div>
        )}

        {requiresReason && canOverride && (
          <label
            data-testid="acknowledge-checkbox-label"
            className="flex items-start gap-2 rounded-md border border-state-warning/30 bg-state-warning/5 px-3 py-2 text-sm text-state-warning cursor-pointer"
          >
            <input
              type="checkbox"
              data-testid="acknowledge-checkbox"
              checked={acknowledge}
              onChange={(e) => setAcknowledge(e.target.checked)}
              className="mt-1"
            />
            <span>
              J&apos;assume la responsabilité de clôturer malgré {blockingCount} finding
              {blockingCount > 1 ? 's' : ''} bloquant{blockingCount > 1 ? 's' : ''}. Cette
              décision sera tracée dans le journal d&apos;audit (period_close_event).
            </span>
          </label>
        )}

        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wide text-slate-muted">
            Motif {requiresReason ? '(obligatoire, ≥ 5 caractères)' : '(optionnel)'}
          </Label>
          <Input
            data-testid="close-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex. C006 résolu manuellement — facture saisie en N+1"
          />
          {requiresReason && !reasonValid && reason.length > 0 && (
            <p className="text-xs text-state-error">Minimum 5 caractères.</p>
          )}
        </div>

        {errorMessage && (
          <p
            data-testid="close-error"
            className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
          >
            {errorMessage}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canSubmit || loading}
            data-testid="close-confirm"
          >
            <Lock className="mr-1 h-4 w-4" />
            {loading ? 'Clôture…' : 'Clôturer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
