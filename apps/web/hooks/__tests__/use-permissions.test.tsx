import { renderHook } from '@testing-library/react';
import type { GrantflowRole } from '@/lib/auth';
import { usePermissions } from '../use-permissions';

let mockRoles: GrantflowRole[] = [];
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { roles: mockRoles, expires: '2099' }, status: 'authenticated' }),
}));

function withRoles(roles: GrantflowRole[]) {
  mockRoles = roles;
  return renderHook(() => usePermissions()).result.current;
}

describe('usePermissions', () => {
  it('DEMANDEUR can create + edit own PR', () => {
    const p = withRoles(['DEMANDEUR']);
    expect(p.canCreatePR()).toBe(true);
    expect(p.canEditPR('user-1', 'user-1')).toBe(true);
    expect(p.canEditPR('user-1', 'user-2')).toBe(false);
    expect(p.canApprovePRAsPi()).toBe(false);
    expect(p.canCreatePO()).toBe(false);
  });

  it('PI can approve as PI', () => {
    const p = withRoles(['PI']);
    expect(p.canApprovePRAsPi()).toBe(true);
    expect(p.canApprovePRAsDaf()).toBe(false);
    expect(p.canCreatePR()).toBe(true);
  });

  it('DAF can approve DAF + settle', () => {
    const p = withRoles(['DAF']);
    expect(p.canApprovePRAsDaf()).toBe(true);
    expect(p.canApprovePRAsCash()).toBe(false);
    expect(p.canSettleCashAdvance()).toBe(true);
    expect(p.canCreatePO()).toBe(false);
  });

  it('CAISSIER can approve petty cash + settle', () => {
    const p = withRoles(['CAISSIER']);
    expect(p.canApprovePRAsCash()).toBe(true);
    expect(p.canSettleCashAdvance()).toBe(true);
    expect(p.canApprovePRAsPi()).toBe(false);
  });

  it('ACHETEUR can create PO + manage PO', () => {
    const p = withRoles(['ACHETEUR']);
    expect(p.canCreatePO()).toBe(true);
    expect(p.canManagePO()).toBe(true);
    expect(p.canReceive()).toBe(false);
  });

  it('MAGASINIER can receive', () => {
    const p = withRoles(['MAGASINIER']);
    expect(p.canReceive()).toBe(true);
    expect(p.canCreatePO()).toBe(false);
  });

  it('SUPER_ADMIN can do everything', () => {
    const p = withRoles(['SUPER_ADMIN']);
    expect(p.canCreatePR()).toBe(true);
    expect(p.canApprovePRAsPi()).toBe(true);
    expect(p.canApprovePRAsDaf()).toBe(true);
    expect(p.canApprovePRAsCash()).toBe(true);
    expect(p.canCreatePO()).toBe(true);
    expect(p.canReceive()).toBe(true);
    // canEditPR returns true even for different owner
    expect(p.canEditPR('user-1', 'user-2')).toBe(true);
  });

  it('no roles → no capabilities', () => {
    const p = withRoles([]);
    expect(p.canCreatePR()).toBe(false);
    expect(p.canApprovePRAsPi()).toBe(false);
    expect(p.canCreatePO()).toBe(false);
  });

  it('has() / hasAny() helpers', () => {
    const p = withRoles(['DAF', 'COMPTABLE']);
    expect(p.has('DAF')).toBe(true);
    expect(p.has('PI')).toBe(false);
    expect(p.hasAny('PI', 'DAF')).toBe(true);
    expect(p.hasAny('PI', 'ACHETEUR')).toBe(false);
  });

  // ------------------------------------------------------------------
  // Sprint F3 — Invoicing
  // ------------------------------------------------------------------

  it('COMPTABLE can upload + match + post invoices (not force-match)', () => {
    const p = withRoles(['COMPTABLE']);
    expect(p.canUploadInvoice()).toBe(true);
    expect(p.canMatchInvoice()).toBe(true);
    expect(p.canPostInvoice()).toBe(true);
    expect(p.canRejectInvoice()).toBe(true);
    expect(p.canForceMatchInvoice()).toBe(false);
    expect(p.canCancelPosting()).toBe(false);
    expect(p.canViewInvoice()).toBe(true);
    expect(p.canViewJournalEntry()).toBe(true);
  });

  it('DAF can force-match + post + cancel-posting (not upload/match)', () => {
    const p = withRoles(['DAF']);
    expect(p.canForceMatchInvoice()).toBe(true);
    expect(p.canPostInvoice()).toBe(true);
    expect(p.canCancelPosting()).toBe(true);
    expect(p.canRejectInvoice()).toBe(true);
    expect(p.canUploadInvoice()).toBe(false);
    expect(p.canMatchInvoice()).toBe(false);
    expect(p.canViewJournalEntry()).toBe(true);
  });

  it('CONTROLEUR can view journal entries but cannot post/match/upload', () => {
    const p = withRoles(['CONTROLEUR']);
    expect(p.canViewJournalEntry()).toBe(true);
    expect(p.canViewInvoice()).toBe(true);
    expect(p.canPostInvoice()).toBe(false);
    expect(p.canMatchInvoice()).toBe(false);
    expect(p.canUploadInvoice()).toBe(false);
    expect(p.canForceMatchInvoice()).toBe(false);
  });

  it('BAILLEUR can view invoices (read-only via API) but no journal entries', () => {
    const p = withRoles(['BAILLEUR']);
    expect(p.canViewInvoice()).toBe(true);
    expect(p.canViewJournalEntry()).toBe(false);
    expect(p.canUploadInvoice()).toBe(false);
    expect(p.canPostInvoice()).toBe(false);
  });

  it('SUPER_ADMIN can do every invoicing action', () => {
    const p = withRoles(['SUPER_ADMIN']);
    expect(p.canUploadInvoice()).toBe(true);
    expect(p.canMatchInvoice()).toBe(true);
    expect(p.canForceMatchInvoice()).toBe(true);
    expect(p.canPostInvoice()).toBe(true);
    expect(p.canCancelPosting()).toBe(true);
    expect(p.canRejectInvoice()).toBe(true);
    expect(p.canViewJournalEntry()).toBe(true);
  });

  it('no roles → no invoicing capabilities', () => {
    const p = withRoles([]);
    expect(p.canUploadInvoice()).toBe(false);
    expect(p.canMatchInvoice()).toBe(false);
    expect(p.canForceMatchInvoice()).toBe(false);
    expect(p.canPostInvoice()).toBe(false);
    expect(p.canViewJournalEntry()).toBe(false);
  });
});
