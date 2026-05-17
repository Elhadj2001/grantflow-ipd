import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MatchingResultPanel } from '../MatchingResultPanel';
import type {
  InvoiceLineMatchDetail,
  InvoiceStatus,
  InvoiceWithLines,
  MatchSummary,
} from '@/lib/api/invoicing';

function makeInvoice(status: InvoiceStatus): InvoiceWithLines {
  return {
    id: 'inv-1',
    invoiceNumber: 'F-2026-001',
    supplierId: 'sup-1',
    invoiceDate: '2026-05-10',
    dueDate: '2026-06-10',
    totalHt: '100',
    totalVat: '18',
    totalTtc: '118',
    currency: 'XOF',
    exchangeRate: null,
    poId: 'po-1',
    status,
    ocrConfidence: 92,
    pdfObjectKey: 'invoices/inv-1.pdf',
    capturedPayload: null,
    matchSummary: null,
    matchedAt: null,
    matchedBy: null,
    postedAt: null,
    postedBy: null,
    rejectedAt: null,
    rejectedBy: null,
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    lines: [
      {
        id: 'l-1',
        lineNumber: 1,
        description: 'Réactifs labo',
        quantity: 10,
        unitPrice: 10,
        lineTotal: '100',
        poLineId: 'pol-1',
        taxCodeId: null,
        glAccount: '6111',
      },
    ],
  };
}

function makeSummary(
  details: InvoiceLineMatchDetail[],
  overrides: Partial<MatchSummary> = {},
): MatchSummary {
  return {
    totalLinesMatched: details.filter((d) => d.result === 'OK').length,
    totalLinesException: details.filter((d) => d.result !== 'OK').length,
    priceVarianceMax: Math.max(...details.map((d) => d.priceVariancePct), 0),
    qtyVarianceMax: Math.max(...details.map((d) => d.qtyVariancePct), 0),
    priceTolerancePct: 2,
    qtyTolerancePct: 5,
    details,
    ...overrides,
  };
}

const okDetail: InvoiceLineMatchDetail = {
  invoiceLineId: 'l-1',
  invoiceLineNumber: 1,
  poLineId: 'pol-1',
  qtyInvoiced: 10,
  qtyReceived: 10,
  qtyOrdered: 10,
  priceInvoiced: 10,
  priceOrdered: 10,
  priceVariancePct: 0,
  qtyVariancePct: 0,
  result: 'OK',
};

describe('MatchingResultPanel', () => {
  it('shows "Non rapproché" verdict when status is captured', () => {
    render(<MatchingResultPanel invoice={makeInvoice('captured')} summary={null} />);
    expect(screen.getByTestId('verdict-badge')).toHaveTextContent('Non rapproché');
    expect(screen.getByText(/Aucun matching/)).toBeInTheDocument();
  });

  it('shows "Match parfait" verdict when status=matched + all lines OK', () => {
    render(
      <MatchingResultPanel
        invoice={makeInvoice('matched')}
        summary={makeSummary([okDetail])}
      />,
    );
    expect(screen.getByTestId('verdict-badge')).toHaveTextContent('Match parfait');
    expect(screen.getByTestId('diff-table')).toBeInTheDocument();
  });

  it('shows "Écart bloquant" verdict when status=exception_price', () => {
    const exceptionDetail: InvoiceLineMatchDetail = {
      ...okDetail,
      priceInvoiced: 12,
      priceVariancePct: 20,
      result: 'EXCEPTION_PRICE',
      message: 'Price variance 20% > tolerance 2%',
    };
    render(
      <MatchingResultPanel
        invoice={makeInvoice('exception_price')}
        summary={makeSummary([exceptionDetail])}
      />,
    );
    expect(screen.getByTestId('verdict-badge')).toHaveTextContent('Écart bloquant');
  });

  it('shows "Toléré (forcé)" verdict when forcedMatch present in summary', () => {
    render(
      <MatchingResultPanel
        invoice={makeInvoice('matched')}
        summary={makeSummary([okDetail], {
          forcedMatch: {
            forcedBy: 'daf@pasteur.sn',
            forcedAt: '2026-05-15T12:00:00.000Z',
            reason: 'Écart de 3% accepté par le contrôle qualité',
            previousStatus: 'exception_price',
          },
        })}
      />,
    );
    expect(screen.getByTestId('verdict-badge')).toHaveTextContent('Toléré (forcé)');
    expect(screen.getByTestId('forced-match-trace')).toBeInTheDocument();
    expect(screen.getByTestId('forced-match-trace')).toHaveTextContent(/daf@pasteur\.sn/);
    expect(screen.getByTestId('forced-match-trace')).toHaveTextContent(
      /Écart de 3% accepté/,
    );
  });

  it('shows force-match button only when DAF + bloquant', async () => {
    const user = userEvent.setup();
    const onForceMatch = jest.fn();
    const exception: InvoiceLineMatchDetail = {
      ...okDetail,
      result: 'EXCEPTION_PRICE',
      priceVariancePct: 10,
    };
    render(
      <MatchingResultPanel
        invoice={makeInvoice('exception_price')}
        summary={makeSummary([exception])}
        showForceMatch
        onForceMatch={onForceMatch}
      />,
    );
    const btn = screen.getByTestId('force-match-btn');
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    expect(onForceMatch).toHaveBeenCalled();
  });

  it('hides force-match button when showForceMatch=false', () => {
    render(
      <MatchingResultPanel
        invoice={makeInvoice('exception_price')}
        summary={makeSummary([{ ...okDetail, result: 'EXCEPTION_PRICE' }])}
        showForceMatch={false}
      />,
    );
    expect(screen.queryByTestId('force-match-btn')).toBeNull();
  });

  it('renders 4 metrics with variance max highlighted when over tolerance', () => {
    render(
      <MatchingResultPanel
        invoice={makeInvoice('exception_price')}
        summary={makeSummary(
          [{ ...okDetail, result: 'EXCEPTION_PRICE', priceVariancePct: 15 }],
          { priceTolerancePct: 2, qtyTolerancePct: 5 },
        )}
      />,
    );
    expect(screen.getByText('Lignes OK')).toBeInTheDocument();
    expect(screen.getByText('Lignes en exception')).toBeInTheDocument();
    expect(screen.getByText('Variance prix max')).toBeInTheDocument();
    expect(screen.getByText('Variance qté max')).toBeInTheDocument();
  });
});
