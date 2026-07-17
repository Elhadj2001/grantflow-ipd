'use client';

import { ClipboardList, FileText, FolderOpen, Wallet } from 'lucide-react';
import { KpiCard } from '@/components/common/KpiCard';
import { useDashboardSummary } from '@/hooks/use-dashboard';
import { usePermissions } from '@/hooks/use-permissions';

/**
 * Grille des 4 KPIs du dashboard.
 *
 * US-066 (Sprint S7) : les compteurs viennent désormais d'UNE requête
 * `GET /dashboard/summary` (staleTime 30 s) au lieu du fan-out historique
 * (5 listes DA mono-statut à pageSize=1 + factures + conventions +
 * paiements = 8 requêtes rien que pour cette grille).
 *
 * Adaptation rôle :
 *   - le serveur scope les DA (rôles non full-view → leurs propres DA,
 *     `prPending.scopedToOwn=true`) et renvoie `null` pour les sections
 *     comptables non autorisées (factures, paiements) → cartes masquées.
 *   - BAILLEUR pur ne voit que "Conventions actives" (comme avant).
 *
 * État de chargement : "—" pendant le fetch, vraie valeur ensuite. Les
 * erreurs restent en "—" — pas de toast intrusif sur le dashboard.
 */
export function DashboardKpis() {
  const perms = usePermissions();
  const isBailleurOnly =
    perms.has('BAILLEUR') &&
    !perms.hasAny('CONTROLEUR', 'DAF', 'COMPTABLE', 'SUPER_ADMIN', 'TRESORIER', 'ACHETEUR');

  const summary = useDashboardSummary();
  const s = summary.data;

  /** Formate un total : `undefined`/`null` (loading/erreur/non autorisé) → "—". */
  const fmt = (n: number | null | undefined): string => (n == null ? '—' : String(n));

  const loadingHint = (n: number | null | undefined, resolved: (v: number) => string): string =>
    summary.isLoading ? 'Chargement…' : n == null ? 'Donnée indisponible' : resolved(n);

  return (
    <div
      data-testid="dashboard-kpis"
      data-bailleur-only={isBailleurOnly ? 'true' : 'false'}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {!isBailleurOnly && (
        <KpiCard
          label="DA en attente"
          value={fmt(s?.prPending.total)}
          hint={loadingHint(
            s?.prPending.total,
            (v) =>
              `${v} demande${v > 1 ? 's' : ''} en attente d'approbation${
                s?.prPending.scopedToOwn ? ' (vos demandes)' : ''
              }`,
          )}
          icon={ClipboardList}
          accent="ipd"
        />
      )}
      {!isBailleurOnly && s?.invoicesToMatch !== null && (
        <KpiCard
          label="Factures à matcher"
          value={fmt(s?.invoicesToMatch)}
          hint={loadingHint(s?.invoicesToMatch, (v) => `${v} en attente de rapprochement`)}
          icon={FileText}
          accent="navy"
        />
      )}
      <KpiCard
        label="Conventions actives"
        value={fmt(s?.activeGrants)}
        hint={loadingHint(
          s?.activeGrants,
          (v) => `${v} convention${v > 1 ? 's' : ''} en cours`,
        )}
        icon={FolderOpen}
        accent="success"
      />
      {!isBailleurOnly && s?.paymentsExecutedThisMonth !== null && (
        <KpiCard
          label="Paiements ce mois"
          value={fmt(s?.paymentsExecutedThisMonth)}
          hint={loadingHint(
            s?.paymentsExecutedThisMonth,
            (v) => `${v} exécuté${v > 1 ? 's' : ''} depuis le 1er`,
          )}
          icon={Wallet}
          accent="warning"
        />
      )}
    </div>
  );
}
