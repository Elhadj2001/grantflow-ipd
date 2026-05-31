/**
 * Fix fix-pr-status-enum-alignment — tests Zod du champ `status` sur
 * GET /purchase-requests pour garantir l'alignement avec l'enum Prisma
 * `PrStatus` (toutes les valeurs de la BD acceptées, aucun BadRequest
 * sur un statut valide du workflow).
 *
 * Bug observé : `status=pending_caissier` (et `status=settled`)
 * renvoyaient 400 parce que le tuple littéral Zod oubliait ces 2
 * valeurs. Le fix utilise `z.nativeEnum(PrStatus)` pour ancrer l'enum
 * sur la source Prisma.
 */
import { PrStatus } from '@prisma/client';
import { PR_STATUSES, PurchaseRequestQuerySchema } from '../pr-query.dto';

describe('PurchaseRequestQuerySchema.status — alignment with Prisma PrStatus', () => {
  it('accepte TOUS les statuts de l\'enum Prisma (aucun oubli)', () => {
    for (const status of Object.values(PrStatus)) {
      const result = PurchaseRequestQuerySchema.safeParse({ status });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe(status);
      }
    }
  });

  it('accepte explicitement les 5 statuts d\'attente d\'approbation', () => {
    // Régression directe du bug : ces valeurs renvoyaient 400 avant le fix.
    const pending: PrStatus[] = [
      'submitted',
      'pending_pi',
      'pending_cg',
      'pending_daf',
      'pending_caissier',
    ];
    for (const status of pending) {
      const result = PurchaseRequestQuerySchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });

  it('accepte settled (état terminal cash_advance, manquait aussi avant le fix)', () => {
    const result = PurchaseRequestQuerySchema.safeParse({ status: 'settled' });
    expect(result.success).toBe(true);
  });

  it('rejette un statut inexistant', () => {
    const result = PurchaseRequestQuerySchema.safeParse({ status: 'pas_un_statut' });
    expect(result.success).toBe(false);
  });

  it('PR_STATUSES exporté contient toutes les valeurs Prisma (ni plus, ni moins)', () => {
    const fromPrisma = Object.values(PrStatus).sort();
    const fromExport = [...PR_STATUSES].sort();
    expect(fromExport).toEqual(fromPrisma);
    // Couverture explicite des 11 valeurs attendues (sentinelle de
    // régression : si Prisma en ajoute, le test ci-dessus passe encore mais
    // ce compte sentinelle force à mettre à jour ici aussi).
    expect(fromExport).toHaveLength(11);
  });
});
