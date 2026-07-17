'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { ApiError } from '@/lib/api-client';
import {
  approvePurchaseRequest,
  cancelGoodsReceipt,
  cancelPurchaseOrder,
  cancelPurchaseRequest,
  checkPrBudget,
  completeGoodsReceipt,
  createGrFromPo,
  createPoFromPr,
  createPurchaseRequest,
  getGoodsReceipt,
  getPrApprovalHistory,
  getPurchaseOrder,
  getPurchaseRequest,
  listGoodsReceipts,
  listPendingApprovals,
  listPurchaseOrders,
  listPurchaseRequests,
  rejectGoodsReceipt,
  rejectPurchaseRequest,
  returnPurchaseRequestForChanges,
  sendPurchaseOrder,
  submitPurchaseRequest,
  updateGrLine,
  updateGrLines,
  getPoRemaining,
  updatePurchaseRequest,
  acknowledgePurchaseOrder,
  type CreateGrFromPoInput,
  type CreatePoFromPrInput,
  type CreatePurchaseRequestInput,
  type GoodsReceiptDetail,
  type ListGrQuery,
  type ListPendingApprovalsQuery,
  type ListPoQuery,
  type ListPrQuery,
  type PatchGrLineInput,
  type PoRemainingLine,
  type PurchaseOrderDetail,
  type PurchaseRequestDetail,
  type SendPoResult,
  type UpdatePurchaseRequestInput,
} from '@/lib/api/procurement';
import { mapApiErrorToToast } from '@/lib/use-api';
import { toast } from '@/hooks/use-toast';

const procurementKeys = {
  all: ['procurement'] as const,
  prs: () => [...procurementKeys.all, 'prs'] as const,
  pr: (id: string) => [...procurementKeys.prs(), id] as const,
  prList: (query: ListPrQuery) => [...procurementKeys.prs(), 'list', query] as const,
  prPendingApprovals: (query: ListPendingApprovalsQuery) =>
    [...procurementKeys.prs(), 'pending-my-approval', query] as const,
  prBudget: (id: string) => [...procurementKeys.pr(id), 'budget'] as const,
  prApproval: (id: string) => [...procurementKeys.pr(id), 'approval-history'] as const,
  pos: () => [...procurementKeys.all, 'pos'] as const,
  po: (id: string) => [...procurementKeys.pos(), id] as const,
  poList: (query: ListPoQuery) => [...procurementKeys.pos(), 'list', query] as const,
  grs: () => [...procurementKeys.all, 'grs'] as const,
  gr: (id: string) => [...procurementKeys.grs(), id] as const,
  grList: (query: ListGrQuery) => [...procurementKeys.grs(), 'list', query] as const,
};

function useToken() {
  const { data: session, status } = useSession();
  return {
    accessToken: session?.accessToken ?? null,
    sessionReady: status === 'authenticated',
  };
}

// =====================================================================
//  Purchase Requests
// =====================================================================

/**
 * Liste des DA. Sprint F-RBAC-LISTES : ajout d'un flag `enabled` pour
 * gater le fetch côté front (utile pour Dashboard qui doit éviter les
 * 403 sur les rôles non autorisés à voir les listes sensibles).
 * Par défaut `enabled: true` → comportement inchangé pour les pages
 * existantes.
 */
