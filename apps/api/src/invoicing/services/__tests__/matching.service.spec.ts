import { Prisma, InvoiceStatus } from '@prisma/client';
import { MatchingService } from '../matching.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  EntityNotFoundException,
  InvoiceNoPoLinkedException,
  MatchingNoReceiptException,
} from '../../../common/exceptions/business.exception';

/**
 * Tests unitaires MatchingService — Prisma 100% mocké.
 *
 * Couverture :
 *  - OK exact (prix + qty parfaits)
 *  - Prix dans tolérance (1% < 2%) → OK
 *  - Prix hors tolérance (5% > 2%) → EXCEPTION_PRICE
 *  - Qty sur-réception (qty fact > qty reçue cumul) → EXCEPTION_QTY
 *  - Qty sous-réception (qty fact < qty reçue, hors tol) → EXCEPTION_QTY
 *  - Multi-lignes mix OK + EXCEPTION
 *  - Pas de GR complete → MATCHING_NO_RECEIPT
 *  - Pas de PO linked → INVOICE_NO_PO_LINKED
 *  - Invoice not found → EntityNotFoundException
 *  - Tolérances paramétrables (ConfigService)
 *  - Persiste les lignes invoice_match en base
 *  - Fuzzy match sur description quand poLineId absent
 *  - Re-run idempotent : supprime les matches précédents
 */
