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

describe('usePermissions — reporting extensions (sprint F5a)', () => {
  // canViewReporting
  it('canViewReporting : CG / DAF / BAILLEUR / SUPER_ADMIN', () => {
    expect(withRoles(['CONTROLEUR']).canViewReporting()).toBe(true);
    expect(withRoles(['DAF']).canViewReporting()).toBe(true);
    expect(withRoles(['BAILLEUR']).canViewReporting()).toBe(true);
    expect(withRoles(['SUPER_ADMIN']).canViewReporting()).toBe(true);
    expect(withRoles(['COMPTABLE']).canViewReporting()).toBe(false);
    expect(withRoles(['PI']).canViewReporting()).toBe(false);
  });

  // canCreateDonorReport
  it('canCreateDonorReport : CG / DAF / SUPER_ADMIN seulement', () => {
    expect(withRoles(['CONTROLEUR']).canCreateDonorReport()).toBe(true);
    expect(withRoles(['DAF']).canCreateDonorReport()).toBe(true);
    expect(withRoles(['SUPER_ADMIN']).canCreateDonorReport()).toBe(true);
    expect(withRoles(['BAILLEUR']).canCreateDonorReport()).toBe(false);
  });

  // canManageDonorTemplate
  it('canManageDonorTemplate : CG / SUPER_ADMIN (pas DAF)', () => {
    expect(withRoles(['CONTROLEUR']).canManageDonorTemplate()).toBe(true);
    expect(withRoles(['SUPER_ADMIN']).canManageDonorTemplate()).toBe(true);
    expect(withRoles(['DAF']).canManageDonorTemplate()).toBe(false);
  });

  // canLockDonorReport
  it('canLockDonorReport : CG / DAF / SUPER_ADMIN', () => {
    expect(withRoles(['CONTROLEUR']).canLockDonorReport()).toBe(true);
    expect(withRoles(['DAF']).canLockDonorReport()).toBe(true);
    expect(withRoles(['SUPER_ADMIN']).canLockDonorReport()).toBe(true);
    expect(withRoles(['BAILLEUR']).canLockDonorReport()).toBe(false);
  });

  // canSendDonorReport (séparation des tâches)
  it('canSendDonorReport : DAF / SUPER_ADMIN seulement (pas CG)', () => {
    expect(withRoles(['DAF']).canSendDonorReport()).toBe(true);
    expect(withRoles(['SUPER_ADMIN']).canSendDonorReport()).toBe(true);
    expect(withRoles(['CONTROLEUR']).canSendDonorReport()).toBe(false);
  });

  // canDeleteDonorTemplate
  it('canDeleteDonorTemplate : SUPER_ADMIN uniquement', () => {
    expect(withRoles(['SUPER_ADMIN']).canDeleteDonorTemplate()).toBe(true);
    expect(withRoles(['CONTROLEUR']).canDeleteDonorTemplate()).toBe(false);
    expect(withRoles(['DAF']).canDeleteDonorTemplate()).toBe(false);
  });

  it('BAILLEUR : peut voir mais ne peut rien créer/gérer', () => {
    const p = withRoles(['BAILLEUR']);
    expect(p.canViewReporting()).toBe(true);
    expect(p.canCreateDonorReport()).toBe(false);
    expect(p.canManageDonorTemplate()).toBe(false);
    expect(p.canLockDonorReport()).toBe(false);
    expect(p.canSendDonorReport()).toBe(false);
    expect(p.canDeleteDonorTemplate()).toBe(false);
  });
});
