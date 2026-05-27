'use client';

import Link from 'next/link';
import {
  ClipboardList,
  FileText,
  Inbox,
  Loader2,
  PackageCheck,
  ShoppingCart,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useListPRs, useListPOs, useListGRs } from '@/hooks/use-procurement';
import { useListInvoices } from '@/hooks/use-invoicing';
import { useListPaymentRuns } from '@/hooks/use-treasury';
import { usePermissions } from '@/hooks/use-permissions';
import type {
  GoodsReceipt,
  PurchaseOrder,
  PurchaseRequest,
} from '@/lib/api/procurement';
import type { Invoice } from '@/lib/api/invoicing';
import type { PaymentRun } from '@/lib/api/treasury';

type ActivityKind = 'PR' | 'PO' | 'GR' | 'INVOICE' | 'PAYMENT_RUN';

interface ActivityItem {
  kind: ActivityKind;
  id: string;
  /** Identifiant métier (DA-2026-001, BC-2026-..., etc.) affiché en gras. */
  ref: string;
  /** Sous-titre (statut, fournisseur, etc.). */
  subtitle: string;
  /** Date ISO — utilisée pour le tri et l'affichage relatif. */
  date: string;
  /** URL de détail. */
  href: string;
  /** Variante de badge shadcn pour le statut. */
  statusVariant: 'default' | 'success' | 'warning' | 'error' | 'muted' | 'secondary';
  statusLabel: string;
  icon: LucideIcon;
}

// ---------------------------------------------------------------------
// Mappers status → libellé FR + variant badge
// ---------------------------------------------------------------------

function prStatusUI(status: string): { label: string; variant: ActivityItem['statusVariant'] } {
  switch (status) {
    case 'draft':           return { label: 'Brouillon', variant: 'muted' };
    case 'submitted':       return { label: 'Soumise', variant: 'default' };
    case 'pending_pi':      return { label: 'Attente PI', variant: 'warning' };
    case 'pending_cg':      return { label: 'Attente CG', variant: 'warning' };
    case 'pending_daf':     return { label: 'Attente DAF', variant: 'warning' };
    case 'pending_cashier': return { label: 'Attente caissier', variant: 'warning' };
    case 'approved':        return { label: 'Approuvée', variant: 'success' };
    case 'rejected':        return { label: 'Rejetée', variant: 'error' };
    case 'cancelled':       return { label: 'Annulée', variant: 'muted' };
    case 'settled':         return { label: 'Régularisée', variant: 'success' };
    default:                return { label: status, variant: 'secondary' };
  }
}

function poStatusUI(status: string): { label: string; variant: ActivityItem['statusVariant'] } {
  switch (status) {
    case 'draft':              return { label: 'Brouillon', variant: 'muted' };
    case 'sent':               return { label: 'Envoyé', variant: 'default' };
    case 'acknowledged':       return { label: 'Confirmé', variant: 'default' };
    case 'partially_received': return { label: 'Partiellement reçu', variant: 'warning' };
    case 'received':           return { label: 'Reçu', variant: 'success' };
    case 'invoiced':           return { label: 'Facturé', variant: 'success' };
    case 'closed':             return { label: 'Clos', variant: 'muted' };
    case 'cancelled':          return { label: 'Annulé', variant: 'muted' };
    default:                   return { label: status, variant: 'secondary' };
  }
}

function grStatusUI(status: string): { label: string; variant: ActivityItem['statusVariant'] } {
  switch (status) {
    case 'draft':    return { label: 'En cours', variant: 'muted' };
    case 'complete': return { label: 'Complète', variant: 'success' };
    case 'rejected': return { label: 'Rejetée', variant: 'error' };
    case 'cancelled':return { label: 'Annulée', variant: 'muted' };
    default:         return { label: status, variant: 'secondary' };
  }
}

function invoiceStatusUI(status: string): { label: string; variant: ActivityItem['statusVariant'] } {
  switch (status) {
    case 'captured':     return { label: 'Capturée', variant: 'default' };
    case 'matched':      return { label: 'Matched', variant: 'success' };
    case 'posted':       return { label: 'Comptabilisée', variant: 'success' };
    case 'partially_paid':return { label: 'Partiellement payée', variant: 'warning' };
    case 'paid':         return { label: 'Payée', variant: 'success' };
    case 'rejected':     return { label: 'Rejetée', variant: 'error' };
    case 'archived':     return { label: 'Archivée', variant: 'muted' };
    default:             return { label: status, variant: 'secondary' };
  }
}

