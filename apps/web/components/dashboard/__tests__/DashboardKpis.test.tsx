/**
 * Tests RTL pour la grille KPIs.
 *
 * US-066 (Sprint S7) : le composant consomme désormais UN hook unique
 * `useDashboardSummary` (GET /dashboard/summary) au lieu du fan-out
 * historique (5×useListPRs + useListInvoices + useGrantsList +
 * useListPaymentRuns). On stube ce hook pour vérifier la logique
 * d'affichage (formatage `—`, gating BAILLEUR-only, sections null).
 */

import { render, screen } from '@testing-library/react';
import type { GrantflowRole } from '@/lib/auth';
import type { DashboardSummary } from '@/lib/api/dashboard';

// ----- Mock du hook unique US-066 -----
type SummaryResult = { data?: DashboardSummary; isLoading: boolean };

function makeSummary(over: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    prPending: {
      byStatus: { submitted: 7, pending_pi: 0, pending_cg: 0, pending_daf: 0, pending_caissier: 0 },
      total: 7,
      scopedToOwn: false,
    },
    invoicesToMatch: 3,
    activeGrants: 12,
    paymentsExecutedThisMonth: 4,
    ...over,
  };
}

let summaryResult: SummaryResult = { data: makeSummary(), isLoading: false };

jest.mock('@/hooks/use-dashboard', () => ({
  useDashboardSummary: () => summaryResult,
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

describe('DashboardKpis (US-066 — endpoint agrégé)', () => {
  beforeEach(() => {
    summaryResult = { data: makeSummary(), isLoading: false };
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
    summaryResult = { data: undefined, isLoading: true };
    render(<DashboardKpis />);
    // 4 cartes → 4 "—" (toutes visibles tant que le rôle n'est pas résolu)
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.getAllByText('Chargement…').length).toBeGreaterThan(0);
  });

  it('BAILLEUR pur : seule "Conventions actives" est rendue', () => {
    mockRoles = ['BAILLEUR'];
    summaryResult = {
      data: makeSummary({ invoicesToMatch: null, paymentsExecutedThisMonth: null }),
      isLoading: false,
    };
    render(<DashboardKpis />);
    const grid = screen.getByTestId('dashboard-kpis');
    expect(grid).toHaveAttribute('data-bailleur-only', 'true');
    expect(screen.getByText('Conventions actives')).toBeInTheDocument();
    expect(screen.queryByText('DA en attente')).toBeNull();
    expect(screen.queryByText('Factures à matcher')).toBeNull();
    expect(screen.queryByText('Paiements ce mois')).toBeNull();
  });

  it('BAILLEUR + CONTROLEUR : rôle interne, les 4 cartes restent visibles', () => {
    mockRoles = ['BAILLEUR', 'CONTROLEUR'];
    render(<DashboardKpis />);
    const grid = screen.getByTestId('dashboard-kpis');
    expect(grid).toHaveAttribute('data-bailleur-only', 'false');
    expect(screen.getByText('DA en attente')).toBeInTheDocument();
    expect(screen.getByText('Factures à matcher')).toBeInTheDocument();
    expect(screen.getByText('Paiements ce mois')).toBeInTheDocument();
  });

  it('sections comptables null (rôle DEMANDEUR) : cartes factures/paiements masquées', () => {
    mockRoles = ['DEMANDEUR'];
    summaryResult = {
      data: makeSummary({
        prPending: {
          byStatus: { submitted: 0, pending_pi: 2, pending_cg: 0, pending_daf: 0, pending_caissier: 0 },
          total: 2,
          scopedToOwn: true,
        },
        invoicesToMatch: null,
        paymentsExecutedThisMonth: null,
      }),
      isLoading: false,
    };
    render(<DashboardKpis />);
    expect(screen.getByText('DA en attente')).toBeInTheDocument();
    expect(screen.queryByText('Factures à matcher')).toBeNull();
    expect(screen.queryByText('Paiements ce mois')).toBeNull();
    // Le hint précise le scoping "vos demandes"
    expect(
      screen.getByText("2 demandes en attente d'approbation (vos demandes)"),
    ).toBeInTheDocument();
  });

  it('singulier/pluriel cohérent dans les hints (1 vs 2+)', () => {
    summaryResult = {
      data: makeSummary({
        prPending: {
          byStatus: { submitted: 0, pending_pi: 1, pending_cg: 0, pending_daf: 0, pending_caissier: 0 },
          total: 1,
          scopedToOwn: false,
        },
        activeGrants: 1,
      }),
      isLoading: false,
    };
    render(<DashboardKpis />);
    expect(screen.getByText('1 convention en cours')).toBeInTheDocument();
    expect(screen.getByText("1 demande en attente d'approbation")).toBeInTheDocument();
  });

  it("le total 'DA en attente' vient du serveur (agrégat groupBy, plus de somme front)", () => {
    summaryResult = {
      data: makeSummary({
        prPending: {
          byStatus: { submitted: 0, pending_pi: 3, pending_cg: 2, pending_daf: 1, pending_caissier: 0 },
          total: 6,
          scopedToOwn: false,
        },
      }),
      isLoading: false,
    };
    render(<DashboardKpis />);
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText("6 demandes en attente d'approbation")).toBeInTheDocument();
  });
});
