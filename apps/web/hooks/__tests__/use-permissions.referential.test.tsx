import { renderHook } from '@testing-library/react';
import type { GrantflowRole } from '@/lib/auth';
import { usePermissions } from '../use-permissions';

let mockRoles: GrantflowRole[] = [];
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { roles: mockRoles, expires: '2099' },
    status: 'authenticated',
  }),
}));

function withRoles(roles: GrantflowRole[]) {
  mockRoles = roles;
  return renderHook(() => usePermissions()).result.current;
}

describe('usePermissions — référentiel (sprint F5b-c)', () => {
  // ----------------------------------------------------------------
  // Suppliers — ACHETEUR / CG / DAF / SA
  // ----------------------------------------------------------------
  describe('canManageSuppliers', () => {
    it('ACHETEUR : autorisé (sourcing)', () => {
      expect(withRoles(['ACHETEUR']).canManageSuppliers()).toBe(true);
    });
    it('CONTROLEUR : autorisé', () => {
      expect(withRoles(['CONTROLEUR']).canManageSuppliers()).toBe(true);
    });
    it('DAF : autorisé', () => {
      expect(withRoles(['DAF']).canManageSuppliers()).toBe(true);
    });
    it('SUPER_ADMIN : autorisé', () => {
      expect(withRoles(['SUPER_ADMIN']).canManageSuppliers()).toBe(true);
    });
    it('COMPTABLE : refusé', () => {
      expect(withRoles(['COMPTABLE']).canManageSuppliers()).toBe(false);
    });
    it('BAILLEUR : refusé', () => {
      expect(withRoles(['BAILLEUR']).canManageSuppliers()).toBe(false);
    });
    it('PI / DEMANDEUR / MAGASINIER : refusés', () => {
      expect(withRoles(['PI']).canManageSuppliers()).toBe(false);
      expect(withRoles(['DEMANDEUR']).canManageSuppliers()).toBe(false);
      expect(withRoles(['MAGASINIER']).canManageSuppliers()).toBe(false);
    });
  });

  describe('canDeleteSupplier', () => {
    it('DAF / SUPER_ADMIN seulement', () => {
      expect(withRoles(['DAF']).canDeleteSupplier()).toBe(true);
      expect(withRoles(['SUPER_ADMIN']).canDeleteSupplier()).toBe(true);
      // ACHETEUR peut créer/éditer mais PAS supprimer
      expect(withRoles(['ACHETEUR']).canDeleteSupplier()).toBe(false);
      expect(withRoles(['CONTROLEUR']).canDeleteSupplier()).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // Budget lines — CG / DAF / SA (PAS ACHETEUR — asymétrie volontaire)
  // ----------------------------------------------------------------
  describe('canManageBudgetLines', () => {
    it('CONTROLEUR : autorisé (paramétrage conventions)', () => {
      expect(withRoles(['CONTROLEUR']).canManageBudgetLines()).toBe(true);
    });
    it('DAF / SUPER_ADMIN : autorisés', () => {
      expect(withRoles(['DAF']).canManageBudgetLines()).toBe(true);
      expect(withRoles(['SUPER_ADMIN']).canManageBudgetLines()).toBe(true);
    });

    /**
     * Asymétrie CRITIQUE : l'ACHETEUR peut créer/modifier des fournisseurs
     * (sourcing) mais NE doit PAS pouvoir modifier les lignes budgétaires
     * (paramétrage relevant du contrôle de gestion). Cf. RBAC backend
     * (`apps/api/src/referential/budget-line/budget-line.controller.ts`
     * @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN') sur POST/PUT/PATCH).
     */
    it('ACHETEUR : REFUSÉ (asymétrie volontaire vs suppliers)', () => {
      expect(withRoles(['ACHETEUR']).canManageBudgetLines()).toBe(false);
      // Vérification croisée : sur la même session, on a accès aux suppliers
      // mais pas aux budget-lines.
      const p = withRoles(['ACHETEUR']);
      expect(p.canManageSuppliers()).toBe(true);
      expect(p.canManageBudgetLines()).toBe(false);
    });

    it('COMPTABLE : refusé', () => {
      expect(withRoles(['COMPTABLE']).canManageBudgetLines()).toBe(false);
    });

    it('BAILLEUR / PI / DEMANDEUR / MAGASINIER : refusés', () => {
      expect(withRoles(['BAILLEUR']).canManageBudgetLines()).toBe(false);
      expect(withRoles(['PI']).canManageBudgetLines()).toBe(false);
      expect(withRoles(['DEMANDEUR']).canManageBudgetLines()).toBe(false);
      expect(withRoles(['MAGASINIER']).canManageBudgetLines()).toBe(false);
    });
  });

  describe('canDeleteBudgetLine', () => {
    it('DAF / SUPER_ADMIN uniquement', () => {
      expect(withRoles(['DAF']).canDeleteBudgetLine()).toBe(true);
      expect(withRoles(['SUPER_ADMIN']).canDeleteBudgetLine()).toBe(true);
      expect(withRoles(['CONTROLEUR']).canDeleteBudgetLine()).toBe(false);
      expect(withRoles(['ACHETEUR']).canDeleteBudgetLine()).toBe(false);
    });
  });
});
