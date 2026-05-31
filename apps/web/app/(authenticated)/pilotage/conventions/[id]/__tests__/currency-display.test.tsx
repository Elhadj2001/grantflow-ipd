/**
 * Fix convention-currency-display — la page détail convention affichait
 * 'XOF' en dur dans 3 endroits (GrantHeader, BudgetVarianceTable,
 * Recharts tooltip). Le fix lit `grant.currency` via le nouveau hook
 * useGrant. Ce test vérifie qu'un grant en USD propage USD à l'UI.
 *
 * On mocke les composants lourds (recharts, AnalyticalDonut, etc.) avec
 * des stubs minimaux qui RENDENT leur prop currency reçue dans le DOM.
 * C'est plus robuste qu'essayer de monter la page complète (recharts +
 * ResizeObserver + dimensions jsdom).
 */
import { render, screen } from '@testing-library/react';

// --- Mocks navigation/session ---
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'grant-usd' }),
}));

// --- Mocks composants lourds : exposent la prop currency dans le DOM ---
jest.mock('@/components/pilotage/GrantHeader', () => ({
  GrantHeader: (props: { currency: string }) => (
    <div data-testid="mock-grant-header">DEVISE_HEADER:{props.currency}</div>
  ),
}));
jest.mock('@/components/pilotage/BudgetVarianceTable', () => ({
  BudgetVarianceTable: (props: { currency: string }) => (
    <table data-testid="mock-budget-table">
      <tbody>
        <tr><td>DEVISE_TABLE:{props.currency}</td></tr>
      </tbody>
    </table>
  ),
}));
jest.mock('@/components/pilotage/GrantTimeline', () => ({
  GrantTimeline: () => <div />,
}));
jest.mock('@/components/pilotage/AnalyticalDonut', () => ({
  AnalyticalDonut: () => <div />,
}));
jest.mock('@/components/pilotage/DedicatedFundsCard', () => ({
  DedicatedFundsCard: () => <div />,
}));
jest.mock('@/components/pilotage/OverheadCard', () => ({
  OverheadCard: () => <div />,
}));
jest.mock('@/components/referential/BudgetLineEditor', () => ({
  BudgetLineEditor: () => <div />,
}));
// Mock Recharts : capture la prop `formatter` du Tooltip pour vérifier
// qu'elle utilise bien la devise réelle (USD), pas le 'XOF' figé.
let capturedFormatter: ((value: number) => string) | null = null;
jest.mock('recharts', () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: (props: { formatter?: (value: number) => string }) => {
    capturedFormatter = props.formatter ?? null;
    return null;
  },
  XAxis: () => null,
  YAxis: () => null,
}));

// --- Mocks hooks ---
const grantMock = {
  id: 'grant-usd',
  reference: 'USAID-IPD-2026-01',
  donorId: 'd-1',
  projectId: 'p-1',
  amount: '300000',
  currency: 'USD',
  overheadRate: '0.15',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  status: 'active' as const,
  signedAt: null,
  notes: null,
  createdAt: '2026-01-01T00:00:00Z',
};
const dashboardMock = {
  grantRef: 'USAID-IPD-2026-01',
  totalBudgeted: 300000,
  totalEngaged: 0,
  totalConsumed: 0,
  totalAvailable: 300000,
  utilization: 0,
  byBudgetLine: [
    {
      budgetLineId: 'bl-1',
      code: 'CONSO',
      label: 'Consommables',
      budgeted: 200000,
      consumed: 0,
      engaged: 0,
      available: 200000,
      utilization: 0,
    },
  ],
  monthsRemaining: 11,
  alerts: [],
};

jest.mock('@/hooks/use-referential', () => ({
  useGrant: () => ({ data: grantMock, isLoading: false }),
  useGrantDashboard: () => ({ data: dashboardMock, isLoading: false }),
  useBudgetLinesList: () => ({ data: null }),
}));
jest.mock('@/hooks/use-pilotage', () => ({
  useGrantBreakdown: () => ({
    data: {
      entries: [{ key: '2026-01', label: 'Janv 2026', amount: 10000, share: 1 }],
    },
  }),
  useGrantTransactions: () => ({ data: { data: [], total: 0 }, isLoading: false }),
  useGrantDedicatedFunds: () => ({ data: null }),
  useGrantOverhead: () => ({ data: { grantOverheadRate: 0.15 } }),
}));
jest.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    canManageBudgetLines: () => false,
    canParameterGrant: () => false,
  }),
}));

import GrantDetailPage from '../page';
import { formatAmount } from '@/lib/api/pilotage';

describe('GrantDetailPage — fix convention-currency-display', () => {
  beforeEach(() => {
    capturedFormatter = null;
  });

  it('passe currency=USD à GrantHeader (au lieu de XOF en dur)', () => {
    render(<GrantDetailPage />);
    const header = screen.getByTestId('mock-grant-header');
    expect(header).toHaveTextContent('DEVISE_HEADER:USD');
    expect(header).not.toHaveTextContent('DEVISE_HEADER:XOF');
  });

  it('passe currency=USD à BudgetVarianceTable', () => {
    render(<GrantDetailPage />);
    const table = screen.getByTestId('mock-budget-table');
    expect(table).toHaveTextContent('DEVISE_TABLE:USD');
    expect(table).not.toHaveTextContent('DEVISE_TABLE:XOF');
  });

  it('le formatter Recharts utilise la devise USD (pas XOF)', () => {
    render(<GrantDetailPage />);
    expect(capturedFormatter).not.toBeNull();
    // Le formatter est capturé via le mock Tooltip — on l'invoque avec
    // une valeur sentinelle et on vérifie que le label de devise est USD.
    const result = capturedFormatter!(12345);
    // formatAmount retourne typiquement "12 345 USD" — on cherche la
    // présence du code devise quelle que soit la mise en forme.
    expect(result).toContain('USD');
    expect(result).not.toContain('XOF');
    // Sanity — le test ne dépend pas de la mise en forme exacte de
    // formatAmount, juste de la devise. On vérifie quand même que
    // formatAmount(., 'USD') produit bien le suffixe attendu.
    expect(formatAmount(12345, 'USD')).toContain('USD');
  });
});
