import { render, screen } from '@testing-library/react';
import { JournalEntryTable, type JournalEntry } from '../JournalEntryTable';

function makeEntry(lines: JournalEntry['lines'], overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'e1',
    entryNumber: 'AC-2026-001',
    journal: 'AC',
    entryDate: '2026-05-17T00:00:00.000Z',
    label: 'Facture F-2026-001',
    status: 'posted',
    lines,
    sourceType: 'invoice',
    ...overrides,
  };
}

describe('JournalEntryTable', () => {
  it('renders header with entry number, journal, date, label', () => {
    render(
      <JournalEntryTable
        entry={makeEntry([
          { accountCode: '6111', debit: 100, credit: 0 },
          { accountCode: '4011', debit: 0, credit: 100 },
        ])}
      />,
    );
    expect(screen.getByText('AC-2026-001')).toBeInTheDocument();
    expect(screen.getByText(/Journal/)).toBeInTheDocument();
    expect(screen.getByText(/2026-05-17/)).toBeInTheDocument();
  });

  it('shows balanced badge when debit equals credit', () => {
    render(
      <JournalEntryTable
        entry={makeEntry([
          { accountCode: '6111', debit: 1000, credit: 0 },
          { accountCode: '4011', debit: 0, credit: 1000 },
        ])}
      />,
    );
    expect(screen.getByTestId('journal-entry')).toHaveAttribute('data-balanced', 'true');
    expect(screen.getByTestId('journal-balanced')).toBeInTheDocument();
  });

  it('shows unbalanced badge when sums differ', () => {
    render(
      <JournalEntryTable
        entry={makeEntry([
          { accountCode: '6111', debit: 1000, credit: 0 },
          { accountCode: '4011', debit: 0, credit: 900 },
        ])}
      />,
    );
    expect(screen.getByTestId('journal-entry')).toHaveAttribute('data-balanced', 'false');
    expect(screen.getByTestId('journal-unbalanced')).toBeInTheDocument();
  });

  it('renders all lines + totals row', () => {
    render(
      <JournalEntryTable
        entry={makeEntry([
          { accountCode: '6111', debit: 500, credit: 0 },
          { accountCode: '445', debit: 90, credit: 0 },
          { accountCode: '4011', debit: 0, credit: 590 },
        ])}
      />,
    );
    expect(screen.getByTestId('journal-line-0')).toHaveTextContent('6111');
    expect(screen.getByTestId('journal-line-1')).toHaveTextContent('445');
    expect(screen.getByTestId('journal-line-2')).toHaveTextContent('4011');
    expect(screen.getByTestId('journal-total-debit')).toHaveTextContent(/590/);
    expect(screen.getByTestId('journal-total-credit')).toHaveTextContent(/590/);
  });

  it('renders status badge: posted', () => {
    render(
      <JournalEntryTable
        entry={makeEntry([{ accountCode: '6111', debit: 1, credit: 0 }, { accountCode: '4011', debit: 0, credit: 1 }], {
          status: 'posted',
        })}
      />,
    );
    expect(screen.getByText('Comptabilisée')).toBeInTheDocument();
  });

  it('renders status badge: reversed', () => {
    render(
      <JournalEntryTable
        entry={makeEntry([{ accountCode: '6111', debit: 1, credit: 0 }, { accountCode: '4011', debit: 0, credit: 1 }], {
          status: 'reversed',
        })}
      />,
    );
    expect(screen.getByText('Extournée')).toBeInTheDocument();
  });

  it('handles string Decimal values (Prisma)', () => {
    render(
      <JournalEntryTable
        entry={makeEntry([
          { accountCode: '6111', debit: '1250.50', credit: 0 },
          { accountCode: '4011', debit: 0, credit: '1250.50' },
        ])}
        currency="EUR"
      />,
    );
    expect(screen.getByTestId('journal-entry')).toHaveAttribute('data-balanced', 'true');
  });
});
