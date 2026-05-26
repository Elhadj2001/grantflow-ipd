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

describe('usePermissions — clôture mensuelle (sprint F5b-b)', () => {
  it('canViewClosure : tous les rôles finance internes', () => {
    expect(withRoles(['COMPTABLE']).canViewClosure()).toBe(true);
    expect(withRoles(['CONTROLEUR']).canViewClosure()).toBe(true);
    expect(withRoles(['TRESORIER']).canViewClosure()).toBe(true);
    expect(withRoles(['DAF']).canViewClosure()).toBe(true);
    expect(withRoles(['SUPER_ADMIN']).canViewClosure()).toBe(true);
    expect(withRoles(['BAILLEUR']).canViewClosure()).toBe(false);
    expect(withRoles(['PI']).canViewClosure()).toBe(false);
    expect(withRoles(['ACHETEUR']).canViewClosure()).toBe(false);
  });

  it('canRunPrecheck / Accruals / Prepayments : COMPTABLE+ accepté', () => {
    expect(withRoles(['COMPTABLE']).canRunPrecheck()).toBe(true);
    expect(withRoles(['COMPTABLE']).canRunAccruals()).toBe(true);
    expect(withRoles(['COMPTABLE']).canRunPrepayments()).toBe(true);
    expect(withRoles(['TRESORIER']).canRunPrecheck()).toBe(false);
    expect(withRoles(['BAILLEUR']).canRunAccruals()).toBe(false);
  });

  it('canRunDedicatedFunds : CG/DAF/SA seulement (pas COMPTABLE)', () => {
    expect(withRoles(['CONTROLEUR']).canRunDedicatedFunds()).toBe(true);
    expect(withRoles(['DAF']).canRunDedicatedFunds()).toBe(true);
    expect(withRoles(['SUPER_ADMIN']).canRunDedicatedFunds()).toBe(true);
    expect(withRoles(['COMPTABLE']).canRunDedicatedFunds()).toBe(false);
  });

  it('canClosePeriod : CG/DAF/SA, jamais COMPTABLE seul', () => {
    expect(withRoles(['CONTROLEUR']).canClosePeriod()).toBe(true);
    expect(withRoles(['DAF']).canClosePeriod()).toBe(true);
    expect(withRoles(['COMPTABLE']).canClosePeriod()).toBe(false);
  });

  it('canReopenPeriod : DAF/SA UNIQUEMENT (pas CG)', () => {
    expect(withRoles(['DAF']).canReopenPeriod()).toBe(true);
    expect(withRoles(['SUPER_ADMIN']).canReopenPeriod()).toBe(true);
    expect(withRoles(['CONTROLEUR']).canReopenPeriod()).toBe(false);
    expect(withRoles(['COMPTABLE']).canReopenPeriod()).toBe(false);
  });

  it('canOverrideBlockingClose : DAF/SA UNIQUEMENT', () => {
    expect(withRoles(['DAF']).canOverrideBlockingClose()).toBe(true);
    expect(withRoles(['SUPER_ADMIN']).canOverrideBlockingClose()).toBe(true);
    expect(withRoles(['CONTROLEUR']).canOverrideBlockingClose()).toBe(false);
  });

  it('canCreateStatement : COMPTABLE+, canLockStatement DAF only', () => {
    expect(withRoles(['COMPTABLE']).canCreateStatement()).toBe(true);
    expect(withRoles(['DAF']).canLockStatement()).toBe(true);
    expect(withRoles(['CONTROLEUR']).canLockStatement()).toBe(false);
    expect(withRoles(['BAILLEUR']).canCreateStatement()).toBe(false);
  });
});
