'use client';

import { useQuery } from '@tanstack/react-query';
import { getFeatures, type Features } from '@/lib/api/features';

/**
 * Sprint F-INVOICE-SIM — expose les feature flags serveur (GET
 * /health/features, public). Caché longtemps : ces flags ne changent
 * qu'au redéploiement. Fallback `demoInvoiceSimulator: false` tant que
 * la requête n'a pas répondu (sécurité : on n'affiche pas le bouton démo
 * par défaut).
 */
export function useFeatures() {
  const query = useQuery<Features>({
    queryKey: ['features'],
    queryFn: getFeatures,
    staleTime: 30 * 60 * 1000, // 30 min — flags quasi statiques
    retry: false,
  });
  return {
    ...query,
    features: query.data ?? { demoInvoiceSimulator: false },
  };
}
