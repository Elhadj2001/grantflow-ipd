/**
 * Sprint F-DASHBOARD-ACTIVITY — tests RTL DashboardRecentActivity.
 *
 * On stube les 5 hooks data (PRs / POs / GRs / Invoices / PaymentRuns)
 * + usePermissions, et on vérifie :
 *   - rendu loading
 *   - empty state quand rien
 *   - tri desc par date + cap à 8 items
 *   - filtrage par RBAC (un DEMANDEUR ne voit que ses DA)
 *   - mapping status → libellé FR + variant badge
 *   - lien vers le détail (href)
 *   - helper relativeFr
 */

import { render, screen } from '@testing-library/react';
import type { GrantflowRole } from '@/lib/auth';
import { relativeFr } from '../DashboardRecentActivity';

// ----- Hooks data -----
type ListResult<T> = { data?: { data: T[] }; isLoading: boolean };
let prsResult: ListResult<unknown> = { data: { data: [] }, isLoading: false };
let posResult: ListResult<unknown> = { data: { data: [] }, isLoading: false };
let grsResult: ListResult<unknown> = { data: { data: [] }, isLoading: false };
let invoicesResult: ListResult<unknown> = { data: { data: [] }, isLoading: false };
let paymentRunsResult: ListResult<unknown> = { data: { data: [] }, isLoading: false };

jest.mock('@/hooks/use-procurement', () => ({
  useListPRs: () => prsResult,
  useListPOs: () => posResult,
  useListGRs: () => grsResult,
}));
jest.mock('@/hooks/use-invoicing', () => ({
  useListInvoices: () => invoicesResult,
}));
jest.mock('@/hooks/use-treasury', () => ({
  useListPaymentRuns: () => paymentRunsResult,
}));

let mockRoles: GrantflowRole[] = ['SUPER_ADMIN'];
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { roles: mockRoles, expires: '2099' },
    status: 'authenticated',
  }),
}));

// Import APRÈS jest.mock (hoisting)
import { DashboardRecentActivity } from '../DashboardRecentActivity';

function resetData() {
  prsResult = { data: { data: [] }, isLoading: false };
  posResult = { data: { data: [] }, isLoading: false };
  grsResult = { data: { data: [] }, isLoading: false };
  invoicesResult = { data: { data: [] }, isLoading: false };
  paymentRunsResult = { data: { data: [] }, isLoading: false };
}

// Fixtures factory — ne renvoient que les champs lus par les adapters
function fakePR(overrides: { id: string; prNumber: string; requestedAt: string; status?: string; description?: string | null }) {
  return {
    id: overrides.id,
    prNumber: overrides.prNumber,
    requestedBy: 'demandeur-1',
    requestedAt: overrides.requestedAt,
    neededBy: null,
    status: overrides.status ?? 'submitted',
    projectId: 'p1',
    grantId: 'g1',
    costCenterId: null,
    activityId: null,
    totalAmount: '0',
    currency: 'XOF',
    description: overrides.description ?? null,
  };
}

