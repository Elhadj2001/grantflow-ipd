import { render, screen } from '@testing-library/react';
import { BudgetIndicator } from '../BudgetIndicator';

// BudgetIndicator importe les constantes de seuil depuis BudgetLinePicker
// qui transitivement importe next-auth/react (via useGrantDashboard).
// On mocke ici pour casser la chaîne — l'indicateur lui-même ne fetch rien.
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));
jest.mock('@/hooks/use-toast', () => ({ toast: jest.fn() }));

describe('BudgetIndicator', () => {
  it('renders "ok" state when available > 20% of budgeted', () => {
    render(<BudgetIndicator budgeted={100_000} available={50_000} currency="XOF" />);
    expect(screen.getByTestId('budget-indicator')).toHaveAttribute('data-state', 'ok');
    expect(screen.getByTestId('budget-indicator')).toHaveTextContent(/50% disponible/);
  });

  it('renders "warn" state when 5% < available <= 20%', () => {
    render(<BudgetIndicator budgeted={100_000} available={10_000} currency="XOF" />);
    expect(screen.getByTestId('budget-indicator')).toHaveAttribute('data-state', 'warn');
  });

  it('renders "low" state when available <= 5%', () => {
    render(<BudgetIndicator budgeted={100_000} available={3_000} currency="XOF" />);
    expect(screen.getByTestId('budget-indicator')).toHaveAttribute('data-state', 'low');
  });

  it('renders "insufficient" when requested > available', () => {
    render(
      <BudgetIndicator
        budgeted={100_000}
        available={20_000}
        requested={50_000}
        currency="XOF"
      />,
    );
    expect(screen.getByTestId('budget-indicator')).toHaveAttribute('data-state', 'insufficient');
    expect(screen.getByText(/dépasse le solde disponible/)).toBeInTheDocument();
  });

  it('does not flag insufficient when requested <= available', () => {
    render(
      <BudgetIndicator budgeted={100_000} available={20_000} requested={10_000} currency="XOF" />,
    );
    expect(screen.queryByText(/dépasse le solde/)).toBeNull();
  });

  it('renders a requested bar segment when requested > 0', () => {
    render(
      <BudgetIndicator budgeted={100_000} available={50_000} requested={20_000} currency="XOF" />,
    );
    expect(screen.getByTestId('budget-indicator-requested')).toBeInTheDocument();
  });
});
