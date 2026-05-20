import { render, screen } from '@testing-library/react';
import { DonorReportTotals } from '../DonorReportTotals';

describe('DonorReportTotals', () => {
  it('rend les 4 cards', () => {
    render(
      <DonorReportTotals
        totalBudget={100_000}
        totalSpent={70_000}
        totalOverhead={10_000}
        fundsCarried={20_000}
        currency="USD"
      />,
    );
    expect(screen.getByTestId('total-budget')).toBeInTheDocument();
    expect(screen.getByTestId('total-spent')).toBeInTheDocument();
    expect(screen.getByTestId('total-variance')).toBeInTheDocument();
    expect(screen.getByTestId('funds-carried')).toBeInTheDocument();
  });

  it('tone "ok" quand consommation < 90 %', () => {
    render(
      <DonorReportTotals
        totalBudget={100_000}
        totalSpent={70_000}
        totalOverhead={0}
        fundsCarried={0}
        currency="USD"
      />,
    );
    expect(screen.getByTestId('donor-report-totals')).toHaveAttribute(
      'data-variance-tone',
      'ok',
    );
    expect(screen.getByTestId('total-variance')).toHaveAttribute('data-tone', 'ok');
  });

  it('tone "warning" entre 90 % et 100 %', () => {
    render(
      <DonorReportTotals
        totalBudget={100_000}
        totalSpent={95_000}
        totalOverhead={0}
        fundsCarried={0}
        currency="USD"
      />,
    );
    expect(screen.getByTestId('donor-report-totals')).toHaveAttribute(
      'data-variance-tone',
      'warning',
    );
  });

  it('tone "critical" > 100 % (sur-consommation)', () => {
    render(
      <DonorReportTotals
        totalBudget={100_000}
        totalSpent={120_000}
        totalOverhead={0}
        fundsCarried={0}
        currency="USD"
      />,
    );
    expect(screen.getByTestId('donor-report-totals')).toHaveAttribute(
      'data-variance-tone',
      'critical',
    );
  });

  it('affiche le taux de change quand ≠ 1', () => {
    render(
      <DonorReportTotals
        totalBudget={1000}
        totalSpent={500}
        totalOverhead={0}
        fundsCarried={0}
        currency="USD"
        fxRateUsed={0.0017}
      />,
    );
    expect(screen.getByText(/Taux\s*:\s*0\.0017/)).toBeInTheDocument();
  });

  it('budget = 0 → variance tone "ok" (pas de division par 0)', () => {
    render(
      <DonorReportTotals
        totalBudget={0}
        totalSpent={0}
        totalOverhead={0}
        fundsCarried={0}
        currency="USD"
      />,
    );
    expect(screen.getByTestId('donor-report-totals')).toHaveAttribute(
      'data-variance-tone',
      'ok',
    );
  });
});
