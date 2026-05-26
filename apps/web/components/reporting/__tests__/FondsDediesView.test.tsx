import { render, screen } from '@testing-library/react';
import { FondsDediesView } from '../FondsDediesView';
import type { FinancialStatementDetail, StatementLine } from '@/lib/api/reporting';

function makeStatement(overrides: Partial<FinancialStatementDetail> = {}): FinancialStatementDetail {
  const grantsLines: StatementLine[] = [
    {
      id: 'g1',
      statementId: 's1',
      section: 'GRANTS',
      label: 'BMGF-2024-001 — BMGF (P-001)',
      accountCode: null,
      debit: '300000',
      credit: '500000',
      balance: '200000',
      sortOrder: 0,
    },
    {
      id: 'g2',
      statementId: 's1',
      section: 'GRANTS',
      label: 'CEPI-2024-022 — CEPI (P-002)',
      accountCode: null,
      debit: '100000',
      credit: '180000',
      balance: '80000',
      sortOrder: 1,
    },
  ];
  const reconciliationLines: StatementLine[] = [
    {
      id: 'r1',
      statementId: 's1',
      section: 'RAPPROCHEMENT_689_19',
      label: 'BMGF-2024-001 — dotation 200000 reprise 0 (delta vs restant : 0)',
      accountCode: null,
      debit: '0',
      credit: '200000',
      balance: '200000',
      sortOrder: 2,
    },
  ];
  return {
    id: 's1',
    periodId: 'p1',
    type: 'FONDS_DEDIES',
    generatedAt: '2026-05-15T00:00:00Z',
    generatedBy: 'u1',
    locked: false,
    lockedAt: null,
    lockedBy: null,
    pdfObjectKey: null,
    xlsxObjectKey: null,
    totals: {
      leftTotal: 400_000,
      rightTotal: 680_000,
      balanced: true,
      totalReceived: 680_000,
      totalEmployed: 400_000,
      totalRemaining: 280_000,
      totalDotation: 280_000,
      totalReprise: 0,
      netMovements: 280_000,
      diff: 0,
    },
    period: {
      id: 'p1',
      code: '2026-04',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
    },
    lines: [...grantsLines, ...reconciliationLines],
    ...overrides,
  };
}

describe('FondsDediesView', () => {
  it('rend les 3 cards de synthèse (Reçu / Employé / Restant)', () => {
    render(<FondsDediesView statement={makeStatement()} />);
    expect(screen.getByTestId('fonds-dedies-view')).toBeInTheDocument();
    expect(screen.getByTestId('card-received')).toBeInTheDocument();
    expect(screen.getByTestId('card-employed')).toBeInTheDocument();
    expect(screen.getByTestId('card-remaining')).toBeInTheDocument();
  });

  it('bandeau équilibre vert quand balanced=true', () => {
    render(<FondsDediesView statement={makeStatement()} />);
    const banner = screen.getByTestId('balance-banner');
    expect(banner).toHaveAttribute('data-balanced', 'true');
    expect(banner).toHaveTextContent(/Rapprochement équilibré/);
  });

  it('bandeau équilibre rouge + affichage écart quand balanced=false', () => {
    const unbalanced = makeStatement({
      totals: {
        leftTotal: 400_000,
        rightTotal: 680_000,
        balanced: false,
        totalReceived: 680_000,
        totalEmployed: 400_000,
        totalRemaining: 280_000,
        totalDotation: 200_000,
        totalReprise: 0,
        netMovements: 200_000,
        diff: 80_000,
      },
    });
    render(<FondsDediesView statement={unbalanced} />);
    const banner = screen.getByTestId('balance-banner');
    expect(banner).toHaveAttribute('data-balanced', 'false');
    expect(banner).toHaveTextContent(/Déséquilibre détecté/);
    expect(banner).toHaveTextContent(/Écart/);
  });

  it('rend les 2 sections GRANTS + RAPPROCHEMENT_689_19', () => {
    render(<FondsDediesView statement={makeStatement()} />);
    expect(screen.getByTestId('statement-section-GRANTS')).toBeInTheDocument();
    expect(
      screen.getByTestId('statement-section-RAPPROCHEMENT_689_19'),
    ).toBeInTheDocument();
  });

  it('cards dotation 689 + reprise 789 affichées en footer', () => {
    render(<FondsDediesView statement={makeStatement()} />);
    expect(screen.getByTestId('card-dotation')).toBeInTheDocument();
    expect(screen.getByTestId('card-reprise')).toBeInTheDocument();
  });

  it('cohérence reçu − employé = restant (vérifie l\'affichage des totaux)', () => {
    render(<FondsDediesView statement={makeStatement()} />);
    const receivedCard = screen.getByTestId('card-received');
    const employedCard = screen.getByTestId('card-employed');
    const remainingCard = screen.getByTestId('card-remaining');
    // 680 000 − 400 000 = 280 000 — on cherche ces 3 valeurs dans les cards
    expect(receivedCard).toHaveTextContent(/680.000|680\s000/);
    expect(employedCard).toHaveTextContent(/400.000|400\s000/);
    expect(remainingCard).toHaveTextContent(/280.000|280\s000/);
  });
});
