/**
 * Sprint F-DASHBOARD — tests RTL pour la grille KPIs.
 *
 * Stratégie : on stube les hooks data (`useListPRs`, `useListInvoices`,
 * `useGrantsList`, `useListPaymentRuns`) plutôt que `fetch`, pour
 * vérifier uniquement la logique d'affichage (formatage `—` vs nombre,
 * gating BAILLEUR-only). Les tests d'intégration des hooks eux-mêmes
 * vivent dans leurs propres suites.
 */

import { render, screen } from '@testing-library/react';
import type { GrantflowRole } from '@/lib/auth';

// ----- Mocks des hooks data -----
let prsResult: { data?: { total: number }; isLoading: boolean } = {
  data: { total: 7 },
  isLoading: false,
};
let invoicesResult: { data?: { total: number }; isLoading: boolean } = {
  data: { total: 3 },
  isLoading: false,
};
let grantsResult: { data?: { total: number }; isLoading: boolean } = {
  data: { total: 12 },
  isLoading: false,
};
let paymentsResult: { data?: { total: number }; isLoading: boolean } = {
  data: { total: 4 },
  isLoading: false,
};

jest.mock('@/hooks/use-procurement', () => ({
  useListPRs: () => prsResult,
}));
jest.mock('@/hooks/use-invoicing', () => ({
  useListInvoices: () => invoicesResult,
}));
jest.mock('@/hooks/use-referential', () => ({
  useGrantsList: () => grantsResult,
}));
jest.mock('@/hooks/use-treasury', () => ({
  useListPaymentRuns: () => paymentsResult,
}));

// ----- Mock session pour usePermissions -----
let mockRoles: GrantflowRole[] = ['SUPER_ADMIN'];
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { roles: mockRoles, expires: '2099' },
    status: 'authenticated',
  }),
}));

// Import APRÈS jest.mock (hoisting)
import { DashboardKpis } from '../DashboardKpis';

function resetData() {
  prsResult = { data: { total: 7 }, isLoading: false };
  invoicesResult = { data: { total: 3 }, isLoading: false };
  grantsResult = { data: { total: 12 }, isLoading: false };
  paymentsResult = { data: { total: 4 }, isLoading: false };
}

describe('DashboardKpis', () => {
  beforeEach(() => {
    resetData();
    mockRoles = ['SUPER_ADMIN'];
  });

  it('rend les 4 KPIs pour un rôle interne (SUPER_ADMIN) avec valeurs réelles', () => {
    render(<DashboardKpis />);
    const grid = screen.getByTestId('dashboard-kpis');
    expect(grid).toHaveAttribute('data-bailleur-only', 'false');
    expect(screen.getByText('DA en attente')).toBeInTheDocument();
    expect(screen.getByText('Factures à matcher')).toBeInTheDocument();
    expect(screen.getByText('Conventions actives')).toBeInTheDocument();
    expect(screen.getByText('Paiements ce mois')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument(); // DA
    expect(screen.getByText('3')).toBeInTheDocument(); // Factures
    expect(screen.getByText('12')).toBeInTheDocument(); // Conventions
    expect(screen.getByText('4')).toBeInTheDocument(); // Paiements
  });

  it('affiche "—" pendant le chargement (data=undefined)', () => {
    prsResult = { data: undefined, isLoading: true };
    invoicesResult = { data: undefined, isLoading: true };
    grantsResult = { data: undefined, isLoading: true };
    paymentsResult = { data: undefined, isLoading: true };
    render(<DashboardKpis />);
    // 4 cartes → 4 "—"
    expect(screen.getAllByText('—')).toHaveLength(4);
    // Hint "Chargement…" présent
    expect(screen.getAllByText('Chargement…').length).toBeGreaterThan(0);
  });

  it('BAILLEUR pur : seule "Conventions actives" est rendue', () => {
    mockRoles = ['BAILLEUR'];
    render(<DashboardKpis />);
    const grid = screen.getByTestId('dashboard-kpis');
    expect(grid).toHaveAttribute('data-bailleur-only', 'true');
    expect(screen.getByText('Conventions actives')).toBeInTheDocument();
    expect(screen.queryByText('DA en attente')).toBeNull();
    expect(screen.queryByText('Factures à matcher')).toBeNull();
    expect(screen.queryByText('Paiements ce mois')).toBeNull();
  });

  it('BAILLEUR + CONTROLEUR : on est en rôle interne, les 4 cartes restent visibles', () => {
    mockRoles = ['BAILLEUR', 'CONTROLEUR'];
    render(<DashboardKpis />);
    const grid = screen.getByTestId('dashboard-kpis');
    expect(grid).toHaveAttribute('data-bailleur-only', 'false');
    expect(screen.getByText('DA en attente')).toBeInTheDocument();
    expect(screen.getByText('Factures à matcher')).toBeInTheDocument();
    expect(screen.getByText('Paiements ce mois')).toBeInTheDocument();
  });

  it('singulier/pluriel cohérent dans les hints (1 vs 2+)', () => {
    grantsResult = { data: { total: 1 }, isLoading: false };
    prsResult = { data: { total: 1 }, isLoading: false };
    render(<DashboardKpis />);
    expect(screen.getByText('1 convention en cours')).toBeInTheDocument();
    expect(screen.getByText('1 demande soumise')).toBeInTheDocument();
  });
});
