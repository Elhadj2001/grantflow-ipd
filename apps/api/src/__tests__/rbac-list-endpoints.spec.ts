/**
 * Sprint F-RBAC-LISTES — tests RBAC sur les GET de liste sensibles.
 *
 * On vérifie via Reflector la métadata `@Roles(...)` attachée à chaque
 * handler `list()`. C'est la seule chose qui change côté contrôleur ;
 * le service applique ensuite ses propres filtres `FULL_VIEW_ROLES`
 * (testés indépendamment dans leurs specs respectifs).
 *
 * Le RolesGuard global lit cette métadata et lève 403 pour tout rôle
 * absent — ces tests garantissent que la liste de rôles autorisés est
 * stable au refactor et que BAILLEUR est EXPLICITEMENT exclus.
 */

import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { PaymentRunController } from '../treasury/payment-run.controller';
import { PurchaseOrderController } from '../procurement/purchase-order.controller';
import { GoodsReceiptController } from '../procurement/goods-receipt.controller';
import { InvoiceController } from '../invoicing/invoice.controller';

const reflector = new Reflector();

/** Lit la métadata @Roles attachée à une méthode de contrôleur. */
function rolesOf<T>(Ctrl: new (...args: never[]) => T, method: keyof T): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const handler = (Ctrl.prototype as any)[method] as Function;
  // Reflector.get attend Function | Type<any> ; on caste pour passer le check TS.
  return reflector.get<string[]>(ROLES_KEY, handler) ?? [];
}

describe('RBAC — GET de liste (sprint F-RBAC-LISTES)', () => {
  // -----------------------------------------------------------------
  // GET /payment-runs
  // -----------------------------------------------------------------
  describe('PaymentRunController.list', () => {
    const roles = rolesOf(PaymentRunController, 'list');

    it('autorise TRESORIER / COMPTABLE / CONTROLEUR / DAF / SUPER_ADMIN', () => {
      expect(roles).toEqual(
        expect.arrayContaining(['TRESORIER', 'COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN']),
      );
    });
    it("EXCLUT BAILLEUR (anti-leak)", () => {
      expect(roles).not.toContain('BAILLEUR');
    });
    it.each(['DEMANDEUR', 'PI', 'ACHETEUR', 'MAGASINIER', 'CAISSIER'])(
      'exclut %s (aucun usage métier)',
      (role) => {
        expect(roles).not.toContain(role);
      },
    );
  });

  // -----------------------------------------------------------------
  // GET /purchase-orders
  // -----------------------------------------------------------------
  describe('PurchaseOrderController.list', () => {
    const roles = rolesOf(PurchaseOrderController, 'list');

    it('autorise ACHETEUR / MAGASINIER / COMPTABLE / CONTROLEUR / DAF / TRESORIER / SUPER_ADMIN', () => {
      expect(roles).toEqual(
        expect.arrayContaining([
          'ACHETEUR',
          'MAGASINIER',
          'COMPTABLE',
          'CONTROLEUR',
          'DAF',
          'TRESORIER',
          'SUPER_ADMIN',
        ]),
      );
    });
    it('EXCLUT BAILLEUR (anti-leak)', () => {
      expect(roles).not.toContain('BAILLEUR');
    });
    it.each(['DEMANDEUR', 'PI', 'CAISSIER'])('exclut %s', (role) => {
      expect(roles).not.toContain(role);
    });
  });

  // -----------------------------------------------------------------
  // GET /goods-receipts
  // -----------------------------------------------------------------
  describe('GoodsReceiptController.list', () => {
    const roles = rolesOf(GoodsReceiptController, 'list');

    it('autorise MAGASINIER / ACHETEUR / COMPTABLE / CONTROLEUR / DAF / SUPER_ADMIN', () => {
      expect(roles).toEqual(
        expect.arrayContaining([
          'MAGASINIER',
          'ACHETEUR',
          'COMPTABLE',
          'CONTROLEUR',
          'DAF',
          'SUPER_ADMIN',
        ]),
      );
    });
    it('EXCLUT BAILLEUR (anti-leak)', () => {
      expect(roles).not.toContain('BAILLEUR');
    });
    it.each(['DEMANDEUR', 'PI', 'CAISSIER'])('exclut %s', (role) => {
      expect(roles).not.toContain(role);
    });
  });

  // -----------------------------------------------------------------
  // GET /invoices
  // -----------------------------------------------------------------
  describe('InvoiceController.list', () => {
    const roles = rolesOf(InvoiceController, 'list');

    it('autorise les rôles ayant un usage métier (ACHETEUR/COMPTABLE/CG/DAF/TRESORIER/DEMANDEUR/PI/SA)', () => {
      expect(roles).toEqual(
        expect.arrayContaining([
          'ACHETEUR',
          'COMPTABLE',
          'CONTROLEUR',
          'DAF',
          'TRESORIER',
          'DEMANDEUR',
          'PI',
          'SUPER_ADMIN',
        ]),
      );
    });
    it('EXCLUT BAILLEUR (anti-leak)', () => {
      expect(roles).not.toContain('BAILLEUR');
    });
    it.each(['MAGASINIER', 'CAISSIER'])('exclut %s (hors workflow factures)', (role) => {
      expect(roles).not.toContain(role);
    });
  });

  // -----------------------------------------------------------------
  // Garde-fou général : aucun de ces 4 endpoints ne doit avoir un
  // @Roles vide (= "tout user authentifié"), même partiellement.
  // -----------------------------------------------------------------
  it('aucune liste sensible ne tombe à @Roles vide (régression sécurité)', () => {
    const all = [
      rolesOf(PaymentRunController, 'list'),
      rolesOf(PurchaseOrderController, 'list'),
      rolesOf(GoodsReceiptController, 'list'),
      rolesOf(InvoiceController, 'list'),
    ];
    for (const r of all) {
      expect(r.length).toBeGreaterThan(0);
    }
  });
});
