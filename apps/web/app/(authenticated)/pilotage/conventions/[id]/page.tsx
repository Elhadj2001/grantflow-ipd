'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/PageHeader';
import { GrantHeader } from '@/components/pilotage/GrantHeader';
import { BudgetVarianceTable } from '@/components/pilotage/BudgetVarianceTable';
import { GrantTimeline } from '@/components/pilotage/GrantTimeline';
import { AnalyticalDonut } from '@/components/pilotage/AnalyticalDonut';
import { DedicatedFundsCard } from '@/components/pilotage/DedicatedFundsCard';
import { OverheadCard } from '@/components/pilotage/OverheadCard';
import type { GrantBadgeStatus } from '@/components/pilotage/GrantStatusBadge';
import { useBudgetLinesList, useGrant, useGrantDashboard } from '@/hooks/use-referential';
import {
  useGrantBreakdown,
  useGrantDedicatedFunds,
  useGrantOverhead,
  useGrantTransactions,
} from '@/hooks/use-pilotage';
import { usePermissions } from '@/hooks/use-permissions';
import { formatAmount } from '@/lib/api/pilotage';
import { BudgetLineEditor } from '@/components/referential/BudgetLineEditor';

const PERIOD_PRESETS = [
  { value: '3m', label: '3 mois' },
  { value: '6m', label: '6 mois' },
  { value: '12m', label: '12 mois' },
  { value: 'all', label: 'Tout' },
] as const;
type PeriodPreset = (typeof PERIOD_PRESETS)[number]['value'];

function periodToDates(p: PeriodPreset): { fromDate?: string; toDate?: string } {
  if (p === 'all') return {};
  const months = p === '3m' ? 3 : p === '6m' ? 6 : 12;
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  };
}

/**
 * Détail Convention — vue CG + PI (sur SON grant).
 *
 * Sections :
 *   1. Header sticky (référence, projet, période, montant, status)
 *   2. Lignes budgétaires (BudgetVarianceTable + Donut compte SYSCEBNL)
 *   3. Transactions (Timeline filtrable par période)
 *   4. Analytique (3 ventilations : cost_center, activité, mensuel)
 *   5. Overhead (OverheadCard)
 *   6. Fonds dédiés (DedicatedFundsCard)
 *
 * Cross-PI safety : sécurité serveur via `assertCanViewGrant` — un PI
 * non-owner recevra un 403 sur le détail et les sous-ressources.
 */
