import { render, screen, within } from '@testing-library/react';
import { StatementSectionTable } from '../StatementSectionTable';
import type { StatementLine } from '@/lib/api/reporting';

const lines: StatementLine[] = [
  {
    id: 'l1',
    statementId: 's1',
    section: 'EMPLOIS',
    label: '661 — Salaires',
    accountCode: '661',
    debit: '120000',
    credit: '0',
    balance: '120000',
    sortOrder: 0,
  },
  {
    id: 'l2',
    statementId: 's1',
    section: 'EMPLOIS',
    label: '622 — Locations',
    accountCode: '622',
    debit: '50000',
    credit: '0',
    balance: '50000',
    sortOrder: 1,
  },
  {
    id: 'l3',
    statementId: 's1',
    section: 'RESSOURCES',
    label: '754 — Subventions',
    accountCode: '754',
    debit: '0',
    credit: '170000',
    balance: '170000',
    sortOrder: 0,
  },
];

describe('StatementSectionTable', () => {
  it('filtre par section + calcule le total des balances', () => {
    render(
      <StatementSectionTable
        lines={lines}
        section="EMPLOIS"
        sectionLabel="Emplois"
      />,
    );
    const table = screen.getByTestId('statement-section-EMPLOIS');
    expect(table).toHaveAttribute('data-count', '2');
    expect(within(table).getByTestId('statement-line-l1')).toBeInTheDocument();
    expect(within(table).getByTestId('statement-line-l2')).toBeInTheDocument();
    expect(within(table).queryByTestId('statement-line-l3')).toBeNull();
    // Total 170 000 (120k + 50k)
    expect(within(table).getByText(/170.000|170\s000/)).toBeInTheDocument();
  });

  it('ordonne les lignes par sortOrder', () => {
    const reversed = [
      { ...lines[1], sortOrder: 0 },
      { ...lines[0], sortOrder: 1 },
    ];
    render(
      <StatementSectionTable lines={reversed} section="EMPLOIS" sectionLabel="Emplois" />,
    );
    const table = screen.getByTestId('statement-section-EMPLOIS');
    const rows = within(table).getAllByTestId(/^statement-line-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'statement-line-l2');
    expect(rows[1]).toHaveAttribute('data-testid', 'statement-line-l1');
  });

  it('section vide → message "Aucune ligne"', () => {
    render(
      <StatementSectionTable lines={lines} section="ACTIF" sectionLabel="Actif" />,
    );
    expect(screen.getByText(/Aucune ligne dans cette section/)).toBeInTheDocument();
  });

  it('showAccountColumn=false masque la colonne compte (pour FONDS_DEDIES)', () => {
    render(
      <StatementSectionTable
        lines={lines}
        section="EMPLOIS"
        sectionLabel="Emplois"
        showAccountColumn={false}
      />,
    );
    const table = screen.getByTestId('statement-section-EMPLOIS');
    expect(within(table).queryByText('Compte')).toBeNull();
  });

  it('showTotal=false masque le footer total', () => {
    const { container } = render(
      <StatementSectionTable
        lines={lines}
        section="EMPLOIS"
        sectionLabel="Emplois"
        showTotal={false}
      />,
    );
    expect(container.querySelector('tfoot')).toBeNull();
  });
});
