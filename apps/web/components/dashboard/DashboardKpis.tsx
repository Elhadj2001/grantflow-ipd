'use client';

import { ClipboardList, FileText, FolderOpen, Wallet } from 'lucide-react';
import { KpiCard } from '@/components/common/KpiCard';
import { useListInvoices } from '@/hooks/use-invoicing';
import { useListPRs } from '@/hooks/use-procurement';
import { useListPaymentRuns } from '@/hooks/use-treasury';
import { usePermissions } from '@/hooks/use-permissions';
import { useGrantsList } from '@/hooks/use-referential';
import type { PrStatus } from '@/lib/api/procurement';

/**
 * Liste des statuts considérés comme "en attente d'approbation" pour le KPI
 * "DA en circuit d'approbation".
 *
 * Sprint F-DASHBOARD (fix KPI) : le KPI ne pouvait pas se limiter à
 * `submitted` car le workflow réel fait passer la DA par plusieurs étapes
 * (PI → CG → DAF → Caissier). Une DA fraîchement soumise est immédiatement
 * routée vers `pending_pi`, donc filtrer sur `submitted` retournait quasiment
 * toujours 0. On agrège désormais l'ensemble des statuts intermédiaires.
 *
 * Note : l'API `listPurchaseRequests` n'accepte qu'un `status` unique
 * (`ListPrQuery.status?: PrStatus`). On fait donc N appels parallèles via
 * `useListPRs` (TanStack met chaque combo en cache séparément, donc pas de
 * surcoût en navigation) et on somme les `.total`.
 */
const PENDING_PR_STATUSES = [
  'submitted',
  'pending_pi',
  'pending_cg',
  'pending_daf',
  'pending_caissier',
] as const satisfies readonly PrStatus[];

/**
 * Grille des 4 KPIs du dashboard.
 *
 * Sprint F-DASHBOARD — sources réelles via TanStack Query :
 *   - DA en circuit d'approbation : Σ listPurchaseRequests({status}).total
 *     pour status ∈ PENDING_PR_STATUSES (cf. constante au-dessus).
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
  // Sprint F-RBAC-LISTES : `enabled` gates le fetch côté front pour éviter
  // un 403 toast intempestif sur les rôles non autorisés par les @Roles
  // backend (helpers canList* alignés exactement sur les endpoints).
  // useListPRs reste sans gating front (le backend a déjà un filtre
  // per-rôle ouvert à tous).
  //
  // Fix KPI "DA en attente" : on lance une query par statut d'attente et on
  // somme les totaux. Les hooks sont appelés statiquement (un par index du
  // tuple PENDING_PR_STATUSES) pour respecter les Rules of Hooks — la
  // constante est figée et déclarée `as const`, l'ordre est donc stable.
  const prsSubmittedQuery = useListPRs(
    { status: 'submitted', page: 1, pageSize: 1 },
    { enabled: !isBailleurOnly },
  );
  const prsPendingPiQuery = useListPRs(
    { status: 'pending_pi', page: 1, pageSize: 1 },
    { enabled: !isBailleurOnly },
  );
  const prsPendingCgQuery = useListPRs(
    { status: 'pending_cg', page: 1, pageSize: 1 },
    { enabled: !isBailleurOnly },
  );
  const prsPendingDafQuery = useListPRs(
    { status: 'pending_daf', page: 1, pageSize: 1 },
    { enabled: !isBailleurOnly },
  );
  const prsPendingCaissierQuery = useListPRs(
    { status: 'pending_caissier', page: 1, pageSize: 1 },
    { enabled: !isBailleurOnly },
  );

  const prsPendingQueries = [
    prsSubmittedQuery,
    prsPendingPiQuery,
    prsPendingCgQuery,
    prsPendingDafQuery,
    prsPendingCaissierQuery,
  ];

  // Loading = tant qu'une query est en cours. Total = somme des totaux
  // résolus (les undefined comptent pour 0 — l'affichage final retombe sur
  // "—" si aucune query n'a abouti, grâce au check `prsAllResolved`).
  const prsPendingIsLoading = prsPendingQueries.some((q) => q.isLoading);
  const prsAllResolved = prsPendingQueries.every((q) => q.data !== undefined);
  const prsPendingTotal = prsAllResolved
    ? prsPendingQueries.reduce((sum, q) => sum + (q.data?.total ?? 0), 0)
    : undefined;
  const invoicesQuery = useListInvoices(
    { status: 'captured', page: 1, pageSize: 1 },
    { enabled: perms.canListInvoices() && !isBailleurOnly },
  );
  const grantsQuery = useGrantsList({ status: 'active', pageSize: 1 });
  const paymentsQuery = useListPaymentRuns(
    { status: 'executed', fromDate, page: 1, pageSize: 1 },
    { enabled: perms.canListPaymentRuns() && !isBailleurOnly },
  );

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
          value={fmt(prsPendingTotal)}
          hint={
            prsPendingIsLoading
              ? 'Chargement…'
              : prsPendingTotal !== undefined
                ? `${prsPendingTotal} demande${prsPendingTotal > 1 ? 's' : ''} en attente d'approbation`
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
