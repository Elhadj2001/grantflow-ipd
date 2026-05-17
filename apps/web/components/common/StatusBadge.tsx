import { Badge } from '@/components/ui/badge';

type StatusVariant = 'success' | 'warning' | 'error' | 'default' | 'secondary' | 'muted';

/**
 * Mapping centralisé statut métier → variante Badge + label FR.
 * Réutilisé pour PR, PO, GR, Invoice, Payment.
 */
const STATUS_MAP: Record<string, { variant: StatusVariant; label: string }> = {
  // Purchase request
  draft: { variant: 'muted', label: 'Brouillon' },
  submitted: { variant: 'warning', label: 'Soumise' },
  pending_pi: { variant: 'warning', label: 'En attente PI' },
  pending_cg: { variant: 'warning', label: 'En attente CG' },
  pending_daf: { variant: 'warning', label: 'En attente DAF' },
  pending_caissier: { variant: 'warning', label: 'En attente Caisse' },
  approved: { variant: 'success', label: 'Approuvée' },
  rejected: { variant: 'error', label: 'Rejetée' },
  cancelled: { variant: 'muted', label: 'Annulée' },
  closed: { variant: 'secondary', label: 'Clôturée' },
  settled: { variant: 'success', label: 'Régularisée' },
  // Purchase order
  sent: { variant: 'default', label: 'Envoyé' },
  acknowledged: { variant: 'default', label: 'Confirmé' },
  partially_received: { variant: 'warning', label: 'Reçu partiel' },
  received: { variant: 'success', label: 'Reçu' },
  invoiced: { variant: 'secondary', label: 'Facturé' },
  // Goods receipt
  partial: { variant: 'warning', label: 'Partielle' },
  complete: { variant: 'success', label: 'Complète' },
  // PR type
  petty_cash: { variant: 'secondary', label: 'Caisse' },
  cash_advance: { variant: 'secondary', label: 'Avance' },
  standard: { variant: 'muted', label: 'Standard' },
  // Invoice (sprint F3)
  captured: { variant: 'muted', label: 'Capturée' },
  matched: { variant: 'success', label: 'Rapprochée' },
  exception_price: { variant: 'error', label: 'Écart prix' },
  exception_qty: { variant: 'error', label: 'Écart qté' },
  posted: { variant: 'secondary', label: 'Comptabilisée' },
  paid: { variant: 'success', label: 'Payée' },
  archived: { variant: 'muted', label: 'Archivée' },
};

export interface StatusBadgeProps {
  status: string;
  /** Override le label FR par défaut (utile pour les valeurs non mappées). */
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const entry = STATUS_MAP[status] ?? { variant: 'muted' as const, label: status };
  return (
    <Badge variant={entry.variant} data-testid={`status-badge-${status}`}>
      {label ?? entry.label}
    </Badge>
  );
}
