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

describe('usePermissions — administration utilisateurs (sprint F-ADMIN-USERS)', () => {
  describe('canManageUsers', () => {
    it('SUPER_ADMIN : autorisé', () => {
      expect(withRoles(['SUPER_ADMIN']).canManageUsers()).toBe(true);
    });
    it('DAF : autorisé', () => {
      expect(withRoles(['DAF']).canManageUsers()).toBe(true);
    });

    // Tous les autres rôles doivent être refusés. On vérifie la liste
    // explicitement pour empêcher qu'un nouveau rôle soit ajouté par
    // erreur dans la liste autorisée.
    it.each<GrantflowRole>([
      'CONTROLEUR',
      'COMPTABLE',
      'TRESORIER',
      'ACHETEUR',
      'MAGASINIER',
      'PI',
      'DEMANDEUR',
      'BAILLEUR',
      'CAISSIER',
    ])('%s : refusé', (role) => {
      expect(withRoles([role]).canManageUsers()).toBe(false);
    });

    it('aucun rôle attribué → refusé (cohérent avec RolesGuard 403)', () => {
      expect(withRoles([]).canManageUsers()).toBe(false);
    });

    it('combo DAF + autres : reste autorisé (OR-logique)', () => {
      expect(withRoles(['DAF', 'COMPTABLE']).canManageUsers()).toBe(true);
    });
  });
});
