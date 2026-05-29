import { apiFetch } from '../api-client';

/**
 * Sprint F-INVOICE-SIM — feature flags exposés par GET /health/features.
 * Endpoint public (non gated) : permet à l'UI de savoir quelles features
 * démo sont activées côté serveur. Ne contient QUE des booléens.
 */
export interface Features {
  demoInvoiceSimulator: boolean;
}

export function getFeatures(): Promise<Features> {
  return apiFetch<Features>('/health/features');
}
