import { render, screen } from '@testing-library/react';
import { BudgetProgressBar } from '../BudgetProgressBar';

describe('BudgetProgressBar', () => {
  it('rend les 3 segments standards (consommé / engagé / disponible)', () => {
    render(<BudgetProgressBar budgeted={100_000} consumed={30_000} engaged={50_000} />);
    expect(screen.getByTestId('bpb-segment-consumed')).toBeInTheDocument();
    expect(screen.getByTestId('bpb-segment-engaged')).toBeInTheDocument();
    expect(screen.getByTestId('bpb-segment-available')).toBeInTheDocument();
    expect(screen.queryByTestId('bpb-segment-overrun')).toBeNull();
  });

  it('expose data-utilization (engaged / budgeted)', () => {
    render(<BudgetProgressBar budgeted={100_000} consumed={40_000} engaged={90_000} />);
    const bar = screen.getByTestId('budget-progress-bar');
    expect(bar).toHaveAttribute('data-utilization', '0.9000');
    expect(bar).toHaveAttribute('data-has-overrun', 'false');
  });

  it('affiche un segment overrun (rouge) quand engaged > budgeted', () => {
    render(<BudgetProgressBar budgeted={100_000} consumed={50_000} engaged={120_000} />);
    expect(screen.getByTestId('bpb-segment-overrun')).toBeInTheDocument();
    expect(screen.getByTestId('budget-progress-bar')).toHaveAttribute('data-has-overrun', 'true');
  });

  it('pas de segment quand la valeur correspondante est nulle', () => {
    render(<BudgetProgressBar budgeted={100_000} consumed={0} engaged={0} />);
    expect(screen.queryByTestId('bpb-segment-consumed')).toBeNull();
    expect(screen.queryByTestId('bpb-segment-engaged')).toBeNull();
    expect(screen.getByTestId('bpb-segment-available')).toBeInTheDocument();
  });

  it('budgeted = 0 → utilization = 0', () => {
    render(<BudgetProgressBar budgeted={0} consumed={0} engaged={0} />);
    expect(screen.getByTestId('budget-progress-bar')).toHaveAttribute('data-utilization', '0.0000');
  });

  it('aria-valuenow = pourcentage entier', () => {
    render(<BudgetProgressBar budgeted={100_000} consumed={0} engaged={75_000} />);
    const role = screen.getByRole('progressbar');
    expect(role).toHaveAttribute('aria-valuenow', '75');
    expect(role).toHaveAttribute('aria-valuemax', '100');
  });
});
