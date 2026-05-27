'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { ApiError } from '@/lib/api-client';
import {
  acknowledgeIbanAlerts,
  approvePaymentRun,
  cancelPaymentRun,
  createPaymentRun,
  downloadSepaXml,
  generateSepa,
  getBankAccount,
  getPaymentRun,
  listBankAccounts,
  listIbanAlerts,
  listPaymentRuns,
  markSepaSent,
  preparePaymentRun,
  rejectPaymentRun,
  type AcknowledgeIbanAlertsInput,
  type BankAccount,
  type CreatePaymentRunInput,
  type IbanAlert,
  type ListPaymentRunsQuery,
  type ListResponse,
  type PaymentRun,
  type PaymentRunWithPayments,
} from '@/lib/api/treasury';
import { mapApiErrorToToast } from '@/lib/use-api';
import { toast } from '@/hooks/use-toast';

const treasuryKeys = {
  all: ['treasury'] as const,
  bankAccounts: () => [...treasuryKeys.all, 'bank-accounts'] as const,
  bankAccount: (id: string) => [...treasuryKeys.bankAccounts(), id] as const,
  runs: () => [...treasuryKeys.all, 'runs'] as const,
  runList: (q: ListPaymentRunsQuery) => [...treasuryKeys.runs(), 'list', q] as const,
  run: (id: string) => [...treasuryKeys.runs(), id] as const,
  ibanAlerts: (id: string) => [...treasuryKeys.run(id), 'iban-alerts'] as const,
};

function useToken() {
  const { data: session, status } = useSession();
  return {
    accessToken: session?.accessToken ?? null,
    sessionReady: status === 'authenticated',
  };
}

// =====================================================================
//  BankAccount
// =====================================================================

export function useBankAccounts() {
  const { accessToken, sessionReady } = useToken();
  return useQuery<BankAccount[]>({
    queryKey: treasuryKeys.bankAccounts(),
    enabled: sessionReady,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        return await listBankAccounts({ accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function useBankAccount(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<BankAccount>({
    queryKey: treasuryKeys.bankAccount(id ?? ''),
    enabled: sessionReady && !!id,
    queryFn: async () => {
      try {
        return await getBankAccount(id!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

// =====================================================================
//  PaymentRun queries
// =====================================================================

/**
 * Sprint F-RBAC-LISTES : `options.enabled` pour gater le fetch (le
 * GET /payment-runs est désormais @Roles côté backend).
 */
export function useListPaymentRuns(
  query: ListPaymentRunsQuery = {},
  options: { enabled?: boolean } = {},
) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<ListResponse<PaymentRun>>({
    queryKey: treasuryKeys.runList(query),
    enabled: sessionReady && (options.enabled ?? true),
    queryFn: async () => {
      try {
        return await listPaymentRuns(query, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function usePaymentRun(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<PaymentRunWithPayments>({
    queryKey: treasuryKeys.run(id ?? ''),
    enabled: sessionReady && !!id,
    queryFn: async () => {
      try {
        return await getPaymentRun(id!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function useIbanAlerts(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<IbanAlert[]>({
    queryKey: treasuryKeys.ibanAlerts(id ?? ''),
    enabled: sessionReady && !!id,
    queryFn: async () => {
      try {
        return await listIbanAlerts(id!, { accessToken });
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

export function useCreatePaymentRun() {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<PaymentRunWithPayments, ApiError, CreatePaymentRunInput>({
    mutationFn: async (input) => createPaymentRun(input, { accessToken }),
    onSuccess: () => {
      toast({ variant: 'success', title: 'PaymentRun créé' });
      void qc.invalidateQueries({ queryKey: treasuryKeys.runs() });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function usePreparePaymentRun(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<PaymentRun, ApiError, void>({
    mutationFn: async () => preparePaymentRun(id, { accessToken }),
    onSuccess: () => {
      toast({
        variant: 'success',
        title: 'Run préparé',
        description: 'Snapshot IBAN effectué. Vérifiez les alertes anti-fraude avant approbation.',
      });
      void qc.invalidateQueries({ queryKey: treasuryKeys.run(id) });
      void qc.invalidateQueries({ queryKey: treasuryKeys.ibanAlerts(id) });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useApprovePaymentRun(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<PaymentRun, ApiError, string | undefined>({
    mutationFn: async (comment) => approvePaymentRun(id, comment, { accessToken }),
    onSuccess: () => {
      toast({
        variant: 'success',
        title: 'Run approuvé + exécuté',
        description: 'Écritures BQ classe 5 créées. Statut → executed.',
      });
      void qc.invalidateQueries({ queryKey: treasuryKeys.run(id) });
      void qc.invalidateQueries({ queryKey: treasuryKeys.runs() });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useRejectPaymentRun(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<PaymentRun, ApiError, string>({
    mutationFn: async (reason) => rejectPaymentRun(id, reason, { accessToken }),
    onSuccess: () => {
      toast({ variant: 'destructive', title: 'Run rejeté' });
      void qc.invalidateQueries({ queryKey: treasuryKeys.run(id) });
      void qc.invalidateQueries({ queryKey: treasuryKeys.runs() });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useCancelPaymentRun(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<PaymentRun, ApiError, string>({
    mutationFn: async (reason) => cancelPaymentRun(id, reason, { accessToken }),
    onSuccess: () => {
      toast({ variant: 'destructive', title: 'Run annulé' });
      void qc.invalidateQueries({ queryKey: treasuryKeys.run(id) });
      void qc.invalidateQueries({ queryKey: treasuryKeys.runs() });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useAcknowledgeIbanAlerts(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<PaymentRun, ApiError, AcknowledgeIbanAlertsInput>({
    mutationFn: async (input) => acknowledgeIbanAlerts(id, input, { accessToken }),
    onSuccess: () => {
      toast({
        variant: 'success',
        title: 'Alertes IBAN acknowledgées',
        description: 'Vous pouvez maintenant approuver le run.',
      });
      void qc.invalidateQueries({ queryKey: treasuryKeys.run(id) });
      void qc.invalidateQueries({ queryKey: treasuryKeys.ibanAlerts(id) });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useGenerateSepa(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<
    { runNumber: string; generatedAt: string; size: number },
    ApiError,
    void
  >({
    mutationFn: async () => generateSepa(id, { accessToken }),
    onSuccess: (data) => {
      toast({
        variant: 'success',
        title: 'SEPA généré',
        description: `Fichier pain.001 de ${data.size} octets prêt à télécharger.`,
      });
      void qc.invalidateQueries({ queryKey: treasuryKeys.run(id) });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

/** Hook pratique : déclenche directement le téléchargement du XML. */
export function useDownloadSepa() {
  const { accessToken } = useToken();
  return useMutation<{ xml: string; filename: string }, ApiError, { runId: string; runNumber: string }>({
    mutationFn: async ({ runId, runNumber }) => {
      const xml = await downloadSepaXml(runId, { accessToken });
      const date = new Date().toISOString().slice(0, 10);
      const filename = `GRANTFLOW-pain001-${runNumber}-${date}.xml`;
      return { xml, filename };
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useMarkSepaSent(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<PaymentRun, ApiError, void>({
    mutationFn: async () => markSepaSent(id, { accessToken }),
    onSuccess: () => {
      toast({ variant: 'success', title: 'SEPA marqué comme envoyé à la banque' });
      void qc.invalidateQueries({ queryKey: treasuryKeys.run(id) });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}
