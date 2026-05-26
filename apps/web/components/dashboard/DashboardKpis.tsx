'use client';

import { ClipboardList, FileText, FolderOpen, Wallet } from 'lucide-react';
import { KpiCard } from '@/components/common/KpiCard';
import { useListInvoices } from '@/hooks/use-invoicing';
import { useListPRs } from '@/hooks/use-procurement';
import { useListPaymentRuns } from '@/hooks/use-treasury';
import { usePermissions } from '@/hooks/use-permissions';
import { useGrantsList } from '@/hooks/use-referential';

/**
 * Grille des 4 KPIs du dashboard.
 *
 * Sprint F-DASHBOARD — sources réelles via TanStack Query :
 *   - DA en attente       : listPurchaseRequests({ status: 'submitted' }).total
 *   - Factures à matcher  : listInvoices({ status: 'captured' }).total
 *   - Conventions actives : listGrants({ status: 'active' }).total
 *     (remplacement honnête de "Budget consommé %" — aucun endpoint agrégé
 *     multi-grants n'expose un % global ; calculer N+1 dashboards serait
 *     coûteux. Le % par grant reste disponible dans /pilotage/conventions/[id].)
 *   - Paiements ce mois   : listPaymentRuns({ status: 'executed', fromDate }).total
 *
 * Adaptation rôle (visible[…]) :
 *   - BAILLEUR pur n'a accès qu'aux états envoyés → on lui montre seulement
 *     "Conventions actives" (utile pour son audit) et on masque les 3 autres.
 *   - Pour les rôles internes, on affiche les 4 cartes.
 *
 * État de chargement : KpiCard rend un skeleton si `progress` est undefined.
 * Pour cohérence visuelle, on rend "—" pendant le fetch et la vraie valeur
 * une fois résolue. Les erreurs apparaissent en "—" — pas de toast intrusif
 * sur le dashboard.
 */
export function DashboardKpis() {
  const perms = usePermissions();
  const isBailleurOnly =
    perms.has('BAILLEUR') &&
    !perms.hasAny('CONTROLEUR', 'DAF', 'COMPTABLE', 'SUPER_ADMIN', 'TRESORIER', 'ACHETEUR');

  // Premier jour du mois courant pour le filtre des paiements
  const firstOfMonth = new Date();
  firstOfMonth.setUTCDate(1);
  firstOfMonth.setUTCHours(0, 0, 0, 0);
  const fromDate = firstOfMonth.toISOString().slice(0, 10);

  // pageSize=1 : on ne veut que le `total`, pas les items.
  const prsQuery = useListPRs({ status: 'submitted', page: 1, pageSize: 1 });
  const invoicesQuery = useListInvoices({ status: 'captured', page: 1, pageSize: 1 });
  const grantsQuery = useGrantsList({ status: 'active', pageSize: 1 });
  const paymentsQuery = useListPaymentRuns({
    status: 'executed',
    fromDate,
    page: 1,
    pageSize: 1,
  });

  /** Formate un total : `undefined` (loading/error) → "—", sinon nombre. */
  const fmt = (n: number | undefined): string => (n === undefined ? '—' : String(n));

  return (
    <div
      data-testid="dashboard-kpis"
      data-bailleur-only={isBailleurOnly ? 'true' : 'false'}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {!isBailleurOnly && (
        <KpiCard
          label="DA en attente"
          value={fmt(prsQuery.data?.total)}
          hint={
            prsQuery.isLoading
              ? 'Chargement…'
              : prsQuery.data
                ? `${prsQuery.data.total} demande${prsQuery.data.total > 1 ? 's' : ''} soumise${prsQuery.data.total > 1 ? 's' : ''}`
                : 'Donnée indisponible'
          }
          icon={ClipboardList}
          accent="ipd"
        />
      )}
      {!isBailleurOnly && (
        <KpiCard
          label="Factures à matcher"
          value={fmt(invoicesQuery.data?.total)}
          hint={
            invoicesQuery.isLoading
              ? 'Chargement…'
              : invoicesQuery.data
                ? `${invoicesQuery.data.total} en attente de rapprochement`
                : 'Donnée indisponible'
          }
          icon={FileText}
          accent="navy"
        />
      )}
      <KpiCard
        label="Conventions actives"
        value={fmt(grantsQuery.data?.total)}
        hint={
          grantsQuery.isLoading
            ? 'Chargement…'
            : grantsQuery.data
              ? `${grantsQuery.data.total} convention${grantsQuery.data.total > 1 ? 's' : ''} en cours`
              : 'Donnée indisponible'
        }
        icon={FolderOpen}
        accent="success"
      />
      {!isBailleurOnly && (
        <KpiCard
          label="Paiements ce mois"
          value={fmt(paymentsQuery.data?.total)}
          hint={
            paymentsQuery.isLoading
              ? 'Chargement…'
              : paymentsQuery.data
                ? `${paymentsQuery.data.total} exécuté${paymentsQuery.data.total > 1 ? 's' : ''} depuis le 1er`
                : 'Donnée indisponible'
          }
          icon={Wallet}
          accent="warning"
        />
      )}
    </div>
  );
}
