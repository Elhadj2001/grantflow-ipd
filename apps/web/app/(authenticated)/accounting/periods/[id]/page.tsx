'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  Lock,
  PiggyBank,
  PlayCircle,
  Receipt,
  RotateCcw,
  ScrollText,
  Unlock,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ClosePeriodDialog } from '@/components/accounting/ClosePeriodDialog';
import { PrecheckFindings } from '@/components/accounting/PrecheckFindings';
import { PrepaymentsForm } from '@/components/accounting/PrepaymentsForm';
import { formatAmount } from '@/lib/api/pilotage';
import { ApiError } from '@/lib/api-client';
import { usePermissions } from '@/hooks/use-permissions';
import {
  usePeriodChecks,
  usePeriodEvents,
  usePeriods,
  usePrecheckPeriod,
  useRunAccruals,
  useRunDedicatedFunds,
  useRunPrepayments,
  useClosePeriod,
  useReopenPeriod,
} from '@/hooks/use-accounting';
import type {
  AccrualsRunResult,
  ClosePeriodInput,
  DedicatedFundsRunResult,
  PrepaymentsRunResult,
  RunPrepaymentsInput,
} from '@/lib/api/accounting';

/**
 * Détail d'une période fiscale — orchestration complète clôture.
 *
 * Sections :
 *   1. Header (code, période, statut, actions globales close/reopen)
 *   2. Pré-clôture : bouton Lancer precheck + findings
 *   3. Régularisations : FNP / CCA-PCA / Fonds dédiés (3 cards)
 *   4. Historique des events
 *
 * Gating par usePermissions — chaque action vérifie son rôle avant
 * d'être proposée. Backend reste autoritaire (Roles guard).
 */