function paymentRunStatusUI(status: string): { label: string; variant: ActivityItem['statusVariant'] } {
  switch (status) {
    case 'draft':    return { label: 'Brouillon', variant: 'muted' };
    case 'prepared': return { label: 'Préparé', variant: 'default' };
    case 'approved': return { label: 'Approuvé', variant: 'success' };
    case 'executed': return { label: 'Exécuté', variant: 'success' };
    case 'rejected': return { label: 'Rejeté', variant: 'error' };
    case 'cancelled':return { label: 'Annulé', variant: 'muted' };
    default:         return { label: status, variant: 'secondary' };
  }
}

// ---------------------------------------------------------------------
//  Adapters : entité backend → ActivityItem
// ---------------------------------------------------------------------

function fromPR(pr: PurchaseRequest): ActivityItem {
  const { label, variant } = prStatusUI(pr.status);
  return {
    kind: 'PR',
    id: pr.id,
    ref: pr.prNumber,
    subtitle: pr.description ?? 'Demande d’achat',
    date: pr.requestedAt,
    href: `/procurement/purchase-requests/${pr.id}`,
    statusLabel: label,
    statusVariant: variant,
    icon: ClipboardList,
  };
}

function fromPO(po: PurchaseOrder): ActivityItem {
  const { label, variant } = poStatusUI(po.status);
  return {
    kind: 'PO',
    id: po.id,
    ref: po.poNumber,
    subtitle: `BC · ${po.currency} ${po.totalTtc}`,
    date: po.orderDate,
    href: `/procurement/purchase-orders/${po.id}`,
    statusLabel: label,
    statusVariant: variant,
    icon: ShoppingCart,
  };
}

function fromGR(gr: GoodsReceipt): ActivityItem {
  const { label, variant } = grStatusUI(gr.status);
  return {
    kind: 'GR',
    id: gr.id,
    ref: gr.grNumber,
    subtitle: 'Réception',
    date: gr.completedAt ?? gr.receiptDate,
    href: `/procurement/goods-receipts/${gr.id}`,
    statusLabel: label,
    statusVariant: variant,
    icon: PackageCheck,
  };
}

function fromInvoice(inv: Invoice): ActivityItem {
  const { label, variant } = invoiceStatusUI(inv.status);
  return {
    kind: 'INVOICE',
    id: inv.id,
    ref: inv.invoiceNumber,
    subtitle: `Facture · ${inv.currency} ${inv.totalTtc}`,
    date: inv.createdAt,
    href: `/accounting/invoices/${inv.id}`,
    statusLabel: label,
    statusVariant: variant,
    icon: FileText,
  };
}

function fromPaymentRun(run: PaymentRun): ActivityItem {
  const { label, variant } = paymentRunStatusUI(run.status);
  return {
    kind: 'PAYMENT_RUN',
    id: run.id,
    ref: run.runNumber,
    subtitle: `Run paiements · ${run.currency} ${run.totalAmount}`,
    date: run.executedAt ?? run.approvedAt ?? run.createdAt,
    href: `/treasury/payment-runs/${run.id}`,
    statusLabel: label,
    statusVariant: variant,
    icon: Wallet,
  };
}

// ---------------------------------------------------------------------
//  Date relative en français (sans i18n lourde)
// ---------------------------------------------------------------------

/**
 * "Il y a 2 minutes", "Il y a 3 heures", "Hier", "Il y a 4 jours", ou
 * date complète au-delà d'une semaine. On évite Intl.RelativeTimeFormat
 * pour rester déterministe côté tests (différences sub-version Node).
 */