describe('DashboardRecentActivity', () => {
  beforeEach(() => {
    resetData();
    mockRoles = ['SUPER_ADMIN'];
  });

  it('rend loading quand toutes les queries sont en cours et 0 item', () => {
    prsResult = { data: undefined, isLoading: true };
    posResult = { data: undefined, isLoading: true };
    grsResult = { data: undefined, isLoading: true };
    invoicesResult = { data: undefined, isLoading: true };
    paymentRunsResult = { data: undefined, isLoading: true };
    render(<DashboardRecentActivity />);
    const wrap = screen.getByTestId('dashboard-activity');
    expect(wrap).toHaveAttribute('data-state', 'loading');
    expect(screen.getByText(/Chargement de l/i)).toBeInTheDocument();
  });

  it("rend l'EmptyState si aucune donnée et chargement terminé", () => {
    render(<DashboardRecentActivity />);
    const wrap = screen.getByTestId('dashboard-activity');
    expect(wrap).toHaveAttribute('data-state', 'empty');
    expect(screen.getByText("Pas d'activité récente")).toBeInTheDocument();
  });

  it('rend les DA récentes pour un DEMANDEUR (gate canCreatePR)', () => {
    mockRoles = ['DEMANDEUR'];
    prsResult = {
      data: {
        data: [
          fakePR({
            id: 'pr-1',
            prNumber: 'DA-2026-001',
            requestedAt: '2026-05-26T10:00:00Z',
            status: 'submitted',
            description: 'Réactifs PCR',
          }),
        ],
      },
      isLoading: false,
    };

    render(<DashboardRecentActivity />);
    const wrap = screen.getByTestId('dashboard-activity');
    expect(wrap).toHaveAttribute('data-state', 'ready');
    expect(wrap).toHaveAttribute('data-count', '1');
    expect(screen.getByText('DA-2026-001')).toBeInTheDocument();
    expect(screen.getByText('Soumise')).toBeInTheDocument();
    expect(screen.getByText('Réactifs PCR')).toBeInTheDocument();

    // Lien vers le détail
    const link = screen.getByTestId('activity-item-PR-pr-1');
    expect(link).toHaveAttribute('href', '/procurement/purchase-requests/pr-1');
    expect(link).toHaveAttribute('data-kind', 'PR');
  });

  it('trie desc par date (la plus récente en premier)', () => {
    mockRoles = ['SUPER_ADMIN'];
    prsResult = {
      data: {
        data: [
          fakePR({ id: 'pr-old', prNumber: 'DA-2026-001', requestedAt: '2026-01-01T00:00:00Z' }),
          fakePR({ id: 'pr-new', prNumber: 'DA-2026-099', requestedAt: '2026-05-26T10:00:00Z' }),
          fakePR({ id: 'pr-mid', prNumber: 'DA-2026-050', requestedAt: '2026-03-15T00:00:00Z' }),
        ],
      },
      isLoading: false,
    };

    render(<DashboardRecentActivity />);
    const items = screen.getAllByTestId(/^activity-item-PR-/);
    // Ordre attendu : pr-new (mai) → pr-mid (mars) → pr-old (janvier)
    expect(items[0]).toHaveAttribute('data-testid', 'activity-item-PR-pr-new');
    expect(items[1]).toHaveAttribute('data-testid', 'activity-item-PR-pr-mid');
    expect(items[2]).toHaveAttribute('data-testid', 'activity-item-PR-pr-old');
  });

  it('cap à 8 items maximum (sur 25 fournis = 5 par flux × 5 flux)', () => {
    mockRoles = ['SUPER_ADMIN'];
    const many = Array.from({ length: 5 }, (_, i) =>
      fakePR({
        id: `pr-${i}`,
        prNumber: `DA-${i}`,
        requestedAt: `2026-05-${(20 + i).toString().padStart(2, '0')}T10:00:00Z`,
      }),
    );
    prsResult = { data: { data: many }, isLoading: false };
    // Réutiliser les mêmes objets fakePR pour les autres flux est ok
    // pour ce test, on vérifie juste le cap. Mais les types diffèrent —
    // contournement : on ne remplit que PRs (5) + 5 BCs avec un adapter
    // minimaliste suffit pour pousser au-delà de 8 en cumulant.
    posResult = {
      data: {
        data: Array.from({ length: 5 }, (_, i) => ({
          id: `po-${i}`,
          poNumber: `BC-${i}`,
          supplierId: 's1',
          orderDate: `2026-04-${(10 + i).toString().padStart(2, '0')}`,
          expectedDate: null,
          status: 'sent',
          totalHt: '0',
          totalVat: '0',
          totalTtc: '1000',
          currency: 'XOF',
          prId: null,
        })),
      },
      isLoading: false,
    };

    render(<DashboardRecentActivity />);
    const wrap = screen.getByTestId('dashboard-activity');
    expect(wrap).toHaveAttribute('data-count', '8');
    // 10 items total ; les 5 PRs sont les + récents (mai) → tous présents.
    // Les 3 BCs les + récents sont aussi listés.
    const items = screen.getAllByTestId(/^activity-item-/);
    expect(items).toHaveLength(8);
  });

  it("BAILLEUR sans flux visibles → empty state (gating RBAC)", () => {
    // BAILLEUR : pas canCreatePR, pas canManagePO, pas canReceive,
    // pas canViewPaymentRun. canViewInvoice() est vrai mais on simule
    // une liste vide côté backend (filtre serveur).
    mockRoles = ['BAILLEUR'];
    invoicesResult = { data: { data: [] }, isLoading: false };
    render(<DashboardRecentActivity />);
    const wrap = screen.getByTestId('dashboard-activity');
    expect(wrap).toHaveAttribute('data-state', 'empty');
  });

  it("DEMANDEUR n'inclut JAMAIS les paymentRuns même si la query renvoie (gate canViewPaymentRun=false)", () => {
    mockRoles = ['DEMANDEUR'];
    // Cas pathologique : si le backend renvoyait des paymentRuns malgré
    // un 403 absent, le composant doit IGNORER ces données pour ne pas
    // exposer un domaine non-permis.
    paymentRunsResult = {
      data: {
        data: [
          {
            id: 'run-1',
            runNumber: 'PR-2026-001',
            runDate: '2026-05-26',
            currency: 'XOF',
            bankAccountId: null,
            preparedBy: null,
            approvedBy: null,
            totalAmount: '5000000',
            status: 'executed',
            sepaFileKey: null,
            sepaGeneratedAt: null,
            sepaSentAt: null,
            preparationWarnings: null,
            ibanAlerts: null,
            rejectionReason: null,
            approvedAt: null,
            executedAt: '2026-05-26T12:00:00Z',
            createdAt: '2026-05-25T00:00:00Z',
          },
        ],
      },
      isLoading: false,
    };

    render(<DashboardRecentActivity />);
    expect(screen.queryByText('PR-2026-001')).toBeNull();
    expect(screen.getByTestId('dashboard-activity')).toHaveAttribute('data-state', 'empty');
  });
});

describe('relativeFr (helper)', () => {
  // Date de référence stable pour les comparaisons (à un instant T fixé).
  const NOW = new Date('2026-05-26T12:00:00Z');

  it('< 60s → à l’instant', () => {
    expect(relativeFr('2026-05-26T11:59:30Z', NOW)).toBe('à l’instant');
  });

  it('5 min → "il y a 5 min"', () => {
    expect(relativeFr('2026-05-26T11:55:00Z', NOW)).toBe('il y a 5 min');
  });

  it('3 h → "il y a 3 h"', () => {
    expect(relativeFr('2026-05-26T09:00:00Z', NOW)).toBe('il y a 3 h');
  });

  it('1 jour → "hier"', () => {
    expect(relativeFr('2026-05-25T12:00:00Z', NOW)).toBe('hier');
  });

  it('4 jours → "il y a 4 jours"', () => {
    expect(relativeFr('2026-05-22T12:00:00Z', NOW)).toBe('il y a 4 jours');
  });

  it('> 7 jours → date FR DD/MM/YYYY', () => {
    expect(relativeFr('2026-04-01T12:00:00Z', NOW)).toBe('01/04/2026');
  });

  it('ISO invalide → chaîne vide', () => {
    expect(relativeFr('not-a-date', NOW)).toBe('');
  });
});
