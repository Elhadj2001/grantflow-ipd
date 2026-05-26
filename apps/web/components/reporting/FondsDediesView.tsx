'use client';

import { ArrowDownToLine, ArrowUpFromLine, Coins, GitCommitVertical } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatAmount } from '@/lib/api/pilotage';
import { StatementSectionTable } from './StatementSectionTable';
import type { FinancialStatementDetail } from '@/lib/api/reporting';

export interface FondsDediesViewProps {
  statement: FinancialStatementDetail;
  className?: string;
}

/**
 * Rendu spécifique de l'état FONDS_DEDIES (sprint F5b-a Lot 4).
 *
 * Structure du backend (generateFondsDedies) :
 *   - totals : leftTotal=totalEmployed, rightTotal=totalReceived,
 *     totalRemaining, totalDotation, totalReprise, netMovements, diff
 *   - lines section 'GRANTS' : 1 ligne par grant (debit=employé, credit=reçu, balance=restant)
 *   - lines section 'RAPPROCHEMENT_689_19' : 1 ligne par grant ayant un mouvement
 *     (debit=reprise 789, credit=dotation 689, balance=netMovement)
 *
 * Équilibre logique : totalRemaining ≈ netMovements (±1 XOF). Affiche un
 * bandeau rouge si déséquilibré (balanced=false dans les totals).
 */
export function FondsDediesView({ statement, className }: FondsDediesViewProps) {
  const totals = statement.totals;
  const totalReceived = Number(totals.totalReceived ?? 0);
  const totalEmployed = Number(totals.totalEmployed ?? 0);
  const totalRemaining = Number(totals.totalRemaining ?? 0);
  const totalDotation = Number(totals.totalDotation ?? 0);
  const totalReprise = Number(totals.totalReprise ?? 0);
  const netMovements = Number(totals.netMovements ?? 0);
  const diff = Number(totals.diff ?? 0);
  const balanced = Boolean(totals.balanced);

  return (
    <div data-testid="fonds-dedies-view" className={cn('space-y-6', className)}>
      {/* Cards de synthèse — vue d'ensemble Reçu / Employé / Restant */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryCard
          testId="card-received"
          icon={ArrowDownToLine}
          label="Reçu (75x)"
          value={formatAmount(totalReceived)}
          subtitle="Ressources de la période"
          tone="success"
        />
        <SummaryCard
          testId="card-employed"
          icon={ArrowUpFromLine}
          label="Employé (6x)"
          value={formatAmount(totalEmployed)}
          subtitle="Dépenses imputées"
        />
        <SummaryCard
          testId="card-remaining"
          icon={Coins}
          label="Restant à employer"
          value={formatAmount(totalRemaining)}
          subtitle="Reçu − Employé"
          tone={totalRemaining > 0 ? 'success' : 'neutral'}
        />
      </div>

      {/* Bandeau équilibre vs dotation/reprise */}
      <div
        data-testid="balance-banner"
        data-balanced={balanced ? 'true' : 'false'}
        className={cn(
          'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
          balanced
            ? 'border-state-success/30 bg-state-success/5 text-state-success'
            : 'border-state-error/40 bg-state-error/5 text-state-error',
        )}
      >
        <GitCommitVertical className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">
            {balanced ? '✓ Rapprochement équilibré' : '⚠ Déséquilibre détecté'}
          </p>
          <p className="text-xs">
            Restant à employer : <strong>{formatAmount(totalRemaining)}</strong> · Net dotations
            689 − reprises 789 : <strong>{formatAmount(netMovements)}</strong>{' '}
            {!balanced && (
              <>
                · Écart : <strong>{formatAmount(diff)}</strong>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Section GRANTS — détail par convention */}
      <StatementSectionTable
        lines={statement.lines}
        section="GRANTS"
        sectionLabel="Détail par convention (reçu / employé / restant)"
        showAccountColumn={false}
      />

      {/* Section RAPPROCHEMENT — comparaison vs écritures 689/19 */}
      <StatementSectionTable
        lines={statement.lines}
        section="RAPPROCHEMENT_689_19"
        sectionLabel="Rapprochement avec les écritures 689 (dotation) / 789 (reprise)"
        showAccountColumn={false}
      />

      {/* Footer chiffré totaux 689/789 */}
      <div className="grid grid-cols-2 gap-3">
        <SummaryCard
          testId="card-dotation"
          icon={ArrowDownToLine}
          label="Total dotations 689"
          value={formatAmount(totalDotation)}
          subtitle="Affectation en fonds dédiés"
        />
        <SummaryCard
          testId="card-reprise"
          icon={ArrowUpFromLine}
          label="Total reprises 789"
          value={formatAmount(totalReprise)}
          subtitle="Reprise sur fonds dédiés"
        />
      </div>
    </div>
  );
}

interface SummaryCardProps {
  testId: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subtitle: string;
  tone?: 'success' | 'neutral';
}

function SummaryCard({ testId, icon: Icon, label, value, subtitle, tone }: SummaryCardProps) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-start gap-2">
          <Icon
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0',
              tone === 'success' ? 'text-state-success' : 'text-ipd-darker',
            )}
          />
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wide text-slate-muted">{label}</p>
            <p
              className={cn(
                'text-lg font-bold',
                tone === 'success' ? 'text-state-success' : 'text-ipd-darker',
              )}
            >
              {value}
            </p>
            <p className="text-xs text-slate-muted">{subtitle}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
