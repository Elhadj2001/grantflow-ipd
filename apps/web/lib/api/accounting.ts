import { apiFetch, type ApiFetchOptions } from '../api-client';

/**
 * Client API typé pour le module Comptabilité — clôture mensuelle &
 * régularisations (sprint F5b-b).
 *
 * Endpoints couverts (base /accounting) :
 *   - GET  /periods                       → liste périodes
 *   - GET  /periods/:id/events            → audit close/reopen
 *   - GET  /periods/:id/checks            → findings du dernier precheck
 *   - POST /periods/:id/precheck          → relance le precheck
 *   - POST /periods/:id/dedicated-funds   → run dotation 689 / reprise 789
 *   - POST /periods/:id/accruals          → run FNP (charges/408) + extourne
 *   - POST /periods/:id/prepayments       → run CCA/PCA (saisie explicite)
 *   - POST /periods/:id/close             → clôture (DAF override)
 *   - POST /periods/:id/reopen            → ré-ouverture (DAF)
 *
 * Les types miroirent EXACTEMENT les interfaces des services backend
 * (period-close.service.ts, accrual.service.ts, prepayment.service.ts,
 * dedicated-funds.service.ts). Aucun champ inventé.
 */

type FetchOpts = Pick<ApiFetchOptions, 'accessToken'>;

// =====================================================================
//  Périodes
// =====================================================================

export type PeriodType = 'month' | 'quarter' | 'year';

/** Forme exacte du modèle Prisma `gl.fiscal_period` retournée par GET /periods. */
export interface FiscalPeriod {
  id: string;
  code: string;
  periodType: string;
  startDate: string;
  endDate: string;
  isClosed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenReason: string | null;
}

// =====================================================================
//  Precheck — findings BLOCKING (C001..C006) / WARNING (W001..W003)
// =====================================================================

export type CheckSeverity = 'BLOCKING' | 'WARNING';

/** Cf. PrecheckFinding dans period-close.service.ts. */
export interface PrecheckFinding {
  code: string;
  severity: CheckSeverity;
  message: string;
  payload: Record<string, unknown>;
}

/** Cf. PrecheckResult dans period-close.service.ts. */
export interface PrecheckResult {
  periodId: string;
  periodCode: string;
  findings: PrecheckFinding[];
  blockingCount: number;
  warningCount: number;
  canClose: boolean;
}

/** Cf. table gl.period_close_check (Prisma). */
export interface PeriodCloseCheck {
  id: string;
  periodId: string;
  checkCode: string;
  severity: CheckSeverity;
  message: string;
  payload: Record<string, unknown>;
  detectedAt: string;
}

/**
 * Évènement d'audit (close/reopen/precheck/dedicated_funds/fnp_accruals/
 * prepayments). `payload` est un JSON libre dont le contenu dépend de
 * l'`action`.
 */
export interface PeriodCloseEvent {
  id: string;
  periodId: string;
  action: string;
  userId: string;
  reason: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  user?: { email: string; fullName: string | null };
}

// =====================================================================
//  Close / reopen inputs
// =====================================================================

/** Cf. ClosePeriodDto — strict. `reason` obligatoire si override BLOCKING. */
export interface ClosePeriodInput {
  acknowledgeWarnings?: boolean;
  reason?: string;
}

/** Cf. ReopenPeriodDto — reason ≥ 5 chars, max 2000. */
export interface ReopenPeriodInput {
  reason: string;
}

// =====================================================================
//  Accruals FNP — réponse runFnpAccruals
// =====================================================================

export type AccrualSkippedReason = 'already_accrued' | 'no_remaining';

export interface AccrualLineResult {
  grId: string;
  grNumber: string;
  poNumber: string;
  amount: number;
  currency: string;
  accrualEntryId: string;
  reversalEntryId: string | null;
  skippedReason?: AccrualSkippedReason;
}

export interface AccrualsRunResult {
  periodId: string;
  periodCode: string;
  processed: number;
  skipped: number;
  totalAccrued: number;
  currency: string;
  lines: AccrualLineResult[];
  reversalsPeriodId: string | null;
}

// =====================================================================
//  Prepayments CCA/PCA — body + réponse
// =====================================================================

export type PrepaymentDirection = 'CCA' | 'PCA';

/** Cf. PrepaymentEntrySchema. Strict, validation côté backend. */
export interface PrepaymentEntryInput {
  direction: PrepaymentDirection;
  accountCode: string;
  amount: number;
  label: string;
  sourceReference?: string;
  grantId?: string;
  budgetLineId?: string;
  projectId?: string;
  costCenterId?: string;
  activityId?: string;
}

export interface RunPrepaymentsInput {
  entries: PrepaymentEntryInput[];
}

export interface PrepaymentLineResult {
  direction: PrepaymentDirection;
  label: string;
  amount: number;
  prepaymentEntryId: string;
  reversalEntryId: string | null;
}

