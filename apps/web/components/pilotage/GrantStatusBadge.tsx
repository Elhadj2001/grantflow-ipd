'use client';

import { Badge } from '@/components/ui/badge';

export type GrantBadgeStatus =
  | 'draft'
  | 'active'
  | 'suspended'
  | 'closed'
  | 'expiring'
  | 'expired';

export interface GrantStatusBadgeProps {
  status: GrantBadgeStatus;
  className?: string;
}

const LABELS: Record<GrantBadgeStatus, string> = {
  draft: 'Brouillon',
  active: 'Active',
  suspended: 'Suspendue',
  closed: 'Clôturée',
  expiring: 'Expire bientôt',
  expired: 'Expirée',
};

/**
 * Badge de statut de convention. Mappe le `GrantStatus` SYSCEBNL
 * (draft|active|suspended|closed) sur les variants du Badge UI
 * (cf. components/ui/badge.tsx).
 *
 * Statuts dérivés "expiring" / "expired" sont calculés côté caller
 * à partir de endDate vs today (cf. computeGrantAlertLevel).
 */
export function GrantStatusBadge({ status, className }: GrantStatusBadgeProps) {
  const variant = (() => {
    switch (status) {
      case 'active':
        return 'success' as const;
      case 'suspended':
        return 'warning' as const;
      case 'closed':
        return 'muted' as const;
      case 'expiring':
        return 'warning' as const;
      case 'expired':
        return 'error' as const;
      case 'draft':
      default:
        return 'outline' as const;
    }
  })();

  return (
    <Badge
      data-testid="grant-status-badge"
      data-status={status}
      variant={variant}
      className={className}
    >
      {LABELS[status]}
    </Badge>
  );
}
