'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import {
  closePeriod,
  getPeriodChecks,
  getPeriodEvents,
  listPeriods,
  precheckPeriod,
  reopenPeriod,
  runAccruals,
  runDedicatedFunds,
  runPrepayments,
  type AccrualsRunResult,
  type ClosePeriodInput,
  type DedicatedFundsRunResult,
  type FiscalPeriod,
  type PeriodCloseCheck,
  type PeriodCloseEvent,
  type PrecheckResult,
  type PrepaymentsRunResult,
  type ReopenPeriodInput,
  type RunPrepaymentsInput,
} from '@/lib/api/accounting';
import { mapApiErrorToToast } from '@/lib/use-api';

/**
 * Hooks TanStack pour la clôture mensuelle (sprint F5b-b).
 *
 * Cache :
 *   - liste periods : staleTime 5 min (changements rares — création/cloture)
 *   - checks / events / precheck result : 30 s (volatil pendant une session
 *     de clôture, on veut voir les findings à jour après chaque action)
 *
 * Invalidations : après close/reopen/precheck/accruals/prepayments/dedicated-funds
 * on invalide la période (events + checks) + la liste pour rafraîchir le badge
 * "ouverte/close".
 */

const FIVE_MIN = 5 * 60 * 1000;
const HALF_MIN = 30 * 1000;

const accountingKeys = {
  all: ['accounting'] as const,
  periods: () => [...accountingKeys.all, 'periods'] as const,
  period: (id: string) => [...accountingKeys.periods(), id] as const,
  periodEvents: (id: string) => [...accountingKeys.period(id), 'events'] as const,
  periodChecks: (id: string) => [...accountingKeys.period(id), 'checks'] as const,
};

function useToken() {
  const { data: session, status } = useSession();
  return {
    accessToken: session?.accessToken ?? null,
    sessionReady: status === 'authenticated',
  };
}

// =====================================================================
//  Queries
// =====================================================================

export function usePeriods() {
  const { accessToken, sessionReady } = useToken();
  return useQuery<FiscalPeriod[]>({
    queryKey: accountingKeys.periods(),
    enabled: sessionReady,
    staleTime: FIVE_MIN,
    queryFn: async () => {
      try {
        return await listPeriods({ accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function usePeriodEvents(periodId: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<PeriodCloseEvent[]>({
    queryKey: accountingKeys.periodEvents(periodId ?? ''),
    enabled: sessionReady && !!periodId,
    staleTime: HALF_MIN,
    queryFn: async () => {
      try {
        return await getPeriodEvents(periodId!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function usePeriodChecks(periodId: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<PeriodCloseCheck[]>({
    queryKey: accountingKeys.periodChecks(periodId ?? ''),
    enabled: sessionReady && !!periodId,
    staleTime: HALF_MIN,
    queryFn: async () => {
      try {
        return await getPeriodChecks(periodId!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

// =====================================================================
//  Mutations
// =====================================================================

/**
 * Toutes les mutations invalident la période concernée + la liste globale.
 * Le pattern factorisé évite la duplication des `onSuccess`.
 */
function useInvalidatePeriod(periodId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: accountingKeys.periodEvents(periodId) });
    qc.invalidateQueries({ queryKey: accountingKeys.periodChecks(periodId) });
    qc.invalidateQueries({ queryKey: accountingKeys.periods() });
  };
}

export function usePrecheckPeriod(periodId: string) {
  const { accessToken } = useToken();
  const invalidate = useInvalidatePeriod(periodId);
  return useMutation<PrecheckResult>({
    mutationFn: () => precheckPeriod(periodId, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useRunDedicatedFunds(periodId: string) {
  const { accessToken } = useToken();
  const invalidate = useInvalidatePeriod(periodId);
  return useMutation<DedicatedFundsRunResult>({
    mutationFn: () => runDedicatedFunds(periodId, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useRunAccruals(periodId: string) {
  const { accessToken } = useToken();
  const invalidate = useInvalidatePeriod(periodId);
  return useMutation<AccrualsRunResult>({
    mutationFn: () => runAccruals(periodId, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useRunPrepayments(periodId: string) {
  const { accessToken } = useToken();
  const invalidate = useInvalidatePeriod(periodId);
  return useMutation<PrepaymentsRunResult, Error, RunPrepaymentsInput>({
    mutationFn: (input) => runPrepayments(periodId, input, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useClosePeriod(periodId: string) {
  const { accessToken } = useToken();
  const invalidate = useInvalidatePeriod(periodId);
  return useMutation<FiscalPeriod, Error, ClosePeriodInput>({
    mutationFn: (input) => closePeriod(periodId, input, { accessToken }),
    onSuccess: invalidate,
  });
}

export function useReopenPeriod(periodId: string) {
  const { accessToken } = useToken();
  const invalidate = useInvalidatePeriod(periodId);
  return useMutation<FiscalPeriod, Error, ReopenPeriodInput>({
    mutationFn: (input) => reopenPeriod(periodId, input, { accessToken }),
    onSuccess: invalidate,
  });
}
