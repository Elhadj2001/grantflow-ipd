import { fireEvent, render, screen, within } from '@testing-library/react';
import { BudgetVarianceTable, type BudgetVarianceRow } from '../BudgetVarianceTable';

const rows: BudgetVarianceRow[] = [
  {
    budgetLineId: 'bl1',
    code: 'L01',
    label: 'Consommables',
    budgeted: 100_000,
    consumed: 30_000,
    engaged: 40_000,
    available: 60_000,
    utilization: 0.4,
  },
  {
    budgetLineId: 'bl2',
    code: 'L02',
    label: 'Locations',
    budgeted: 100_000,
    consumed: 50_000,
    engaged: 95_000,
    available: 5_000,
    utilization: 0.95,
  },
  {
    budgetLineId: 'bl3',
    code: 'L03',
    label: 'Honoraires',
    budgeted: 100_000,
    consumed: 60_000,
    engaged: 80_000,
    available: 20_000,
    utilization: 0.8,
  },
];

describe('BudgetVarianceTable', () => {
  it('rend une ligne par row + footer total', () => {
    render(<BudgetVarianceTable rows={rows} />);
    expect(screen.getByTestId('bvt-row-L01')).toBeInTheDocument();
    expect(screen.getByTestId('bvt-row-L02')).toBeInTheDocument();
    expect(screen.getByTestId('bvt-row-L03')).toBeInTheDocument();
  });

  it('tri par défaut : utilization décroissante (critical en haut)', () => {
    render(<BudgetVarianceTable rows={rows} />);
    const table = screen.getByTestId('budget-variance-table');
    expect(table).toHaveAttribute('data-sort-key', 'utilization');
    expect(table).toHaveAttribute('data-sort-order', 'desc');
    // L02 (0.95) doit être au-dessus de L03 (0.8) et L01 (0.4).
    const allRows = screen.getAllByTestId(/^bvt-row-/);
    expect(allRows[0]).toBe(screen.getByTestId('bvt-row-L02'));
  });

  it('couleurs par niveau de variance (critical / warning / ok)', () => {
    render(<BudgetVarianceTable rows={rows} />);
    expect(screen.getByTestId('bvt-row-L02')).toHaveAttribute('data-tone', 'critical');
    expect(screen.getByTestId('bvt-row-L03')).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByTestId('bvt-row-L01')).toHaveAttribute('data-tone', 'ok');
  });

  it('click sur Code → tri ascendant alphabétique', () => {
    render(<BudgetVarianceTable rows={rows} />);
    fireEvent.click(screen.getByTestId('bvt-sort-code'));
    const table = screen.getByTestId('budget-variance-table');
    expect(table).toHaveAttribute('data-sort-key', 'code');
    expect(table).toHaveAttribute('data-sort-order', 'asc');
    const ordered = screen.getAllByTestId(/^bvt-row-/);
    expect(ordered[0]).toBe(screen.getByTestId('bvt-row-L01'));
  });

  it('toggle ordre en cliquant 2 fois sur la même colonne', () => {
    render(<BudgetVarianceTable rows={rows} />);
    fireEvent.click(screen.getByTestId('bvt-sort-code'));
    fireEvent.click(screen.getByTestId('bvt-sort-code'));
    expect(screen.getByTestId('budget-variance-table')).toHaveAttribute('data-sort-order', 'desc');
  });

  it('affiche message si rows vides', () => {
    render(<BudgetVarianceTable rows={[]} />);
    expect(screen.getByText('Aucune ligne budgétaire')).toBeInTheDocument();
  });

  it('total = somme des budgetés', () => {
    render(<BudgetVarianceTable rows={rows} />);
    const tfoot = screen.getByTestId('budget-variance-table').querySelector('tfoot');
    expect(tfoot).not.toBeNull();
    expect(within(tfoot as HTMLElement).getByText(/300 000/)).toBeInTheDocument();
  });
});