export function useListPRs(
  query: ListPrQuery = {},
  options: { enabled?: boolean } = {},
) {
  const { accessToken, sessionReady } = useToken();
  return useQuery({
    queryKey: procurementKeys.prList(query),
    enabled: sessionReady && (options.enabled ?? true),
    queryFn: async () => {
      try {
        return await listPurchaseRequests(query, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

/**
 * Fix `fix-pr-list-approver-scope` : page Achats invisible aux validateurs.
 *
 * `useListPRs` (GET /purchase-requests) scope par ownership — un PI ou un
 * CG ne voit donc PAS les DA qu'il doit valider. Le bon endpoint pour ça
 * est `GET /purchase-requests/pending-my-approval`, filtré côté serveur
 * sur le rôle de l'acteur (pending_pi pour les PI, pending_cg pour le CG,
 * pending_daf pour le DAF, pending_caissier pour le caissier).
 *
 * Côté UI : la page bascule sur ce hook quand l'utilisateur a un rôle
 * validateur et que le toggle est sur « À approuver » (cf. page.tsx).
 *
 * Le flag `enabled` permet de désactiver le fetch (utile quand l'autre
 * scope est actif, pour éviter un appel inutile + un 403 sur les rôles
 * non-validateurs).
 */
export function useListPendingApprovals(
  query: ListPendingApprovalsQuery = {},
  options: { enabled?: boolean } = {},
) {
  const { accessToken, sessionReady } = useToken();
  return useQuery({
    queryKey: procurementKeys.prPendingApprovals(query),
    enabled: sessionReady && (options.enabled ?? true),
    queryFn: async () => {
      try {
        return await listPendingApprovals(query, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function usePR(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery({
    queryKey: procurementKeys.pr(id ?? '__none__'),
    enabled: sessionReady && !!id,
    queryFn: async () => {
      try {
        return await getPurchaseRequest(id!, { accessToken });
      } catch (err) {
        mapApiErrorToToast(err);
        throw err;
      }
    },
  });
}

export function usePrApprovalHistory(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery({
    queryKey: procurementKeys.prApproval(id ?? '__none__'),
    enabled: sessionReady && !!id,
    queryFn: async () => getPrApprovalHistory(id!, { accessToken }),
  });
}

export function usePrBudgetCheck(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery({
    queryKey: procurementKeys.prBudget(id ?? '__none__'),
    enabled: sessionReady && !!id,
    queryFn: async () => checkPrBudget(id!, { accessToken }),
  });
}

export function useCreatePR() {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<PurchaseRequestDetail, ApiError, CreatePurchaseRequestInput>({
    mutationFn: (input) => createPurchaseRequest(input, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.prs() });
      toast({ variant: 'success', title: 'DA créée', description: 'Brouillon enregistré.' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useUpdatePR(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<PurchaseRequestDetail, ApiError, UpdatePurchaseRequestInput>({
    mutationFn: (input) => updatePurchaseRequest(id, input, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.pr(id) });
      qc.invalidateQueries({ queryKey: procurementKeys.prs() });
      toast({ variant: 'success', title: 'DA mise à jour' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useSubmitPR(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, void>({
    mutationFn: () => submitPurchaseRequest(id, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.pr(id) });
      qc.invalidateQueries({ queryKey: procurementKeys.prs() });
      toast({ variant: 'success', title: 'DA soumise', description: 'En attente d\'approbation PI.' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useApprovePR(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string | undefined>({
    mutationFn: (comment) => approvePurchaseRequest(id, comment, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.pr(id) });
      qc.invalidateQueries({ queryKey: procurementKeys.prApproval(id) });
      qc.invalidateQueries({ queryKey: procurementKeys.prs() });
      toast({ variant: 'success', title: 'DA approuvée' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useRejectPR(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (reason) => rejectPurchaseRequest(id, reason, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.pr(id) });
      qc.invalidateQueries({ queryKey: procurementKeys.prApproval(id) });
      qc.invalidateQueries({ queryKey: procurementKeys.prs() });
      toast({ variant: 'destructive', title: 'DA rejetée' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useReturnPRForChanges(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (comment) => returnPurchaseRequestForChanges(id, comment, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.pr(id) });
      qc.invalidateQueries({ queryKey: procurementKeys.prs() });
      toast({ variant: 'success', title: 'DA renvoyée en draft' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useCancelPR(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, void>({
    mutationFn: () => cancelPurchaseRequest(id, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.prs() });
      toast({ variant: 'success', title: 'DA annulée' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

// =====================================================================
//  Purchase Orders
// =====================================================================

/**
 * Sprint F-RBAC-LISTES : `options.enabled` pour gater le fetch (le
 * GET /purchase-orders est désormais @Roles côté backend).
 */
export function useListPOs(
  query: ListPoQuery = {},
  options: { enabled?: boolean } = {},
) {
  const { accessToken, sessionReady } = useToken();
  return useQuery({
    queryKey: procurementKeys.poList(query),
    enabled: sessionReady && (options.enabled ?? true),
    queryFn: () => listPurchaseOrders(query, { accessToken }),
  });
}

export function usePO(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery({
    queryKey: procurementKeys.po(id ?? '__none__'),
    enabled: sessionReady && !!id,
    queryFn: () => getPurchaseOrder(id!, { accessToken }),
  });
}

export function useCreatePoFromPr() {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<PurchaseOrderDetail, ApiError, { prId: string; input: CreatePoFromPrInput }>({
    mutationFn: ({ prId, input }) => createPoFromPr(prId, input, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.pos() });
      qc.invalidateQueries({ queryKey: procurementKeys.prs() });
      toast({ variant: 'success', title: 'BC créé', description: 'Brouillon enregistré.' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useSendPO(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<SendPoResult, ApiError, void>({
    mutationFn: () => sendPurchaseOrder(id, { accessToken }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: procurementKeys.po(id) });
      qc.invalidateQueries({ queryKey: procurementKeys.pos() });
      // Sprint F-PO-EMAIL : feedback explicite sur l'envoi e-mail.
      // L'écriture comptable classe 8 a été créée dans TOUS les cas
      // (cf. SendResult.commitmentEntryNumber). On le rappelle.
      const entry = res.commitmentEntryNumber ?? '—';
      if (res.emailDispatched) {
        toast({
          variant: 'success',
          title: 'BC envoyé au fournisseur',
          description:
            `Écriture comptable ${entry} créée. ` +
            `PDF expédié par e-mail${res.emailDispatchedTo ? ` (${res.emailDispatchedTo})` : ''}.`,
        });
      } else if (res.emailSkippedReason === 'no-contact-email') {
        toast({
          variant: 'success',
          title: 'BC validé — aucun e-mail fournisseur renseigné',
          description:
            `Statut « sent », écriture ${entry} créée. ` +
            'Le fournisseur n\'a pas d\'adresse e-mail — ajoute-la sur sa fiche ' +
            'puis utilise « Renvoyer ».',
        });
      } else {
        // smtp-error : on prévient mais le BC reste valide.
        toast({
          variant: 'destructive',
          title: 'BC envoyé — e-mail en échec',
          description:
            `Statut « sent », écriture ${entry} créée. ` +
            'L\'envoi par e-mail a échoué — réessaie avec « Renvoyer ».',
        });
      }
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useAcknowledgePO(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  // US-075 (F-S8-21) : le paramètre est désormais la référence d'accusé
  // fournisseur `ackRef` (obligatoire côté DTO), plus un contactEmail mort.
  return useMutation<unknown, ApiError, string>({
    mutationFn: (ackRef) => acknowledgePurchaseOrder(id, ackRef, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.po(id) });
      toast({ variant: 'success', title: 'BC confirmé' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useCancelPO(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (reason) => cancelPurchaseOrder(id, reason, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.po(id) });
      qc.invalidateQueries({ queryKey: procurementKeys.pos() });
      toast({ variant: 'destructive', title: 'BC annulé' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

// =====================================================================
//  Goods Receipts
// =====================================================================

/**
 * Sprint F-RBAC-LISTES : `options.enabled` pour gater le fetch (le
 * GET /goods-receipts est désormais @Roles côté backend).
 */
export function useListGRs(
  query: ListGrQuery = {},
  options: { enabled?: boolean } = {},
) {
  const { accessToken, sessionReady } = useToken();
  return useQuery({
    queryKey: procurementKeys.grList(query),
    enabled: sessionReady && (options.enabled ?? true),
    queryFn: () => listGoodsReceipts(query, { accessToken }),
  });
}

export function useGR(id: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery({
    queryKey: procurementKeys.gr(id ?? '__none__'),
    enabled: sessionReady && !!id,
    queryFn: () => getGoodsReceipt(id!, { accessToken }),
  });
}

export function useCreateGrFromPo() {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<GoodsReceiptDetail, ApiError, { poId: string; input: CreateGrFromPoInput }>({
    mutationFn: ({ poId, input }) => createGrFromPo(poId, input, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.grs() });
      qc.invalidateQueries({ queryKey: procurementKeys.pos() });
      toast({ variant: 'success', title: 'Réception créée' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useUpdateGrLine(grId: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<GoodsReceiptDetail, ApiError, PatchGrLineInput>({
    mutationFn: (input) => updateGrLine(grId, input, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.gr(grId) });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

/** Batch update — utilisé par /reception-rapide pour patcher toutes les
 *  lignes scannées d'un coup à la validation finale. */
export function useUpdateGrLines(grId: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<GoodsReceiptDetail, ApiError, PatchGrLineInput[]>({
    mutationFn: (lines) => updateGrLines(grId, lines, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.gr(grId) });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

/** Quantités restantes par poLine — utile pour la progression du scanner. */
export function usePoRemaining(poId: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<PoRemainingLine[]>({
    queryKey: [...procurementKeys.po(poId ?? '__none__'), 'remaining'],
    enabled: sessionReady && !!poId,
    queryFn: () => getPoRemaining(poId!, { accessToken }),
  });
}

export function useCompleteGR(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, void>({
    mutationFn: () => completeGoodsReceipt(id, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.gr(id) });
      qc.invalidateQueries({ queryKey: procurementKeys.grs() });
      toast({ variant: 'success', title: 'Réception complétée' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useCancelGR(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (reason) => cancelGoodsReceipt(id, reason, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.gr(id) });
      qc.invalidateQueries({ queryKey: procurementKeys.grs() });
      toast({ variant: 'destructive', title: 'Réception annulée' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}

export function useRejectGR(id: string) {
  const { accessToken } = useToken();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (reason) => rejectGoodsReceipt(id, reason, { accessToken }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: procurementKeys.gr(id) });
      toast({ variant: 'destructive', title: 'Réception rejetée' });
    },
    onError: (err) => mapApiErrorToToast(err),
  });
}
