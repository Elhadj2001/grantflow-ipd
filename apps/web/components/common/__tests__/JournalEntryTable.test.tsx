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
      />,
    );
    expect(screen.getByTestId('journal-entry')).toHaveAttribute('data-balanced', 'true');
  });

  // ----- Hotfix devise (audit v2, journal FAC-SIM-BC-2026-0005-1) -----

  it('écriture USD : montant XOF avec label XOF + secondaire « ≈ … USD @ taux » (jamais « montant XOF + USD »)', () => {
    render(
      <JournalEntryTable
        entry={makeEntry([
          {
            accountCode: '6051',
            debit: '2952500',
            credit: 0,
            currency: 'USD',
            debitCurrency: '5000',
            fxRate: '590.5',
          },
          {
            accountCode: '4011',
            debit: 0,
            credit: '2952500',
            currency: 'USD',
            creditCurrency: '5000',
            fxRate: '590.5',
          },
        ])}
      />,
    );
    const line0 = screen.getByTestId('journal-line-0');
    // Le montant principal porte le label XOF (tenue fonctionnelle).
    expect(line0).toHaveTextContent('XOF');
    expect(line0).not.toHaveTextContent(/2\s?952\s?500,00\s?USD/);
    // La mention secondaire porte la devise d'origine + le taux figé.
    const secondaries = screen.getAllByTestId('journal-tx-currency');
    expect(secondaries[0]).toHaveTextContent('USD');
    expect(secondaries[0]).toHaveTextContent('590,5');
    // Normalise tous les types d'espace (U+0020/U+00A0/U+202F selon l'ICU).
    expect(secondaries[0].textContent?.replace(/[\s  ]/g, ' ')).toContain('5 000,00 USD');
    // Totaux en XOF.
    expect(screen.getByTestId('journal-total-debit')).toHaveTextContent('XOF');
  });

  it('écriture XOF native : label XOF, AUCUNE mention secondaire', () => {
    render(
      <JournalEntryTable
        entry={makeEntry([
          { accountCode: '6111', debit: 118000, credit: 0, currency: 'XOF', debitCurrency: 118000 },
          { accountCode: '4011', debit: 0, credit: 118000, currency: 'XOF', creditCurrency: 118000 },
        ])}
      />,
    );
    expect(screen.queryByTestId('journal-tx-currency')).toBeNull();
    expect(screen.getByTestId('journal-line-0')).toHaveTextContent('XOF');
  });
});