export default function PeriodDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const periodId = params.id;
  const perms = usePermissions();

  // Data
  const periodsQuery = usePeriods();
  const period = periodsQuery.data?.find((p) => p.id === periodId) ?? null;
  const checksQuery = usePeriodChecks(periodId);
  const eventsQuery = usePeriodEvents(periodId);

  // Mutations
  const precheckM = usePrecheckPeriod(periodId);
  const accrualsM = useRunAccruals(periodId);
  const dedicatedFundsM = useRunDedicatedFunds(periodId);
  const prepaymentsM = useRunPrepayments(periodId);
  const closeM = useClosePeriod(periodId);
  const reopenM = useReopenPeriod(periodId);

  // UI state
  const [precheckResult, setPrecheckResult] = useState<typeof precheckM.data>(undefined);
  const [accrualsResult, setAccrualsResult] = useState<AccrualsRunResult | null>(null);
  const [fundsResult, setFundsResult] = useState<DedicatedFundsRunResult | null>(null);
  const [prepaymentsResult, setPrepaymentsResult] = useState<PrepaymentsRunResult | null>(null);
  const [showPrepayments, setShowPrepayments] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [prepaymentsError, setPrepaymentsError] = useState<string | null>(null);

  const blockingCount = precheckResult?.blockingCount ?? 0;
  const persistedFindings = useMemo(
    () =>
      (checksQuery.data ?? []).map((c) => ({
        code: c.checkCode,
        severity: c.severity,
        message: c.message,
        payload: c.payload,
      })),
    [checksQuery.data],
  );

  // Si le precheck a été lancé pendant la session, on affiche son
  // résultat live ; sinon on retombe sur les findings persistés (cas
  // où l'utilisateur revient sur la page).
  const findingsToShow = precheckResult?.findings ?? persistedFindings;

  if (periodsQuery.isLoading) {
    return <div className="px-8 py-6 text-sm text-slate-muted">Chargement…</div>;
  }
  if (!period) {
    return (
      <div className="px-8 py-6">
        <p className="text-sm text-state-error">Période introuvable.</p>
        <Button asChild variant="outline" className="mt-3">
          <Link href="/accounting/periods">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Retour
          </Link>
        </Button>
      </div>
    );
  }

  const isClosed = period.isClosed;
  const periodLocked = isClosed; // alias sémantique

  const handlePrecheck = async () => {
    try {
      const r = await precheckM.mutateAsync();
      setPrecheckResult(r);
    } catch (e) {
      // Toast déjà émis par mapApiErrorToToast côté hook (non implémenté ici).
      console.error('precheck failed', e);
    }
  };

  const handleAccruals = async () => {
    try {
      const r = await accrualsM.mutateAsync();
      setAccrualsResult(r);
    } catch (e) {
      console.error('accruals failed', e);
    }
  };

  const handleDedicatedFunds = async () => {
    try {
      const r = await dedicatedFundsM.mutateAsync();
      setFundsResult(r);
    } catch (e) {
      console.error('dedicated funds failed', e);
    }
  };

  const handlePrepayments = async (input: RunPrepaymentsInput) => {
    setPrepaymentsError(null);
    try {
      const r = await prepaymentsM.mutateAsync(input);
      setPrepaymentsResult(r);
      setShowPrepayments(false);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setPrepaymentsError(`Erreur ${e.status} — ${e.body.message ?? 'cas métier'}`);
      } else if (e instanceof Error) {
        setPrepaymentsError(e.message);
      }
    }
  };

  const handleClose = async (input: ClosePeriodInput) => {
    setCloseError(null);
    try {
      await closeM.mutateAsync(input);
      setCloseOpen(false);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setCloseError(`Erreur ${e.status} — ${e.body.message ?? 'cas métier'}`);
      } else if (e instanceof Error) {
        setCloseError(e.message);
      }
    }
  };

  const handleReopen = async () => {
    setReopenError(null);
    if (reopenReason.trim().length < 5) {
      setReopenError('Motif obligatoire (min 5 caractères).');
      return;
    }
    try {
      await reopenM.mutateAsync({ reason: reopenReason.trim() });
      setReopenOpen(false);
      setReopenReason('');
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setReopenError(`Erreur ${e.status} — ${e.body.message ?? 'cas métier'}`);
      } else if (e instanceof Error) {
        setReopenError(e.message);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link
              href="/accounting/periods"
              className="text-slate-muted transition hover:text-ipd-darker"
              aria-label="Retour à la liste"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <CalendarRange className="h-5 w-5" />
            <span>{period.code}</span>
            {isClosed ? (
              <Badge variant="muted" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Close
              </Badge>
            ) : (
              <Badge variant="success" className="gap-1">
                <Unlock className="h-3 w-3" />
                Ouverte
              </Badge>
            )}
          </span>
        }
        subtitle={`${period.periodType} · ${period.startDate} → ${period.endDate}`}
        actions={
          <div className="flex items-center gap-2">
            {!isClosed && perms.canClosePeriod() && (
              <Button
                onClick={() => setCloseOpen(true)}
                data-testid="open-close-dialog"
                size="sm"
              >
                <Lock className="mr-1 h-4 w-4" />
                Clôturer
              </Button>
            )}
            {isClosed && perms.canReopenPeriod() && (
              <Button
                onClick={() => setReopenOpen(true)}
                variant="outline"
                size="sm"
                data-testid="open-reopen-dialog"
              >
                <RotateCcw className="mr-1 h-4 w-4" />
                Ré-ouvrir
              </Button>
            )}
          </div>
        }
      />

      <div className="px-8 py-6 space-y-6">
        {/* Section Précheck */}
        <section data-testid="section-precheck">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PlayCircle className="h-4 w-4 text-ipd-darker" />
                  Pré-clôture
                </CardTitle>
                {perms.canRunPrecheck() && !isClosed && (
                  <Button
                    onClick={handlePrecheck}
                    disabled={precheckM.isPending}
                    size="sm"
                    data-testid="run-precheck"
                  >
                    {precheckM.isPending ? 'Précheck…' : 'Lancer le précheck'}
                  </Button>
                )}
              </div>
              {precheckResult && (
                <p className="text-xs text-slate-muted">
                  Dernier run : {precheckResult.blockingCount} bloquant{precheckResult.blockingCount > 1 ? 's' : ''},{' '}
                  {precheckResult.warningCount} avertissement{precheckResult.warningCount > 1 ? 's' : ''}.{' '}
                  {precheckResult.canClose ? 'Période prête à clôturer.' : 'Findings à résoudre.'}
                </p>
              )}
            </CardHeader>
            <CardContent>
              <PrecheckFindings
                findings={findingsToShow}
                loading={precheckM.isPending}
              />
            </CardContent>
          </Card>
        </section>

        {/* Section Régularisations */}
        {!isClosed && (
          <section data-testid="section-regularisations" className="space-y-3">
            <h2 className="text-lg font-semibold text-ipd-darker">Régularisations</h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {/* FNP */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Receipt className="h-4 w-4" />
                    FNP — Factures Non Parvenues
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-slate-muted">
                    Constate la charge des réceptions complètes non facturées (Débit charge /
                    Crédit 408) + extourne à l&apos;ouverture suivante.
                  </p>
                  {perms.canRunAccruals() && (
                    <Button
                      onClick={handleAccruals}
                      disabled={accrualsM.isPending}
                      size="sm"
                      variant="outline"
                      data-testid="run-accruals"
                    >
                      {accrualsM.isPending ? 'Passage…' : 'Passer les FNP'}
                    </Button>
                  )}
                  {accrualsResult && (
                    <p
                      data-testid="accruals-result"
                      className="rounded-md bg-state-success/5 px-2 py-1 text-xs text-state-success"
                    >
                      ✓ {accrualsResult.processed} FNP / {accrualsResult.skipped} skip ·{' '}
                      {formatAmount(accrualsResult.totalAccrued, accrualsResult.currency)}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* CCA/PCA */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ScrollText className="h-4 w-4" />
                    CCA / PCA
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-slate-muted">
                    Saisie explicite des charges (476) / produits (477) constatés
                    d&apos;avance + extourne automatique.
                  </p>
                  {perms.canRunPrepayments() && (
                    <Button
                      onClick={() => setShowPrepayments((s) => !s)}
                      size="sm"
                      variant="outline"
                      data-testid="toggle-prepayments"
                    >
                      {showPrepayments ? 'Masquer le formulaire' : 'Saisir les régularisations'}
                    </Button>
                  )}
                  {prepaymentsResult && (
                    <p
                      data-testid="prepayments-result"
                      className="rounded-md bg-state-success/5 px-2 py-1 text-xs text-state-success"
                    >
                      ✓ {prepaymentsResult.processed} régularisations · CCA{' '}
                      {formatAmount(prepaymentsResult.totalCca)} · PCA{' '}
                      {formatAmount(prepaymentsResult.totalPca)}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Fonds dédiés */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <PiggyBank className="h-4 w-4" />
                    Fonds dédiés (689 / 789)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-slate-muted">
                    Pour chaque grant : dotation 689/19 si ressources &gt; dépenses, reprise
                    19/789 sinon. Idempotent.
                  </p>
                  {perms.canRunDedicatedFunds() && (
                    <Button
                      onClick={handleDedicatedFunds}
                      disabled={dedicatedFundsM.isPending}
                      size="sm"
                      variant="outline"
                      data-testid="run-dedicated-funds"
                    >
                      {dedicatedFundsM.isPending ? 'Calcul…' : 'Calculer les fonds dédiés'}
                    </Button>
                  )}
                  {fundsResult && (
                    <p
                      data-testid="funds-result"
                      className="rounded-md bg-state-success/5 px-2 py-1 text-xs text-state-success"
                    >
                      ✓ {fundsResult.grants.length} grants · dotation{' '}
                      {formatAmount(fundsResult.totalDotation)} · reprise{' '}
                      {formatAmount(fundsResult.totalReprise)}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {showPrepayments && perms.canRunPrepayments() && (
              <Card data-testid="prepayments-form-card">
                <CardHeader>
                  <CardTitle className="text-base">Saisie groupée CCA/PCA</CardTitle>
                </CardHeader>
                <CardContent>
                  <PrepaymentsForm
                    loading={prepaymentsM.isPending}
                    errorMessage={prepaymentsError}
                    onSubmit={handlePrepayments}
                    onCancel={() => setShowPrepayments(false)}
                  />
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {periodLocked && (
          <div
            data-testid="closed-banner"
            className="rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700"
          >
            <AlertCircle className="mr-1 inline h-4 w-4" />
            Période close — aucune écriture ne peut être posted. Re-ouverture réservée DAF
            avec motif.
          </div>
        )}

        {/* Historique events */}
        <section data-testid="section-events">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Historique audit</CardTitle>
            </CardHeader>
            <CardContent>
              {eventsQuery.isLoading && (
                <p className="text-sm text-slate-muted">Chargement…</p>
              )}
              {eventsQuery.data && eventsQuery.data.length === 0 && (
                <p className="text-sm text-slate-muted">Aucun événement.</p>
              )}
              {eventsQuery.data && eventsQuery.data.length > 0 && (
                <ul className="space-y-2 text-sm">
                  {eventsQuery.data.map((e) => (
                    <li
                      key={e.id}
                      data-testid={`event-${e.action}`}
                      className="rounded-md border border-slate-100 bg-white px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-ipd-darker">{e.action}</span>
                        <span className="text-xs text-slate-muted">
                          {new Date(e.occurredAt).toLocaleString('fr-FR')}
                        </span>
                      </div>
                      {e.user && (
                        <p className="text-xs text-slate-muted">
                          {e.user.fullName ?? e.user.email}
                        </p>
                      )}
                      {e.reason && (
                        <p className="mt-1 text-xs italic text-slate-700">{e.reason}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      <ClosePeriodDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        blockingCount={blockingCount}
        canOverride={perms.canOverrideBlockingClose()}
        loading={closeM.isPending}
        errorMessage={closeError}
        onConfirm={handleClose}
      />

      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent data-testid="reopen-dialog">
          <DialogHeader>
            <DialogTitle>Ré-ouvrir la période</DialogTitle>
            <DialogDescription>
              Opération exceptionnelle réservée au DAF. Le motif sera journalisé.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-slate-muted">
              Motif (≥ 5 caractères)
            </Label>
            <Input
              data-testid="reopen-reason"
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Ex. Correction erreur facture #123"
            />
          </div>
          {reopenError && (
            <p
              data-testid="reopen-error"
              className="rounded-md border border-state-error/30 bg-state-error/5 px-3 py-2 text-sm text-state-error"
            >
              {reopenError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={handleReopen}
              disabled={reopenM.isPending || reopenReason.trim().length < 5}
              data-testid="reopen-confirm"
            >
              <RotateCcw className="mr-1 h-4 w-4" />
              {reopenM.isPending ? 'Ré-ouverture…' : 'Ré-ouvrir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Navigation rapide après une page d'accueil errante */}
      <button hidden onClick={() => router.refresh()} />
    </div>
  );
}
