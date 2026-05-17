'use client';

import * as React from 'react';
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

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Label du bouton primaire (par défaut "Confirmer"). */
  confirmLabel?: string;
  /** Label du bouton secondaire (par défaut "Annuler"). */
  cancelLabel?: string;
  /** Variante destructive (rouge). */
  destructive?: boolean;
  /** Si présent, exige une saisie de motif >= minReasonLength. */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  minReasonLength?: number;
  /** Disabled pendant un mutation en cours. */
  loading?: boolean;
  onConfirm: (reason?: string) => void | Promise<void>;
}

/**
 * Modal de confirmation réutilisable. Utilisé pour les actions
 * destructives (annulation DA, rejet) ou les transitions critiques
 * (approbation DAF >= 5M XOF). Peut exiger un motif (rejet).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  destructive = false,
  requireReason = false,
  reasonLabel = 'Motif',
  reasonPlaceholder = 'Précisez le motif…',
  minReasonLength = 5,
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    if (!open) setReason('');
  }, [open]);

  const reasonInvalid = requireReason && reason.trim().length < minReasonLength;
  const handleConfirm = async () => {
    if (reasonInvalid) return;
    await onConfirm(requireReason ? reason.trim() : undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {requireReason && (
          <div className="space-y-2">
            <Label htmlFor="confirm-reason">{reasonLabel}</Label>
            <Input
              id="confirm-reason"
              data-testid="confirm-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              autoFocus
            />
            <p className="text-xs text-slate-muted">
              Minimum {minReasonLength} caractères ({reason.trim().length}/{minReasonLength}).
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={reasonInvalid || loading}
            data-testid="confirm-button"
          >
            {loading ? '…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