function relativeFr(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = now.getTime() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return 'à l’instant';
  const min = Math.round(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `il y a ${hr} h`;
  const day = Math.round(hr / 24);
  if (day === 1) return 'hier';
  if (day < 7) return `il y a ${day} jours`;
  // Au-delà d'une semaine : date FR DD/MM/YYYY
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

// ---------------------------------------------------------------------
//  Composant principal
// ---------------------------------------------------------------------

/**
 * Section "Activité récente" du dashboard.
 *
 * Aucun endpoint d'audit généralisé n'existe côté backend (cf. note du
 * sprint F-DASHBOARD). On AGRÈGE les listes existantes :
 *   - DA récentes (visibles selon RBAC : un DEMANDEUR ne voit que les
 *     siennes côté backend),
 *   - BC récents (gated canManagePO),
 *   - Réceptions récentes (gated canReceive — magasinier),
 *   - Factures récentes (gated canViewInvoice — large),
 *   - Runs paiement récents (gated canViewPaymentRun — trésorerie/DAF).
 *
 * Chaque liste retourne ≤ 5 items, on les mappe vers un format unifié
 * `ActivityItem`, on trie desc par date, on prend les 8 plus récents.
 *
 * Quand un endpoint /audit/events sera disponible côté backend, cette
 * agrégation sera remplacée par un flux unique (TODO).
 */
export function DashboardRecentActivity() {
  const perms = usePermissions();

  // 5 items par flux — on agrège ≤ 25 → on garde les 8 plus récents.
  // pageSize=5 + status undefined = "tout récent" côté backend (le
  // controller a souvent un défaut tri createdAt desc — sinon on trie
  // côté front juste après).
  const prsQuery = useListPRs({ page: 1, pageSize: 5 });
  const posQuery = useListPOs({ page: 1, pageSize: 5 });
  const grsQuery = useListGRs({ page: 1, pageSize: 5 });
  const invoicesQuery = useListInvoices({ page: 1, pageSize: 5 });
  const paymentRunsQuery = useListPaymentRuns({ page: 1, pageSize: 5 });

  // Adaptation : on n'inclut un flux QUE si l'utilisateur a la permission
  // de le voir (le backend filtrerait de toute façon, mais ça évite un
  // 403 toast intempestif sur le dashboard).
  const items: ActivityItem[] = [];

  if (perms.canCreatePR()) {
    items.push(...(prsQuery.data?.data ?? []).map(fromPR));
  }
  if (perms.canManagePO()) {
    items.push(...(posQuery.data?.data ?? []).map(fromPO));
  }
  if (perms.canReceive()) {
    items.push(...(grsQuery.data?.data ?? []).map(fromGR));
  }
  if (perms.canViewInvoice()) {
    items.push(...(invoicesQuery.data?.data ?? []).map(fromInvoice));
  }
  if (perms.canViewPaymentRun()) {
    items.push(...(paymentRunsQuery.data?.data ?? []).map(fromPaymentRun));
  }

  // Tri desc par date + cap à 8
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const top = items.slice(0, 8);

  const isLoading =
    prsQuery.isLoading ||
    posQuery.isLoading ||
    grsQuery.isLoading ||
    invoicesQuery.isLoading ||
    paymentRunsQuery.isLoading;

  if (isLoading && top.length === 0) {
    return (
      <div
        data-testid="dashboard-activity"
        data-state="loading"
        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-6 text-sm text-slate-muted"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement de l&apos;activité récente…
      </div>
    );
  }

  if (top.length === 0) {
    return (
      <div data-testid="dashboard-activity" data-state="empty">
        <EmptyState
          icon={Inbox}
          title="Pas d'activité récente"
          description="Dès qu'une DA, un BC, une facture ou un paiement sera créé, il apparaîtra ici."
        />
      </div>
    );
  }

  return (
    <ul
      data-testid="dashboard-activity"
      data-state="ready"
      data-count={top.length}
      className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white"
    >
      {top.map((it) => {
        const Icon = it.icon;
        return (
          <li key={`${it.kind}-${it.id}`}>
            <Link
              href={it.href}
              data-testid={`activity-item-${it.kind}-${it.id}`}
              data-kind={it.kind}
              className={cn(
                'flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ipd-50/40',
                'focus:outline-none focus:bg-ipd-50/60',
              )}
            >
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ipd-50 text-ipd-darker"
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  <span className="font-semibold text-ipd-darker">{it.ref}</span>
                  <span className="ml-2 text-xs text-slate-muted">{it.subtitle}</span>
                </p>
                <p className="text-xs text-slate-muted">{relativeFr(it.date)}</p>
              </div>
              <Badge variant={it.statusVariant}>{it.statusLabel}</Badge>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// Exports pour les tests RTL
export { fromPR, fromPO, fromGR, fromInvoice, fromPaymentRun, relativeFr };
export type { ActivityItem, ActivityKind };
