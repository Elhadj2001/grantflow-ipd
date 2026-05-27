/**
 * Sprint F-RBAC-LISTES — tests des canList* helpers.
 *
 * Doivent matcher EXACTEMENT les @Roles côté backend pour les 4 endpoints
 * GET sensibles. Toute dérive ici (UI plus permissive) provoquerait des
 * 403 toasts intempestifs ; toute dérive plus restrictive cacherait des
 * données légitimes.
 */
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

const ALL_ROLES: GrantflowRole[] = [
  'SUPER_ADMIN',
  'DAF',
  'CONTROLEUR',
  'COMPTABLE',
  'TRESORIER',
  'ACHETEUR',
  'MAGASINIER',
  'PI',
  'DEMANDEUR',
  'BAILLEUR',
  'CAISSIER',
];

/** Assert qu'un helper renvoie true pour exactement le set fourni. */
function expectExactly(
  helperName: keyof ReturnType<typeof usePermissions>,
  allowed: GrantflowRole[],
) {
  for (const r of ALL_ROLES) {
    const p = withRoles([r]);
    const fn = p[helperName] as () => boolean;
    if (allowed.includes(r)) {
      expect({ role: r, allowed: fn() }).toEqual({ role: r, allowed: true });
    } else {
      expect({ role: r, allowed: fn() }).toEqual({ role: r, allowed: false });
    }
  }
}

describe('usePermissions — canList* (sprint F-RBAC-LISTES)', () => {
  describe('canListPurchaseOrders — aligné @Roles GET /purchase-orders', () => {
    it('autorise ACHETEUR/MAGASINIER/COMPTABLE/CG/DAF/TRESORIER/SA, refuse les autres', () => {
      expectExactly('canListPurchaseOrders', [
        'ACHETEUR',
        'MAGASINIER',
        'COMPTABLE',
        'CONTROLEUR',
        'DAF',
        'TRESORIER',
        'SUPER_ADMIN',
      ]);
    });

    it('BAILLEUR explicitement exclus (anti-leak)', () => {
      expect(withRoles(['BAILLEUR']).canListPurchaseOrders()).toBe(false);
    });
  });

  describe('canListGoodsReceipts — aligné @Roles GET /goods-receipts', () => {
    it('autorise MAGASINIER/ACHETEUR/COMPTABLE/CG/DAF/SA, refuse les autres', () => {
      expectExactly('canListGoodsReceipts', [
        'MAGASINIER',
        'ACHETEUR',
        'COMPTABLE',
        'CONTROLEUR',
        'DAF',
        'SUPER_ADMIN',
      ]);
    });

    it('BAILLEUR + TRESORIER + CAISSIER exclus', () => {
      expect(withRoles(['BAILLEUR']).canListGoodsReceipts()).toBe(false);
      expect(withRoles(['TRESORIER']).canListGoodsReceipts()).toBe(false);
      expect(withRoles(['CAISSIER']).canListGoodsReceipts()).toBe(false);
    });
  });

  describe('canListInvoices — aligné @Roles GET /invoices', () => {
    it('autorise ACHETEUR/COMPTABLE/CG/DAF/TRESORIER/DEMANDEUR/PI/SA, refuse les autres', () => {
      expectExactly('canListInvoices', [
        'ACHETEUR',
        'COMPTABLE',
        'CONTROLEUR',
        'DAF',
        'TRESORIER',
        'DEMANDEUR',
        'PI',
        'SUPER_ADMIN',
      ]);
    });

    it('BAILLEUR / MAGASINIER / CAISSIER exclus', () => {
      expect(withRoles(['BAILLEUR']).canListInvoices()).toBe(false);
      expect(withRoles(['MAGASINIER']).canListInvoices()).toBe(false);
      expect(withRoles(['CAISSIER']).canListInvoices()).toBe(false);
    });
  });

  describe('canListPaymentRuns — aligné @Roles GET /payment-runs', () => {
    it('autorise TRESORIER/COMPTABLE/CG/DAF/SA, refuse les autres', () => {
      expectExactly('canListPaymentRuns', [
        'TRESORIER',
        'COMPTABLE',
        'CONTROLEUR',
        'DAF',
        'SUPER_ADMIN',
      ]);
    });

    it('BAILLEUR / DEMANDEUR / PI / ACHETEUR / MAGASINIER / CAISSIER exclus', () => {
      for (const r of ['BAILLEUR', 'DEMANDEUR', 'PI', 'ACHETEUR', 'MAGASINIER', 'CAISSIER'] as const) {
        expect(withRoles([r]).canListPaymentRuns()).toBe(false);
      }
    });
  });
});