export default function GrantDetailPage() {
  const params = useParams<{ id: string }>();
  const grantId = params.id;
  const perms = usePermissions();
  const [period, setPeriod] = useState<PeriodPreset>('6m');
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);

  const periodRange = periodToDates(period);

  const { data: dashboard, isLoading: loadingDash } = useGrantDashboard(grantId);
  // Fix convention-currency-display : la devise vient du grant lui-même
  // (le dashboard ne l'expose pas). Fallback XOF pour le rendu pendant le
  // chargement initial — le hook se met à jour dès que la réponse arrive.
  const { data: grant } = useGrant(grantId);
  const currency = grant?.currency ?? 'XOF';
  const { data: txData, isLoading: loadingTx } = useGrantTransactions(grantId, {
    type: 'all',
    ...periodRange,
    ...(selectedAccount ? { accountCode: selectedAccount } : {}),
  });
  const { data: breakdownAccount } = useGrantBreakdown(grantId, {
    by: 'account',
    ...periodRange,
  });
  const { data: breakdownCC } = useGrantBreakdown(grantId, {
    by: 'cost_center',
    ...periodRange,
  });
  const { data: breakdownPeriod } = useGrantBreakdown(grantId, {
    by: 'period',
    ...periodRange,
  });
  const { data: funds } = useGrantDedicatedFunds(grantId);
  // Sprint F5b-c Lot C : chargement séparé des lignes budgétaires en
  // mode "édition" (avec defaultAccount + isOverheadEligible). La
  // BudgetVarianceTable du dashboard reste pour la lecture (consommation).
  // Le hook n'est activé que si le caller a le rôle CG/DAF/SA.
  const canEditBudgetLines = perms.canManageBudgetLines();
  const { data: budgetLinesData } = useBudgetLinesList(
    canEditBudgetLines ? grantId : null,
  );
  const { data: overhead } = useGrantOverhead(grantId);

  if (loadingDash) {
    return (
      <div className="px-8 py-6 text-sm text-slate-muted">Chargement du tableau de bord…</div>
    );
  }
  if (!dashboard) {
    return (
      <div className="px-8 py-6">
        <p className="text-sm text-state-error">Convention introuvable ou accès refusé.</p>
        <Button asChild variant="outline" className="mt-3">
          <Link href="/pilotage/conventions">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Retour au portefeuille
          </Link>
        </Button>
      </div>
    );
  }

  const badgeStatus: GrantBadgeStatus = 'active';

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link
              href="/pilotage/conventions"
              className="text-slate-muted transition hover:text-ipd-darker"
              aria-label="Retour au portefeuille"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span>{dashboard.grantRef}</span>
          </span>
        }
        subtitle={`Tableau de bord temps réel · ${dashboard.byBudgetLine.length} lignes budgétaires`}
        actions={
          perms.canParameterGrant() && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/pilotage/conventions/${grantId}/edit`}>
                <Pencil className="mr-1 h-4 w-4" />
                Paramétrer
              </Link>
            </Button>
          )
        }
      />

      <div className="px-8 py-6 space-y-6">
        <GrantHeader
          reference={dashboard.grantRef}
          donorLabel="Bailleur"
          projectTitle={`Convention ${dashboard.grantRef}`}
          amount={dashboard.totalBudgeted}
          currency={currency}
          startDate="—"
          endDate="—"
          status={badgeStatus}
          overheadRate={overhead?.grantOverheadRate ?? 0}
        />

        {dashboard.alerts.length > 0 && (
          <ul
            data-testid="grant-alerts"
            className="rounded-md border border-state-warning/30 bg-state-warning/5 px-4 py-3 text-sm text-state-warning"
          >
            {dashboard.alerts.map((a) => (
              <li key={a}>⚠ {a}</li>
            ))}
          </ul>
        )}

        {/* Section Lignes budgétaires — lecture (consommation/engagé) */}
        <section data-testid="section-budget-lines" className="space-y-3">
          <h2 className="text-lg font-semibold text-ipd-darker">Lignes budgétaires</h2>
          <BudgetVarianceTable
            rows={dashboard.byBudgetLine.map((bl) => ({
              budgetLineId: bl.budgetLineId,
              code: bl.code,
              label: bl.label,
              budgeted: bl.budgeted,
              consumed: bl.consumed,
              engaged: bl.engaged,
              available: bl.available,
              utilization: bl.utilization,
            }))}
            currency={currency}
          />

          {/* Sprint F5b-c Lot C : section ÉDITABLE pour CG/DAF/SA. */}
          {canEditBudgetLines && budgetLinesData && (
            <BudgetLineEditor
              grantId={grantId}
              lines={budgetLinesData.data}
              grantAmount={dashboard.totalBudgeted}
            />
          )}
        </section>

        {/* Section Analytique — 3 donuts */}
        <section data-testid="section-analytics" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ipd-darker">Analytique</h2>
            <div className="flex gap-1">
              {PERIOD_PRESETS.map((p) => (
                <Button
                  key={p.value}
                  size="sm"
                  data-testid={`period-${p.value}`}
                  variant={period === p.value ? 'default' : 'outline'}
                  onClick={() => setPeriod(p.value)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AnalyticalDonut
              title="Ventilation par compte SYSCEBNL"
              entries={breakdownAccount?.entries ?? []}
              onSelect={(key) => setSelectedAccount(key)}
            />
            <AnalyticalDonut
              title="Ventilation par centre de coût"
              entries={breakdownCC?.entries ?? []}
            />
          </div>

          {breakdownPeriod && breakdownPeriod.entries.length > 0 && (
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">
                Évolution mensuelle des dépenses
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={breakdownPeriod.entries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="key" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number) => formatAmount(value, currency)}
                      cursor={{ fill: 'rgba(43, 160, 184, 0.08)' }}
                    />
                    <Bar dataKey="amount" fill="#0089D0" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </section>

        {/* Section Overhead + Fonds dédiés */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {overhead && <OverheadCard data={overhead} />}
          {funds && <DedicatedFundsCard data={funds} />}
        </section>

        {/* Section Transactions */}
        <section data-testid="section-transactions" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ipd-darker">
              Transactions{' '}
              {txData && (
                <span className="text-sm font-normal text-slate-muted">({txData.total})</span>
              )}
            </h2>
            {selectedAccount && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedAccount(null)}
                data-testid="clear-account-filter"
              >
                Effacer le filtre compte {selectedAccount}
              </Button>
            )}
          </div>
          {loadingTx ? (
            <p className="text-sm text-slate-muted">Chargement des transactions…</p>
          ) : (
            <GrantTimeline transactions={txData?.data ?? []} />
          )}
        </section>
      </div>
    </div>
  );
}
