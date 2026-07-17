'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import {
  listInvoiceDocuments,
  listPoDocuments,
  type EntityDocument,
} from '@/lib/api/documents';

/**
 * US-069 — hooks du panneau Documents. Pas de mapApiErrorToToast : les
 * états d'erreur sont rendus DANS le panneau (état charte), pas en toast.
 */
function useToken() {
  const { data: session, status } = useSession();
  return {
    accessToken: session?.accessToken ?? null,
    sessionReady: status === 'authenticated',
  };
}

export function useInvoiceDocuments(invoiceId: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<EntityDocument[]>({
    queryKey: ['documents', 'invoice', invoiceId ?? ''],
    enabled: sessionReady && !!invoiceId,
    staleTime: 30_000,
    queryFn: () => listInvoiceDocuments(invoiceId!, { accessToken }),
  });
}

export function usePoDocuments(poId: string | null | undefined) {
  const { accessToken, sessionReady } = useToken();
  return useQuery<EntityDocument[]>({
    queryKey: ['documents', 'po', poId ?? ''],
    enabled: sessionReady && !!poId,
    staleTime: 30_000,
    queryFn: () => listPoDocuments(poId!, { accessToken }),
  });
}
