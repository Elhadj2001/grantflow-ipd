'use client';

import { FileEdit, Lock, Send, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DonorReportStatus } from '@/lib/api/reporting';

export interface DonorReportStatusBadgeProps {
  status: DonorReportStatus;
  className?: string;
}

const LABELS: Record<DonorReportStatus, string> = {
  draft: 'Brouillon',
  locked: 'Verrouillé',
  sent: 'Envoyé',
};

const ICONS: Record<DonorReportStatus, LucideIcon> = {
  draft: FileEdit,
  locked: Lock,
  sent: Send,
};

/**
 * Badge de statut d'un DonorReport. Le mapping :
 *   - draft  → muted (gris) — édition libre
 *   - locked → warning (ambre) — PDF/Excel générés, en attente d'envoi
 *   - sent   → success (vert) — immutable (trigger DB)
 *
 * Inclut une icône explicite pour distinguer rapidement les statuts
 * dans une liste dense (cf. DonorReportList).
 */
export function DonorReportStatusBadge({ status, className }: DonorReportStatusBadgeProps) {
  const Icon = ICONS[status];
  const variant = (() => {
    switch (status) {
      case 'draft':
        return 'muted' as const;
      case 'locked':
        return 'warning' as const;
      case 'sent':
        return 'success' as const;
    }
  })();

  return (
    <Badge
      data-testid="donor-report-status-badge"
      data-status={status}
      variant={variant}
      className={cn('gap-1', className)}
    >
      <Icon className="h-3 w-3" />
      {LABELS[status]}
    </Badge>
  );
}