export interface PrepaymentsRunResult {
  periodId: string;
  periodCode: string;
  processed: number;
  totalCca: number;
  totalPca: number;
  lines: PrepaymentLineResult[];
  reversalsPeriodId: string | null;
}

// =====================================================================
//  Dedicated funds — réponse run()
// =====================================================================

export type FundMovementType = 'allocation' | 'reprise';

export interface DedicatedFundsGrantResult {
  grantId: string;
  grantReference: string;
  resourcesReceived: number;
  expensesIncurred: number;
  movementType: FundMovementType;
  amount: number;
  journalEntryId: string | null;
  rationale: string;
}

export interface DedicatedFundsRunResult {
  periodId: string;
  periodCode: string;
  grants: DedicatedFundsGrantResult[];
  totalDotation: number;
  totalReprise: number;
}

// =====================================================================
//  Endpoints
// =====================================================================

export async function listPeriods(opts: FetchOpts = {}): Promise<FiscalPeriod[]> {
  return apiFetch<FiscalPeriod[]>('/accounting/periods', opts);
}

export async function getPeriodEvents(
  periodId: string,
  opts: FetchOpts = {},
): Promise<PeriodCloseEvent[]> {
  return apiFetch<PeriodCloseEvent[]>(`/accounting/periods/${periodId}/events`, opts);
}

export async function getPeriodChecks(
  periodId: string,
  opts: FetchOpts = {},
): Promise<PeriodCloseCheck[]> {
  return apiFetch<PeriodCloseCheck[]>(`/accounting/periods/${periodId}/checks`, opts);
}

export async function precheckPeriod(
  periodId: string,
  opts: FetchOpts = {},
): Promise<PrecheckResult> {
  return apiFetch<PrecheckResult>(`/accounting/periods/${periodId}/precheck`, {
    accessToken: opts.accessToken,
    method: 'POST',
  });
}

export async function runDedicatedFunds(
  periodId: string,
  opts: FetchOpts = {},
): Promise<DedicatedFundsRunResult> {
  return apiFetch<DedicatedFundsRunResult>(
    `/accounting/periods/${periodId}/dedicated-funds`,
    {
      accessToken: opts.accessToken,
      method: 'POST',
    },
  );
}

export async function runAccruals(
  periodId: string,
  opts: FetchOpts = {},
): Promise<AccrualsRunResult> {
  return apiFetch<AccrualsRunResult>(`/accounting/periods/${periodId}/accruals`, {
    accessToken: opts.accessToken,
    method: 'POST',
  });
}

export async function runPrepayments(
  periodId: string,
  input: RunPrepaymentsInput,
  opts: FetchOpts = {},
): Promise<PrepaymentsRunResult> {
  return apiFetch<PrepaymentsRunResult>(`/accounting/periods/${periodId}/prepayments`, {
    accessToken: opts.accessToken,
    method: 'POST',
    json: input,
  });
}

export async function closePeriod(
  periodId: string,
  input: ClosePeriodInput,
  opts: FetchOpts = {},
): Promise<FiscalPeriod> {
  return apiFetch<FiscalPeriod>(`/accounting/periods/${periodId}/close`, {
    accessToken: opts.accessToken,
    method: 'POST',
    json: input,
  });
}

export async function reopenPeriod(
  periodId: string,
  input: ReopenPeriodInput,
  opts: FetchOpts = {},
): Promise<FiscalPeriod> {
  return apiFetch<FiscalPeriod>(`/accounting/periods/${periodId}/reopen`, {
    accessToken: opts.accessToken,
    method: 'POST',
    json: input,
  });
}

// =====================================================================
//  Helpers UI
// =====================================================================

/**
 * Mapping severity → variante UI shadcn (cohérent avec `Badge` du projet).
 * Les findings BLOCKING affichent une variante `error`, WARNING en `warning`.
 */
export function severityToBadgeVariant(
  severity: CheckSeverity,
): 'error' | 'warning' {
  return severity === 'BLOCKING' ? 'error' : 'warning';
}

/**
 * Libellé court FR pour les codes de check (cf. period-close.service §72-77).
 * Le `message` du finding est anglais — on garde le code pour mapping stable
 * et on l'affiche avec le libellé court côté UI quand pertinent.
 */
export const CHECK_CODE_LABELS_FR: Record<string, string> = {
  C001: 'DA en attente d\'approbation',
  C002: 'BC actifs non finalisés',
  C003: 'Factures matchées non comptabilisées',
  C004: 'Écritures déséquilibrées (CRITIQUE)',
  C005: 'Fonds dédiés non dotés sur grants actifs',
  C006: 'Réceptions complètes non comptabilisées (FNP manquante)',
  W001: 'Variance budgétaire > 10 % sur ≥ 1 ligne',
  W002: 'Changement IBAN fournisseur < 30 j',
  W003: 'Période N-1 (même type) non close',
};
