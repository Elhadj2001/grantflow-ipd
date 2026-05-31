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
import type { PrStatus } from '@/lib/api/procurement';

// ----- Mocks des hooks data -----
type QueryResult = { data?: { total: number }; isLoading: boolean };

/**
 * Fix KPI "DA en attente" (Sprint F-DASHBOARD) : le composant appelle
 * désormais `useListPRs` une fois par statut d'attente d'approbation
 * (`submitted`, `pending_pi`, `pending_cg`, `pending_daf`, `pending_caissier`).
 * On indexe le mock par statut pour pouvoir simuler des totaux distincts par
 * étape du workflow et vérifier l'agrégation.
 */
let prsResultsByStatus: Partial<Record<PrStatus, QueryResult>> = {
  submitted: { data: { total: 7 }, isLoading: false },
  pending_pi: { data: { total: 0 }, isLoading: false },
  pending_cg: { data: { total: 0 }, isLoading: false },
  pending_daf: { data: { total: 0 }, isLoading: false },
  pending_caissier: { data: { total: 0 }, isLoading: false },
};
const PRS_DEFAULT: QueryResult = { data: { total: 0 }, isLoading: false };

let invoicesResult: QueryResult = {
  data: { total: 3 },
  isLoading: false,
};
let grantsResult: QueryResult = {
  data: { total: 12 },
  isLoading: false,
};
let paymentsResult: QueryResult = {
  data: { total: 4 },
  isLoading: false,
};

jest.mock('@/hooks/use-procurement', () => ({
  useListPRs: (query: { status?: PrStatus }) => {
    if (query.status !== undefined) {
      return prsResultsByStatus[query.status] ?? PRS_DEFAULT;
    }
    return PRS_DEFAULT;
  },
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
  // Par défaut : 7 DA "submitted" (cas historique du test "valeurs réelles"),
  // 0 sur les autres statuts d'attente — la somme attendue reste 7.
  prsResultsByStatus = {
    submitted: { data: { total: 7 }, isLoading: false },
    pending_pi: { data: { total: 0 }, isLoading: false },
    pending_cg: { data: { total: 0 }, isLoading: false },
    pending_daf: { data: { total: 0 }, isLoading: false },
    pending_caissier: { data: { total: 0 }, isLoading: false },
  };
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
    const loading: QueryResult = { data: undefined, isLoading: true };
    prsResultsByStatus = {
      submitted: loading,
      pending_pi: loading,
      pending_cg: loading,
      pending_daf: loading,
      pending_caissier: loading,
    };
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
    // 1 seule DA en circuit (sur pending_pi), 0 ailleurs → total = 1
    prsResultsByStatus = {
      submitted: { data: { total: 0 }, isLoading: false },
      pending_pi: { data: { total: 1 }, isLoading: false },
      pending_cg: { data: { total: 0 }, isLoading: false },
      pending_daf: { data: { total: 0 }, isLoading: false },
      pending_caissier: { data: { total: 0 }, isLoading: false },
    };
    render(<DashboardKpis />);
    expect(screen.getByText('1 convention en cours')).toBeInTheDocument();
    expect(screen.getByText("1 demande en attente d'approbation")).toBeInTheDocument();
  });

  it("KPI 'DA en attente' agrège tous les statuts d'attente d'approbation", () => {
    // Workflow réel : DA répartie sur plusieurs étapes du circuit.
    // submitted=0, pending_pi=3, pending_cg=2, pending_daf=1, pending_caissier=0
    // → Total attendu = 6
    prsResultsByStatus = {
      submitted: { data: { total: 0 }, isLoading: false },
      pending_pi: { data: { total: 3 }, isLoading: false },
      pending_cg: { data: { total: 2 }, isLoading: false },
      pending_daf: { data: { total: 1 }, isLoading: false },
      pending_caissier: { data: { total: 0 }, isLoading: false },
    };
    render(<DashboardKpis />);
    expect(screen.getByText('DA en attente')).toBeInTheDocument();
    // La valeur affichée du KPI doit être la somme (6).
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText("6 demandes en attente d'approbation")).toBeInTheDocument();
  });
});
