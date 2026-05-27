'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { ApiError } from '@/lib/api-client';
import {
  cancelPosting,
  forceMatchInvoice,
  getInvoice,
  getInvoiceMatchDetails,
  listInvoiceJournalEntries,
  listInvoices,
  postInvoice,
  rejectInvoice,
  submitInvoice,
  updateInvoice,
  uploadInvoice,
  type InvoiceWithLines,
  type JournalEntriesResponse,
  type ListInvoicesQuery,
  type MatchSummary,
  type PostInvoiceResult,
  type SubmitResult,
  type UpdateInvoiceInput,
  type UploadOptions,
  type UploadResult,
} from '@/lib/api/invoicing';
import { mapApiErrorToToast } from '@/lib/use-api';
import { toast } from '@/hooks/use-toast';

const invoicingKeys = {
  all: ['invoicing'] as const,
  list: (q: ListInvoicesQuery) => [...invoicingKeys.all, 'list', q] as const,
  detail: (id: string) => [...invoicingKeys.all, 'detail', id] as const,
  matchDetails: (id: string) => [...invoicingKeys.all, 'match-details', id] as const,
  journal: (id: string) => [...invoicingKeys.all, 'journal', id] as const,
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

/**
 * Sprint F-RBAC-LISTES : `options.enabled` pour gater le fetch (le
 * GET /invoices est désormais @Roles côté backend).
 */
export function useListInvoices(
  query: ListInvoicesQuery = {},
  options: { enabled?: boolean } = {},
) {
  const { accessToken, sessionReady } = useToken();
  return useQuery({
    queryKey: invoicingKeys.list(query),
    enabled: sessionReady && (options.enabled ?? true),
    queryFn: async () => {
      try {
        return await listInvoices(query, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function useInvoice(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<InvoiceWithLines>({
    queryKey: invoicingKeys.detail(id ?? ''),
    enabled: sessionReady && !!id,
    queryFn: async () => {
      try {
        return await getInvoice(id!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function useInvoiceMatchDetails(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<{ invoice: InvoiceWithLines; matches: unknown[]; summary: MatchSummary | null }>({
    queryKey: invoicingKeys.matchDetails(id ?? ''),
    enabled: sessionReady && !!id,
    queryFn: async () => {
      try {
        return await getInvoiceMatchDetails(id!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function useInvoiceJournalEntries(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<JournalEntriesResponse>({
    queryKey: invoicingKeys.journal(id ?? ''),
    enabled: sessionReady && !!id,
    queryFn: async () => {
      try {
        return await listInvoiceJournalEntries(id!, { accessToken });
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

export function useUploadInvoice() {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<UploadResult, Error, { file: File } & Pick<UploadOptions, 'supplierId' | 'poId' | 'onProgress'>>({
    mutationFn: async ({ file, ...opts }) => {
      return uploadInvoice(file, { accessToken, ...opts });
    },
    onSuccess: () => {
      toast({
        variant: 'success',
        title: 'Upload réussi',
        description: 'OCR appliqué. Vérifiez les champs extraits avant de soumettre.',
      });
      void qc.invalidateQueries({ queryKey: invoicingKeys.all });
    },
    onError: (err) => {
      const status = (err as Error & { status?: number }).status;
      const body = (err as Error & { body?: { code?: string; message?: string } }).body;
      if (status === 409 && body?.code === 'INVOICE_DUPLICATE_NUMBER') {
        toast({
          variant: 'destructive',
          title: 'Facture en doublon',
          description: 'Une facture avec ce numéro existe déjà pour ce fournisseur.',
        });
        return;
      }
      toast({
        variant: 'destructive',
        title: 'Upload échoué',
        description: body?.message ?? err.message ?? 'Erreur inattendue',
      });
    },
  });
}

export function useUpdateInvoice(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<InvoiceWithLines, ApiError, UpdateInvoiceInput>({
    mutationFn: async (input) => updateInvoice(id, input, { accessToken }),
    onSuccess: (data) => {
      toast({ variant: 'success', title: 'Facture mise à jour' });
      qc.setQueryData(invoicingKeys.detail(id), data);
      void qc.invalidateQueries({ queryKey: invoicingKeys.list({}) });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useSubmitInvoice(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<SubmitResult, ApiError, void>({
    mutationFn: async () => submitInvoice(id, { accessToken }),
    onSuccess: (data) => {
      const status = data.outcome.newStatus;
      if (status === 'matched') {
        toast({
          variant: 'success',
          title: 'Rapprochement OK',
          description: 'Toutes les lignes ont été rapprochées avec succès.',
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Exception détectée',
          description:
            status === 'exception_price'
              ? 'Écart de prix au-delà de la tolérance.'
              : 'Écart de quantité au-delà de la tolérance.',
        });
      }
      void qc.invalidateQueries({ queryKey: invoicingKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: invoicingKeys.matchDetails(id) });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useForceMatchInvoice(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: async (reason) => forceMatchInvoice(id, reason, { accessToken }),
    onSuccess: () => {
      toast({
        variant: 'success',
        title: 'Matching forcé',
        description: 'La facture passe en statut matched. Override loggé.',
      });
      void qc.invalidateQueries({ queryKey: invoicingKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: invoicingKeys.matchDetails(id) });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useRejectInvoice(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: async (reason) => rejectInvoice(id, reason, { accessToken }),
    onSuccess: () => {
      toast({ variant: 'success', title: 'Facture rejetée' });
      void qc.invalidateQueries({ queryKey: invoicingKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: invoicingKeys.list({}) });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function usePostInvoice(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<PostInvoiceResult, ApiError, void>({
    mutationFn: async () => postInvoice(id, { accessToken }),
    onSuccess: () => {
      toast({
        variant: 'success',
        title: 'Facture comptabilisée',
        description: 'Écriture AC créée et engagement classe 8 extourné.',
      });
      void qc.invalidateQueries({ queryKey: invoicingKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: invoicingKeys.journal(id) });
      void qc.invalidateQueries({ queryKey: invoicingKeys.list({}) });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useCancelPosting(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: async (reason) => cancelPosting(id, reason, { accessToken }),
    onSuccess: () => {
      toast({
        variant: 'success',
        title: 'Comptabilisation annulée',
        description: 'Une AC inverse a été créée et l\'engagement réactivé.',
      });
      void qc.invalidateQueries({ queryKey: invoicingKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: invoicingKeys.journal(id) });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}
