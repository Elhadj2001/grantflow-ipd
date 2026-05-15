/**
 * Valeurs autorisées pour `audit.event_log.result`.
 *
 * Doit rester synchronisé avec le `CHECK` PostgreSQL :
 *   CHECK (result IN ('success','denied','failed_validation','failed_internal'))
 *
 *   - success            → mutation 2xx
 *   - denied             → 401/403 (auth manquante / rôle refusé)
 *   - failed_validation  → 4xx applicatif (400/404/409/422)
 *   - failed_internal    → 5xx (réservé, non écrit par l'interceptor — laissé pour pino)
 */
export const AUDIT_RESULTS = ['success', 'denied', 'failed_validation', 'failed_internal'] as const;

export type AuditResult = (typeof AUDIT_RESULTS)[number];
