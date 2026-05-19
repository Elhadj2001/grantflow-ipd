import { render, screen } from '@testing-library/react';
import { GrantSummaryCard } from '../GrantSummaryCard';

// Stub Next.js Link → ancre simple pour les tests RTL.
// Spread tous les props pour préserver data-testid / data-* / className.
jest.mock('next/link', () => {
  return function MockLink({
    children,
    href,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  };
});

const baseProps = {
  id: 'g1',
  reference: 'BMGF-2024-001',
  donorLabel: 'Gates Foundation',
  projectTitle: 'Projet Recherche A',
  amount: 500_000,
  currency: 'XOF',
  startDate: '2024-01-01',
  endDate: '2027-12-31',
  status: 'active' as const,
  budgeted: 500_000,
  consumed: 100_000,
  engaged: 200_000,
};

describe('GrantSummaryCard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-15T00:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('affiche référence + bailleur + projet', () => {
    render(<GrantSummaryCard {...baseProps} />);
    expect(screen.getByText('BMGF-2024-001')).toBeInTheDocument();
    expect(screen.getByText('Gates Foundation')).toBeInTheDocument();
    expect(screen.getByText('Projet Recherche A')).toBeInTheDocument();
  });

  it("aucune alerte pour grant à long terme et faible utilisation", () => {
    render(<GrantSummaryCard {...baseProps} />);
    expect(screen.getByTestId('grant-summary-card')).toHaveAttribute(
      'data-alert-level',
      'none',
    );
    expect(screen.queryByTestId('alert-icon')).toBeNull();
  });

  it("alerte warning (échéance < 90 jours)", () => {
    render(<GrantSummaryCard {...baseProps} endDate="2026-06-30" />);
    const card = screen.getByTestId('grant-summary-card');
    expect(card).toHaveAttribute('data-alert-level', 'warning');
    expect(screen.getByTestId('alert-icon')).toHaveAttribute('data-level', 'warning');
  });

  it("alerte critical (échéance < 30 jours)", () => {
    render(<GrantSummaryCard {...baseProps} endDate="2026-06-01" />);
    expect(screen.getByTestId('grant-summary-card')).toHaveAttribute(
      'data-alert-level',
      'critical',
    );
    expect(screen.getByTestId('alert-icon')).toHaveAttribute('data-level', 'critical');
  });

  it("alerte critical si consommation ≥ 90% (même grant à long terme)", () => {
    render(<GrantSummaryCard {...baseProps} engaged={460_000} />);
    expect(screen.getByTestId('grant-summary-card')).toHaveAttribute(
      'data-alert-level',
      'critical',
    );
  });

  it('lien par défaut vers /pilotage/conventions/:id', () => {
    render(<GrantSummaryCard {...baseProps} />);
    const link = screen.getByTestId('grant-summary-card');
    expect(link).toHaveAttribute('href', '/pilotage/conventions/g1');
  });

  it('lien overridable via prop href', () => {
    render(<GrantSummaryCard {...baseProps} href="/custom/link" />);
    expect(screen.getByTestId('grant-summary-card')).toHaveAttribute('href', '/custom/link');
  });
});
