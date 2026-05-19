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

describe('usePermissions — pilotage extensions (sprint F-PILOTAGE)', () => {
  // ------------------------------------------------------------------
  // canViewGrantPortfolio
  // ------------------------------------------------------------------
  it('CG can view the grant portfolio', () => {
    const p = withRoles(['CONTROLEUR']);
    expect(p.canViewGrantPortfolio()).toBe(true);
  });

  it('DAF can view the grant portfolio', () => {
    const p = withRoles(['DAF']);
    expect(p.canViewGrantPortfolio()).toBe(true);
  });

  it('PI alone cannot view the grant portfolio', () => {
    const p = withRoles(['PI']);
    expect(p.canViewGrantPortfolio()).toBe(false);
  });

  // ------------------------------------------------------------------
  // canViewMyProjects
  // ------------------------------------------------------------------
  it('PI can view "My Projects"', () => {
    const p = withRoles(['PI']);
    expect(p.canViewMyProjects()).toBe(true);
  });

  it('Standalone CG cannot access "My Projects"', () => {
    const p = withRoles(['CONTROLEUR']);
    expect(p.canViewMyProjects()).toBe(false);
  });

  // ------------------------------------------------------------------
  // canViewAnalytics
  // ------------------------------------------------------------------
  it('Only CG/DAF/SUPER_ADMIN can view analytics', () => {
    expect(withRoles(['CONTROLEUR']).canViewAnalytics()).toBe(true);
    expect(withRoles(['DAF']).canViewAnalytics()).toBe(true);
    expect(withRoles(['SUPER_ADMIN']).canViewAnalytics()).toBe(true);
    expect(withRoles(['PI']).canViewAnalytics()).toBe(false);
    expect(withRoles(['COMPTABLE']).canViewAnalytics()).toBe(false);
  });

  // ------------------------------------------------------------------
  // canParameterGrant
  // ------------------------------------------------------------------
  it('Only CG/SUPER_ADMIN can parameter grants (not DAF)', () => {
    expect(withRoles(['CONTROLEUR']).canParameterGrant()).toBe(true);
    expect(withRoles(['SUPER_ADMIN']).canParameterGrant()).toBe(true);
    expect(withRoles(['DAF']).canParameterGrant()).toBe(false);
    expect(withRoles(['PI']).canParameterGrant()).toBe(false);
  });

  // ------------------------------------------------------------------
  // canEditGrant — verrouillage si transactions actives
  // ------------------------------------------------------------------
  it('CG cannot edit a grant with active transactions', () => {
    const p = withRoles(['CONTROLEUR']);
    expect(p.canEditGrant(false)).toBe(true);
    expect(p.canEditGrant(true)).toBe(false);
  });

  it('SUPER_ADMIN can edit even a grant with transactions (bypass)', () => {
    const p = withRoles(['SUPER_ADMIN']);
    expect(p.canEditGrant(true)).toBe(true);
  });

  // ------------------------------------------------------------------
  // canViewGrant — cross-PI safety UI helper
  // ------------------------------------------------------------------
  it('CG bypass : voit tout grant même sans contexte', () => {
    const p = withRoles(['CONTROLEUR']);
    expect(p.canViewGrant(null, null)).toBe(true);
    expect(p.canViewGrant('pi-other', 'pi-self')).toBe(true);
  });

  it('PI : voit le grant si owner du projet', () => {
    const p = withRoles(['PI']);
    expect(p.canViewGrant('pi-self', 'pi-self')).toBe(true);
  });

  it('PI : ne voit PAS le grant d\'un autre PI (cross-PI safety)', () => {
    const p = withRoles(['PI']);
    expect(p.canViewGrant('pi-other', 'pi-self')).toBe(false);
  });

  it('PI sans contexte (page de routage) → laisse passer optimistic, backend tranche', () => {
    const p = withRoles(['PI']);
    expect(p.canViewGrant(null, null)).toBe(true);
  });

  it('Rôle inconnu → canViewGrant=false (fail safe)', () => {
    const p = withRoles(['BAILLEUR']);
    expect(p.canViewGrant('any', 'user')).toBe(false);
  });
});
