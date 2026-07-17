import { Calendar } from 'lucide-react';
import { auth } from '@/lib/auth';
import type { GrantflowRole } from '@/lib/auth';
import { PageHeader } from '@/components/common/PageHeader';
import { DashboardHeaderActions } from '@/components/dashboard/DashboardHeaderActions';
import { DashboardKpis } from '@/components/dashboard/DashboardKpis';
import { DashboardRecentActivity } from '@/components/dashboard/DashboardRecentActivity';
import { DashboardShortcuts } from '@/components/dashboard/DashboardShortcuts';

const ROLE_LABELS_FR: Record<GrantflowRole, string> = {
  SUPER_ADMIN: 'Administrateur',
  DAF: 'Directeur Administratif & Financier',
  CONTROLEUR: 'Contrôleur de gestion',
  COMPTABLE: 'Comptable',
  TRESORIER: 'Trésorier',
  ACHETEUR: 'Acheteur',
  MAGASINIER: 'Magasinier',
  PI: 'Principal Investigator',
  DEMANDEUR: 'Demandeur',
  BAILLEUR: 'Bailleur / Auditeur',
  CAISSIER: 'Caissier',
  GO: 'Grant Office',
};

function formatRolesFr(roles: GrantflowRole[]): string {
  if (roles.length === 0) return 'Aucun rôle attribué';
  return roles.map((r) => ROLE_LABELS_FR[r]).join(' · ');
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('') || 'U'
  );
}

/**
 * Dashboard (Sprint F-DASHBOARD — branche les vraies données) :
 *  1. PageHeader (titre + date du jour). "Exporter" retiré (pas de cible
 *     globale claire). "Nouvelle DA" actif si canCreatePR (composant client).
 *  2. Carte hero "Bonjour {fullName}" + rôles + période active.
 *  3. Grille 4 KPIs câblés sur les endpoints réels (DashboardKpis client).
 *     BAILLEUR pur n'a que "Conventions actives".
 *  4. Section "Activité récente" : agrégation côté front des listes DA /
 *     BC / réceptions / factures / paiements (DashboardRecentActivity).
 *     Filtrée par RBAC (perm helpers). À remplacer par un flux d'audit
 *     unique quand /audit/events sera dispo côté backend.
 *  5. Section "Raccourcis" : 4 ShortcutCards cliquables (gating par rôle).
 *
 * La page reste un Server Component (auth lue avec `auth()`) — seules les
 * sous-sections data-bound sont des Client Components.
 */
export default async function DashboardPage() {
  const session = await auth();
  const fullName = session?.fullName ?? session?.user?.email ?? 'Utilisateur';
  const roles = session?.roles ?? [];

  const todayFmt = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  const monthFmt = new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date());
  const periodLabel = monthFmt.charAt(0).toUpperCase() + monthFmt.slice(1);

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" aria-hidden />
            {todayFmt.charAt(0).toUpperCase() + todayFmt.slice(1)}
          </span>
        }
        actions={<DashboardHeaderActions />}
      />

      <div className="p-8 space-y-8">
        {/* ====================== Hero ====================== */}
        <section
          aria-labelledby="hero-heading"
          className="relative overflow-hidden rounded-xl bg-gradient-to-r from-ipd-dark to-navy text-white shadow-sm"
        >
          <div className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <span
                aria-hidden
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-ipd-darker text-lg font-bold shadow-lg ring-4 ring-white/10"
              >
                {initialsOf(fullName)}
              </span>
              <div>
                <h2 id="hero-heading" className="text-2xl font-bold leading-tight">
                  Bonjour {fullName}
                </h2>
                <p className="mt-1 text-sm text-ipd-100">
                  {formatRolesFr(roles)} — IPD Finance
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 self-start rounded-full bg-white/20 px-3 py-1 text-xs font-medium md:self-auto">
              <Calendar className="h-3.5 w-3.5" aria-hidden />
              Période : {periodLabel}
            </span>
          </div>
        </section>

        {/* ====================== 4 KPIs ====================== */}
        <section aria-labelledby="kpis-heading">
          <h2 id="kpis-heading" className="sr-only">
            Indicateurs clés
          </h2>
          <DashboardKpis />
        </section>

        {/* ====================== Activité récente ====================== */}
        <section aria-labelledby="activity-heading" className="space-y-3">
          <h2 id="activity-heading" className="text-lg font-semibold text-slate-text">
            Activité récente
          </h2>
          {/*
           * Faute d'endpoint d'audit/activité généralisé côté backend,
           * la section agrège les listes existantes (DA / BC / réceptions
           * / factures / paiements) côté front, filtrées par RBAC. Cf.
           * DashboardRecentActivity pour le détail.
           */}
          <DashboardRecentActivity />
        </section>

        {/* ====================== Raccourcis ====================== */}
        <section aria-labelledby="shortcuts-heading" className="space-y-3">
          <h2 id="shortcuts-heading" className="text-lg font-semibold text-slate-text">
            Raccourcis
          </h2>
          <DashboardShortcuts />
        </section>
      </div>
    </>
  );
}
