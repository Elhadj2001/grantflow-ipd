import { render, screen } from '@testing-library/react';
import { DiffTable, type DiffRow } from '../DiffTable';

const baseRow = (overrides: Partial<DiffRow> = {}): DiffRow => ({
  key: 'l1',
  label: 'Ligne 1',
  ordered: { quantity: 10, unitPrice: 100, total: 1000 },
  received: { quantity: 10 },
  invoiced: { quantity: 10, unitPrice: 100, total: 1000 },
  priceVariancePct: 0,
  qtyVariancePct: 0,
  status: 'ok',
  ...overrides,
});

describe('DiffTable', () => {
  it('renders empty state when no rows', () => {
    render(<DiffTable rows={[]} />);
    expect(screen.getByText(/Aucune ligne à rapprocher/)).toBeInTheDocument();
  });

  it('renders tolerance bandeau when provided', () => {
    render(
      <DiffTable rows={[baseRow()]} priceTolerancePct={2} qtyTolerancePct={5} />,
    );
    expect(screen.getByText(/Tolérances serveur/)).toBeInTheDocument();
    expect(screen.getByText(/±2%/)).toBeInTheDocument();
    expect(screen.getByText(/±5%/)).toBeInTheDocument();
  });

  it('renders rows with status badges (each variant)', () => {
    render(
      <DiffTable
        rows={[
          baseRow({ key: 'a', label: 'Réactifs A', status: 'ok' }),
          baseRow({ key: 'b', label: 'Réactifs B', status: 'warn' }),
          baseRow({ key: 'c', label: 'Réactifs C', status: 'error' }),
          baseRow({ key: 'd', label: 'Réactifs D', status: 'unmatched' }),
        ]}
      />,
    );
    expect(screen.getByTestId('diff-row-a')).toHaveAttribute('data-status', 'ok');
    expect(screen.getByTestId('diff-row-b')).toHaveAttribute('data-status', 'warn');
    expect(screen.getByTestId('diff-row-c')).toHaveAttribute('data-status', 'error');
    expect(screen.getByTestId('diff-row-d')).toHaveAttribute('data-status', 'unmatched');
    expect(screen.getByText('Conforme')).toBeInTheDocument();
    expect(screen.getByText('Toléré')).toBeInTheDocument();
    expect(screen.getByText('Bloquant')).toBeInTheDocument();
    expect(screen.getByText('Non rapproché')).toBeInTheDocument();
  });

  it('formats variances with + sign and percent', () => {
    render(
      <DiffTable
        rows={[
          baseRow({ key: 'p', priceVariancePct: 3.5, qtyVariancePct: -2.0, status: 'warn' }),
        ]}
      />,
    );
    expect(screen.getByTestId('diff-row-p-price')).toHaveTextContent(/Prix : \+3\.5%/);
    expect(screen.getByTestId('diff-row-p-qty')).toHaveTextContent(/Qté : -2\.0%/);
  });

  it('renders triple cell columns (BC / GR / Facture)', () => {
    render(
      <DiffTable
        rows={[baseRow({ key: 'x' })]}
        currency="XOF"
      />,
    );
    const row = screen.getByTestId('diff-row-x');
    expect(row).toHaveTextContent('Qté :');
    expect(row).toHaveTextContent('PU :');
  });
});