describe('MatchingService', () => {
  type PrismaMock = {
    invoice: { findUnique: jest.Mock };
    purchaseOrder: { findUnique: jest.Mock };
    goodsReceiptLine: { groupBy: jest.Mock };
    invoiceMatch: { findMany: jest.Mock; deleteMany: jest.Mock; create: jest.Mock };
  };

  let prisma: PrismaMock;
  let config: { get: jest.Mock };
  let svc: MatchingService;

  const invoiceId = 'inv00000-0000-0000-0000-000000000001';
  const poId = 'po000000-0000-0000-0000-000000000001';
  const poLine1 = 'pol00000-0000-0000-0000-000000000010';
  const poLine2 = 'pol00000-0000-0000-0000-000000000020';
  const il1 = 'il000000-0000-0000-0000-000000000100';
  const il2 = 'il000000-0000-0000-0000-000000000200';

  function makeInvoice(overrides: { lines?: unknown[]; poId?: string | null } = {}) {
    return {
      id: invoiceId,
      poId: overrides.poId === undefined ? poId : overrides.poId,
      invoiceNumber: 'INV-2026-001',
      currency: 'XOF',
      totalHt: new Prisma.Decimal(100000),
      totalVat: new Prisma.Decimal(0),
      totalTtc: new Prisma.Decimal(100000),
      lines: overrides.lines ?? [
        {
          id: il1, invoiceId, lineNumber: 1, poLineId: poLine1,
          description: 'Gants nitrile taille M', quantity: new Prisma.Decimal(10),
          unitPrice: new Prisma.Decimal(5000), lineTotal: new Prisma.Decimal(50000),
          taxCodeId: null, glAccount: null,
        },
      ],
    };
  }

  function makePo(overrides: { lines?: unknown[] } = {}) {
    return {
      id: poId, supplierId: 'sup-1', poNumber: 'BC-2026-001', currency: 'XOF',
      lines: overrides.lines ?? [
        {
          id: poLine1, poId, lineNumber: 1, description: 'Gants nitrile taille M',
          quantity: new Prisma.Decimal(10), quantityReceived: new Prisma.Decimal(10),
          quantityInvoiced: new Prisma.Decimal(0), unit: 'box',
          unitPrice: new Prisma.Decimal(5000), taxCodeId: null,
          lineTotal: new Prisma.Decimal(50000), budgetLineId: 'bl-1',
        },
      ],
    };
  }

  beforeEach(() => {
    prisma = {
      invoice: { findUnique: jest.fn() },
      purchaseOrder: { findUnique: jest.fn() },
      goodsReceiptLine: { groupBy: jest.fn().mockResolvedValue([{ poLineId: poLine1, _sum: { quantity: new Prisma.Decimal(10) } }]) },
      invoiceMatch: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    config = {
      get: jest.fn((key: string, def: string) => {
        if (key === 'INVOICE_MATCH_PRICE_TOLERANCE_PCT') return '2.0';
        if (key === 'INVOICE_MATCH_QTY_TOLERANCE_PCT') return '5.0';
        return def;
      }),
    };
    svc = new MatchingService(prisma as unknown as PrismaService, config as never);
  });

  // ----------------------------------------------------------------
  describe('preconditions', () => {
    it('rejects when invoice not found', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);
      await expect(svc.matchInvoice(invoiceId)).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('rejects when invoice has no poId', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({ poId: null }));
      await expect(svc.matchInvoice(invoiceId)).rejects.toBeInstanceOf(InvoiceNoPoLinkedException);
    });

    it('rejects when no GR complete found for PO', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice());
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      prisma.goodsReceiptLine.groupBy.mockResolvedValue([]);
      await expect(svc.matchInvoice(invoiceId)).rejects.toBeInstanceOf(MatchingNoReceiptException);
    });

    it('rejects when PO not found (deleted between invoice creation and match)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice());
      prisma.purchaseOrder.findUnique.mockResolvedValue(null);
      await expect(svc.matchInvoice(invoiceId)).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ----------------------------------------------------------------
  describe('happy path', () => {
    it('OK exact : prix + qty parfaits → status matched', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice());
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      const res = await svc.matchInvoice(invoiceId);
      expect(res.newStatus).toBe(InvoiceStatus.matched);
      expect(res.summary.totalLinesMatched).toBe(1);
      expect(res.summary.totalLinesException).toBe(0);
      expect(res.summary.details[0].result).toBe('OK');
      expect(res.summary.details[0].priceVariancePct).toBe(0);
    });

    it('prix dans la tolérance (1% < 2%) → matched', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({
        lines: [{
          id: il1, invoiceId, lineNumber: 1, poLineId: poLine1,
          description: 'Gants nitrile', quantity: new Prisma.Decimal(10),
          unitPrice: new Prisma.Decimal(5050), // +1% vs 5000
          lineTotal: new Prisma.Decimal(50500),
          taxCodeId: null, glAccount: null,
        }],
      }));
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      const res = await svc.matchInvoice(invoiceId);
      expect(res.newStatus).toBe(InvoiceStatus.matched);
      expect(res.summary.details[0].result).toBe('OK');
      expect(res.summary.details[0].priceVariancePct).toBe(1);
    });
  });

  // ----------------------------------------------------------------
  describe('exceptions', () => {
    it('prix hors tolérance (10% > 2%) → exception_price', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({
        lines: [{
          id: il1, invoiceId, lineNumber: 1, poLineId: poLine1,
          description: 'Gants', quantity: new Prisma.Decimal(10),
          unitPrice: new Prisma.Decimal(5500), // +10%
          lineTotal: new Prisma.Decimal(55000),
          taxCodeId: null, glAccount: null,
        }],
      }));
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      const res = await svc.matchInvoice(invoiceId);
      expect(res.newStatus).toBe(InvoiceStatus.exception_price);
      expect(res.summary.details[0].result).toBe('EXCEPTION_PRICE');
      expect(res.summary.priceVarianceMax).toBeCloseTo(10, 1);
    });

    it('sous-réception (qty facturée > qty reçue) → exception_qty', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({
        lines: [{
          id: il1, invoiceId, lineNumber: 1, poLineId: poLine1,
          description: 'Gants', quantity: new Prisma.Decimal(10),
          unitPrice: new Prisma.Decimal(5000), lineTotal: new Prisma.Decimal(50000),
          taxCodeId: null, glAccount: null,
        }],
      }));
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      // Seules 6 unités reçues
      prisma.goodsReceiptLine.groupBy.mockResolvedValue([
        { poLineId: poLine1, _sum: { quantity: new Prisma.Decimal(6) } },
      ]);
      const res = await svc.matchInvoice(invoiceId);
      expect(res.newStatus).toBe(InvoiceStatus.exception_qty);
      expect(res.summary.details[0].result).toBe('EXCEPTION_QTY');
      expect(res.summary.details[0].message).toMatch(/Under-reception/);
    });

    it('sur-réception au-delà de la tolérance qty (variance 20% > 5%) → exception_qty', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({
        lines: [{
          id: il1, invoiceId, lineNumber: 1, poLineId: poLine1,
          description: 'Gants', quantity: new Prisma.Decimal(8), // facturé 8
          unitPrice: new Prisma.Decimal(5000), lineTotal: new Prisma.Decimal(40000),
          taxCodeId: null, glAccount: null,
        }],
      }));
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      prisma.goodsReceiptLine.groupBy.mockResolvedValue([
        { poLineId: poLine1, _sum: { quantity: new Prisma.Decimal(10) } }, // reçu 10
      ]);
      const res = await svc.matchInvoice(invoiceId);
      expect(res.newStatus).toBe(InvoiceStatus.exception_qty);
      expect(res.summary.details[0].result).toBe('EXCEPTION_QTY');
      expect(res.summary.details[0].qtyVariancePct).toBe(20);
    });

    it('priorité prix > qty quand les deux sont en exception', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({
        lines: [{
          id: il1, invoiceId, lineNumber: 1, poLineId: poLine1,
          description: 'Gants', quantity: new Prisma.Decimal(20), // facturé 20 (reçu 10)
          unitPrice: new Prisma.Decimal(6000), // prix +20%
          lineTotal: new Prisma.Decimal(120000),
          taxCodeId: null, glAccount: null,
        }],
      }));
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      const res = await svc.matchInvoice(invoiceId);
      expect(res.newStatus).toBe(InvoiceStatus.exception_price); // prix l'emporte
      expect(res.summary.details[0].result).toBe('EXCEPTION_PRICE');
    });

    it('multi-lignes : 1 OK + 1 EXCEPTION_PRICE → status exception_price global', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({
        lines: [
          {
            id: il1, invoiceId, lineNumber: 1, poLineId: poLine1,
            description: 'Gants', quantity: new Prisma.Decimal(10),
            unitPrice: new Prisma.Decimal(5000), lineTotal: new Prisma.Decimal(50000),
            taxCodeId: null, glAccount: null,
          },
          {
            id: il2, invoiceId, lineNumber: 2, poLineId: poLine2,
            description: 'Pipettes', quantity: new Prisma.Decimal(5),
            unitPrice: new Prisma.Decimal(12000), // +20% vs 10000
            lineTotal: new Prisma.Decimal(60000),
            taxCodeId: null, glAccount: null,
          },
        ],
      }));
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({
        lines: [
          {
            id: poLine1, poId, lineNumber: 1, description: 'Gants',
            quantity: new Prisma.Decimal(10), quantityReceived: new Prisma.Decimal(10),
            quantityInvoiced: new Prisma.Decimal(0), unit: 'box',
            unitPrice: new Prisma.Decimal(5000), taxCodeId: null,
            lineTotal: new Prisma.Decimal(50000), budgetLineId: 'bl-1',
          },
          {
            id: poLine2, poId, lineNumber: 2, description: 'Pipettes',
            quantity: new Prisma.Decimal(5), quantityReceived: new Prisma.Decimal(5),
            quantityInvoiced: new Prisma.Decimal(0), unit: 'unit',
            unitPrice: new Prisma.Decimal(10000), taxCodeId: null,
            lineTotal: new Prisma.Decimal(50000), budgetLineId: 'bl-1',
          },
        ],
      }));
      prisma.goodsReceiptLine.groupBy.mockResolvedValue([
        { poLineId: poLine1, _sum: { quantity: new Prisma.Decimal(10) } },
        { poLineId: poLine2, _sum: { quantity: new Prisma.Decimal(5) } },
      ]);
      const res = await svc.matchInvoice(invoiceId);
      expect(res.newStatus).toBe(InvoiceStatus.exception_price);
      expect(res.summary.totalLinesMatched).toBe(1);
      expect(res.summary.totalLinesException).toBe(1);
    });
  });

  // ----------------------------------------------------------------
  describe('tolerances and side effects', () => {
    it('respecte la tolérance prix configurée à 5%', async () => {
      config.get.mockImplementation((key: string, def: string) => {
        if (key === 'INVOICE_MATCH_PRICE_TOLERANCE_PCT') return '5.0';
        if (key === 'INVOICE_MATCH_QTY_TOLERANCE_PCT') return '5.0';
        return def;
      });
      svc = new MatchingService(prisma as unknown as PrismaService, config as never);
      // +4% prix : OK avec tol 5%, KO avec tol 2%
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({
        lines: [{
          id: il1, invoiceId, lineNumber: 1, poLineId: poLine1,
          description: 'Gants', quantity: new Prisma.Decimal(10),
          unitPrice: new Prisma.Decimal(5200),
          lineTotal: new Prisma.Decimal(52000),
          taxCodeId: null, glAccount: null,
        }],
      }));
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      const res = await svc.matchInvoice(invoiceId);
      expect(res.newStatus).toBe(InvoiceStatus.matched);
    });

    it('persiste une ligne invoice_match par invoice_line', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice());
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      await svc.matchInvoice(invoiceId);
      expect(prisma.invoiceMatch.create).toHaveBeenCalledTimes(1);
      const arg = prisma.invoiceMatch.create.mock.calls[0][0];
      expect(arg.data.invoiceLineId).toBe(il1);
      expect(arg.data.poLineId).toBe(poLine1);
      expect(arg.data.matchResult).toBe('OK');
    });

    it('re-run : supprime les matches précédents (idempotent)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice());
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      prisma.invoiceMatch.findMany.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }]);
      await svc.matchInvoice(invoiceId);
      expect(prisma.invoiceMatch.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['old-1', 'old-2'] } },
      });
    });

    it('fuzzy match sur description quand po_line_id absent', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({
        lines: [{
          id: il1, invoiceId, lineNumber: 1, poLineId: null, // pas de lien direct
          description: 'gants nitrile taille M latex-free',
          quantity: new Prisma.Decimal(10), unitPrice: new Prisma.Decimal(5000),
          lineTotal: new Prisma.Decimal(50000),
          taxCodeId: null, glAccount: null,
        }],
      }));
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      const res = await svc.matchInvoice(invoiceId);
      expect(res.summary.details[0].result).toBe('OK');
      expect(res.summary.details[0].poLineId).toBe(poLine1);
    });

    it('ligne fact sans correspondance PO → UNMATCHED_INVOICE_LINE', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({
        lines: [{
          id: il1, invoiceId, lineNumber: 1, poLineId: null,
          description: 'completely unrelated item xyz',
          quantity: new Prisma.Decimal(1), unitPrice: new Prisma.Decimal(100),
          lineTotal: new Prisma.Decimal(100),
          taxCodeId: null, glAccount: null,
        }],
      }));
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      const res = await svc.matchInvoice(invoiceId);
      expect(res.newStatus).toBe(InvoiceStatus.exception_qty); // UNMATCHED tombe dans le bucket qty
      expect(res.summary.details[0].result).toBe('UNMATCHED_INVOICE_LINE');
    });
  });
});
