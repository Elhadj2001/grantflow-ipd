import { render, screen } from '@testing-library/react';
import { AnalyticalDonut } from '../AnalyticalDonut';
import type { BreakdownEntry } from '@/lib/api/pilotage';

// Recharts utilise ResizeObserver — on stubbe.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
    MockResizeObserver;
});

const entries: BreakdownEntry[] = [
  { key: '611', label: 'Consommables', amount: 60_000, share: 0.6 },
  { key: '614', label: 'Locations', amount: 30_000, share: 0.3 },
  { key: '627', label: 'Banque', amount: 10_000, share: 0.1 },
];

/**
 * Note : Recharts ne rend pas correctement ses internals (Pie cells,
 * Legend texts) en jsdom sans `ResizeObserver` ET sans dimensions
 * concrètes du parent. On teste donc :
 *  - le wrapper data-testid
 *  - l'état vide (rendu pur React, sans Recharts)
 *  - la présence du title
 * Le rendu visuel est validé par Playwright en E2E.
 */
describe('AnalyticalDonut', () => {
  it('rend le wrapper data-testid avec title', () => {
    render(<AnalyticalDonut entries={entries} title="Par compte" />);
    expect(screen.getByText('Par compte')).toBeInTheDocument();
    expect(screen.getByTestId('analytical-donut')).toBeInTheDocument();
    expect(screen.getByTestId('analytical-donut')).toHaveAttribute('data-empty', 'false');
  });

  it('affiche un état vide quand entries=[]', () => {
    render(<AnalyticalDonut entries={[]} title="Vide" />);
    const root = screen.getByTestId('analytical-donut');
    expect(root).toHaveAttribute('data-empty', 'true');
    expect(screen.getByText(/Aucune donnée/)).toBeInTheDocument();
  });

  it('reflète data-selected="" par défaut', () => {
    render(<AnalyticalDonut entries={entries} />);
    expect(screen.getByTestId('analytical-donut')).toHaveAttribute('data-selected', '');
  });
});
