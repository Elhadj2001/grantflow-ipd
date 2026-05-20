import { render, screen } from '@testing-library/react';
import { GrantTimeline } from '../GrantTimeline';
import type { PilotageTransaction } from '@/lib/api/pilotage';

const txs: PilotageTransaction[] = [
  {
    entryId: 'e1',
    entryNumber: 'AC-2026-0001',
    entryDate: '2026-03-15',
    journal: 'AC',
    label: 'Achat consommables',
    sourceType: 'purchase_order',
    sourceId: 'po1',
    accountCode: '611',
    debit: 50_000,
    credit: 0,
    net: 50_000,
    currency: 'XOF',
    status: 'posted',
  },
  {
    entryId: 'e2',
    entryNumber: 'BQ-2026-0001',
    entryDate: '2026-03-20',
    journal: 'BQ',
    label: 'Paiement fournisseur',
    sourceType: 'payment_run',
    sourceId: 'pr1',
    accountCode: '512',
    debit: 0,
    credit: 50_000,
    net: -50_000,
    currency: 'XOF',
    status: 'posted',
  },
  {
    entryId: 'e3',
    entryNumber: 'OD-2026-0005',
    entryDate: '2026-04-30',
    journal: 'OD',
    label: 'Dotation fonds dédiés',
    sourceType: 'dedicated_fund_movement',
    sourceId: null,
    accountCode: '689',
    debit: 100_000,
    credit: 0,
    net: 100_000,
    currency: 'XOF',
    status: 'posted',
  },
];

describe('GrantTimeline', () => {
  it('rend une entrée par transaction', () => {
    render(<GrantTimeline transactions={txs} />);
    expect(screen.getByTestId('timeline-item-e1')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-item-e2')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-item-e3')).toBeInTheDocument();
  });

  it('groupe par mois (clé YYYY-MM)', () => {
    render(<GrantTimeline transactions={txs} />);
    expect(screen.getByTestId('timeline-month-2026-03')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-month-2026-04')).toBeInTheDocument();
    expect(screen.getByText(/Mars 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Avril 2026/)).toBeInTheDocument();
  });

  it('état vide quand pas de transactions', () => {
    render(<GrantTimeline transactions={[]} />);
    expect(screen.getByTestId('grant-timeline')).toHaveAttribute('data-empty', 'true');
    expect(screen.getByText(/Aucune transaction/)).toBeInTheDocument();
  });

  it('filtre les drafts quand showDrafts=false', () => {
    const withDraft: PilotageTransaction[] = [
      ...txs,
      {
        ...txs[0],
        entryId: 'e4',
        entryNumber: 'AC-2026-0010',
        status: 'draft',
        label: 'Draft entry',
      },
    ];
    render(<GrantTimeline transactions={withDraft} showDrafts={false} />);
    expect(screen.queryByTestId('timeline-item-e4')).toBeNull();
    expect(screen.getByTestId('timeline-item-e1')).toBeInTheDocument();
  });
});
