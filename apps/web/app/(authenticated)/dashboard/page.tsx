import {
  Calendar,
  ClipboardList,
  Download,
  FileBarChart,
  FilePlus,
  FileText,
  Inbox,
  Receipt,
  Send,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { auth } from '@/lib/auth';
import type { GrantflowRole } from '@/lib/auth';
import { PageHeader } from '@/components/common/PageHeader';
import { KpiCard } from '@/components/common/KpiCard';
import { EmptyState } from '@/components/common/EmptyState';
import { ShortcutCard } from '@/components/common/ShortcutCard';
import { Button } from '@/components/ui/button';

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
 * Sprint F1.1 — refonte dashboard :
 *  1. PageHeader (titre + date du jour + actions disabled)
 *  2. Carte hero "Bonjour {fullName}" + rôles + période active
 *  3. Grille 4 KPIs avec progress bars placeholders
 *  4. Section "Activité récente" → EmptyState (F2 will populate)
 *  5. Section "Raccourcis" → 4 ShortcutCards disabled
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
        actions={
          <>
            <Button variant="outline" size="sm" disabled>
              <Download className="mr-2 h-4 w-4" aria-hidden />
              Exporter
            </Button>
            <Button size="sm" disabled>
              <FilePlus className="mr-2 h-4 w-4" aria-hidden />
              Nouvelle DA
            </Button>
          </>
        }
      />

      <div className="p-8 space-y-8">
        {/* ====================== Hero ====================== */}
        <section
          aria-labelledby="hero-heading"
          className="relative overflow-hidden rounded-xl bg-gradient-to-r from-pasteur to-pasteur-dark text-white shadow-sm"
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="DA en attente"
              value="—"
              hint="Aucune en cours"
              icon={ClipboardList}
              accent="ipd"
            />
            <KpiCard
              label="Factures à matcher"
              value="—"
              hint="Aucune en attente"
              icon={FileText}
              accent="navy"
            />
            <KpiCard
              label="Budget consommé"
              value="—%"
              hint="Mois en cours"
              icon={TrendingUp}
              accent="success"
            />
            <KpiCard
              label="Paiements ce mois"
              value="—"
              hint="0 XOF traité"
              icon={Wallet}
              accent="warning"
            />
          </div>
        </section>

        {/* ====================== Activité récente ====================== */}
        <section aria-labelledby="activity-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="activity-heading" className="text-lg font-semibold text-slate-text">
              Activité récente
            </h2>
            <Button variant="link" size="sm" disabled className="text-ipd-darker">
              Voir tout
            </Button>
          </div>
          <EmptyState
            icon={Inbox}
            title="Pas encore d'activité"
            description="Les actions récentes (DA, BC, factures, paiements) apparaîtront ici une fois le module Achats déployé (sprint F2)."
            actionLabel="Module en construction"
            actionDisabled
          />
        </section>

        {/* ====================== Raccourcis ====================== */}
        <section aria-labelledby="shortcuts-heading" className="space-y-3">
          <h2 id="shortcuts-heading" className="text-lg font-semibold text-slate-text">
            Raccourcis
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ShortcutCard
              icon={FilePlus}
              title="Créer une DA"
              description="Saisir une demande d'achat avec imputation analytique."
            />
            <ShortcutCard
              icon={Receipt}
              title="Suivre factures"
              description="3-way matching et comptabilisation des factures fournisseurs."
            />
            <ShortcutCard
              icon={Send}
              title="Lancer un paiement"
              description="PaymentRun + export SEPA pain.001 multi-bénéficiaires."
            />
            <ShortcutCard
              icon={FileBarChart}
              title="Rapport bailleur"
              description="USAID FFR-425, OMS, Wellcome — PDF + Excel."
            />
          </div>
        </section>
      </div>
    </>
  );
}
