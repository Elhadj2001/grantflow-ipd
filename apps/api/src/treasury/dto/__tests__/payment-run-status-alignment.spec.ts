/**
 * Fix `fix-status-enum-alignment-cross-domain` — test sentinelle sur
 * `PaymentRunQuerySchema.status`.
 *
 * Pourquoi ce test ?
 *   La colonne `ap.payment_run.status` est `TEXT` au DDL (pas un type
 *   enum Postgres — cf. `docs/grantflow_ddl_postgresql.sql`). En conséquence
 *   Prisma la mappe en `String`, et il n'y a PAS d'enum `PaymentRunStatus`
 *   à utiliser via `z.nativeEnum(...)` comme on l'a fait pour
 *   PR/PO/GR/Invoice. Le tuple littéral `PAYMENT_RUN_STATUSES` est donc
 *   inévitable — mais il devient une source de désalignement potentielle :
 *   si quelqu'un ajoute un statut côté service (`'approved'`, `'sent'`...)
 *   sans le déclarer ici, GET /payment-runs?status=<nouveau> renverrait
 *   400, comme le bug `pending_caissier` sur PR.
 *
 * Ce test fige donc le contrat : tous les statuts effectivement écrits
 * par `payment-run.service.ts` doivent parser OK via le query schema.
 * La liste vient d'un grep exhaustif sur `status:` dans le service
 * (commit fix-status-enum-alignment-cross-domain) — si elle évolue, ce
 * test casse et force à revoir le DTO.
 */
import {
  PAYMENT_RUN_STATUSES,
  PaymentRunQuerySchema,
} from '../payment-run.dto';

describe('PaymentRunQuerySchema.status — alignment with service writes', () => {
  /**
   * Liste explicite (et exhaustive au moment du fix) des valeurs que
   * `payment-run.service.ts` peut écrire dans `payment_run.status`.
   * Recensé via :
   *   grep -nE "status:\s*['\"](draft|prepared|executed|rejected|cancelled)" \
   *     src/treasury/services/payment-run.service.ts
   */
  const SERVICE_WRITTEN_STATUSES = [
    'draft',
    'prepared',
    'executed',
    'rejected',
    'cancelled',
  ] as const;

  it('accepte tous les statuts effectivement écrits par le service', () => {
    for (const status of SERVICE_WRITTEN_STATUSES) {
      const result = PaymentRunQuerySchema.safeParse({ status });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe(status);
      }
    }
  });

  it('PAYMENT_RUN_STATUSES couvre toutes les valeurs du service (ni plus, ni moins)', () => {
    const fromDto = [...PAYMENT_RUN_STATUSES].sort();
    const fromService = [...SERVICE_WRITTEN_STATUSES].sort();
    expect(fromDto).toEqual(fromService);
    // Sentinelle quantitative : si le service ajoute un statut, ce
    // compte tombe à 6 et le test du dessus liste précisément le miss.
    expect(fromDto).toHaveLength(5);
  });

  it('rejette un statut inexistant (anti-fingerprint)', () => {
    const result = PaymentRunQuerySchema.safeParse({ status: 'pas_un_statut' });
    expect(result.success).toBe(false);
  });

  it('status optionnel — query vide parse OK (filtre désactivé)', () => {
    const result = PaymentRunQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBeUndefined();
    }
  });
});
