import { fireEvent, render, screen } from '@testing-library/react';

/**
 * Fix `fix-pr-list-approver-scope` — couvre le toggle
 * « Mes DAs » / « À approuver » de la liste DA.
 *
 * Le bug initial : les rôles validateurs (PI/CG/DAF/CAISSIER) ne voyaient
 * RIEN sur /procurement/purchase-requests parce que la page n'appelait
 * que `useListPRs` (scope ownership). Le fix ajoute un toggle qui bascule
 * sur `useListPendingApprovals` quand l'utilisateur est validateur.
 *
 * On vérifie ici :
 *   1) Validateur → défaut « À approuver » → useListPendingApprovals appelé.
 *   2) Clic sur « Mes DAs » → useListPRs activé, hook pending désactivé.
 *   3) Non validateur (DEMANDEUR) → pas de toggle visible + scope = mine.
 */

// --- Mocks navigation / session ---
const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'tok' } }),
}));

// --- Mock des hooks de procurement : on capture les options.enabled
//     passées à chaque hook pour vérifier le routage scope → hook. ---
const useListPRsCalls: Array<{ enabled: boolean | undefined }> = [];
const useListPendingApprovalsCalls: Array<{ enabled: boolean | undefined }> = [];
jest.mock('@/hooks/use-procurement', () => ({
  useListPRs: (
    _query: unknown,
    options: { enabled?: boolean } = {},
  ) => {
    useListPRsCalls.push({ enabled: options.enabled });
    return { isLoading: false, data: { data: [], total: 0 } };
  },
  useListPendingApprovals: (
    _query: unknown,
    options: { enabled?: boolean } = {},
  ) => {
    useListPendingApprovalsCalls.push({ enabled: options.enabled });
    return { isLoading: false, data: { data: [], total: 0 } };
  },
}));

// --- Mock des permissions : on bascule via une variable de module. ---
let role: 'pi' | 'demandeur' = 'pi';
jest.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    canCreatePR: () => true,
    canApprovePRAsPi: () => role === 'pi',
    canApprovePRAsCg: () => false,
    canApprovePRAsDaf: () => false,
    canApprovePRAsCash: () => false,
  }),
}));

import PurchaseRequestsListPage from '../page';

describe('PurchaseRequests list — toggle Mes DAs / À approuver (fix-pr-list-approver-scope)', () => {
  beforeEach(() => {
    useListPRsCalls.length = 0;
    useListPendingApprovalsCalls.length = 0;
    pushMock.mockReset();
  });

  it('PI (validateur) : défaut "À approuver" → useListPendingApprovals activé', () => {
    role = 'pi';
    render(<PurchaseRequestsListPage />);

    // Toggle visible avec onglet À approuver sélectionné
    const tabToApprove = screen.getByRole('tab', { name: /à approuver/i });
    const tabMine = screen.getByRole('tab', { name: /mes das/i });
    expect(tabToApprove.getAttribute('aria-selected')).toBe('true');
    expect(tabMine.getAttribute('aria-selected')).toBe('false');

    // Hook pending appelé avec enabled=true, hook standard avec enabled=false
    const lastPending = useListPendingApprovalsCalls.at(-1);
    const lastMine = useListPRsCalls.at(-1);
    expect(lastPending?.enabled).toBe(true);
    expect(lastMine?.enabled).toBe(false);
  });

  it('PI : clic sur "Mes DAs" inverse les hooks activés', () => {
    role = 'pi';
    render(<PurchaseRequestsListPage />);

    fireEvent.click(screen.getByRole('tab', { name: /mes das/i }));

    const lastPending = useListPendingApprovalsCalls.at(-1);
    const lastMine = useListPRsCalls.at(-1);
    expect(lastMine?.enabled).toBe(true);
    expect(lastPending?.enabled).toBe(false);

    // Le tab "Mes DAs" est désormais sélectionné
    expect(screen.getByRole('tab', { name: /mes das/i }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('DEMANDEUR (non validateur) : pas de toggle, défaut "Mes DAs"', () => {
    role = 'demandeur';
    render(<PurchaseRequestsListPage />);

    expect(screen.queryByRole('tab', { name: /à approuver/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /mes das/i })).not.toBeInTheDocument();

    const lastMine = useListPRsCalls.at(-1);
    const lastPending = useListPendingApprovalsCalls.at(-1);
    expect(lastMine?.enabled).toBe(true);
    expect(lastPending?.enabled).toBe(false);
  });
});
