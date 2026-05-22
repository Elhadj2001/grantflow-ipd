import { render, screen } from '@testing-library/react';
import { DonorReportLineTable } from '../DonorReportLineTable';
import type { DonorReportLine } from '@/lib/api/reporting';

const lines: DonorReportLine[] = [
  {
    id: 'l1',
    reportId: 'r1',
    donorCategoryId: 'c1',
    categoryCode: 'LINE_01',
    categoryLabel: 'Personnel',
    budgetAmount: '100000',
    spentAmount: '95000',
    variance: '5000',
    variancePct: '3', // 3 % → none
  },
  {
    id: 'l2',
    reportId: 'r1',
    donorCategoryId: 'c2',
    categoryCode: 'LINE_02',
    categoryLabel: 'Travel',
    budgetAmount: '50000',
    spentAmount: '45000',
    variance: '5000',
    variancePct: '10', // 10 % → warning
  },
  {
    id: 'l3',
    reportId: 'r1',
    donorCategoryId: 'c3',
    categoryCode: 'LINE_03',
    categoryLabel: 'Equipment',
    budgetAmount: '30000',
    spentAmount: '50000',
    variance: '-20000',
    variancePct: '66.67', // > 15 % → critical
  },
];

describe('DonorReportLineTable', () => {
  it('rend une ligne par catégorie + footer total', () => {
    render(<DonorReportLineTable lines={lines} currency="USD" />);
    expect(screen.getByTestId('drl-row-LINE_01')).toBeInTheDocument();
    expect(screen.getByTestId('drl-row-LINE_02')).toBeInTheDocument();
    expect(screen.getByTestId('drl-row-LINE_03')).toBeInTheDocument();
  });

  it('attribue le bon variance-level à chaque ligne', () => {
    render(<DonorReportLineTable lines={lines} currency="USD" />);
    expect(screen.getByTestId('drl-row-LINE_01')).toHaveAttribute('data-variance-level', 'none');
    expect(screen.getByTestId('drl-row-LINE_02')).toHaveAttribute(
      'data-variance-level',
      'warning',
    );
    expect(screen.getByTestId('drl-row-LINE_03')).toHaveAttribute(
      'data-variance-level',
      'critical',
    );
  });

  it('état vide quand pas de ligne', () => {
    render(<DonorReportLineTable lines={[]} currency="USD" />);
    expect(screen.getByText(/Aucune ligne agrégée/i)).toBeInTheDocument();
  });
});
