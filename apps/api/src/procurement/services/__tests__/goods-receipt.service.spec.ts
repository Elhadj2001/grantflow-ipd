import { Prisma, PoStatus, GrStatus } from '@prisma/client';
import type { GoodsReceipt, GoodsReceiptLine, PurchaseOrder, PurchaseOrderLine } from '@prisma/client';
import { GoodsReceiptService } from '../goods-receipt.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';
import {
  BatchInfoRequiredException,
  ColdChainBrokenException,
  EntityNotFoundException,
  GrAlreadyCompleteException,
  GrEmptyLinesException,
  GrLineNotFoundException,
  GrNotCancellableException,
  GrNotEditableException,
  GrNotRejectableException,
  GrQtyExceedsOrderException,
  PoNotReceivableException,
  PrNotOwnedException,
  RejectionReasonMissingException,
} from '../../../common/exceptions/business.exception';

/**
 * Tests unitaires du GoodsReceiptService.
 *
 * On mock entièrement Prisma : pas de DB. Le but est de verrouiller la
 * logique métier (validations cumul, chaîne du froid, propagation au PO,
 * RBAC scope).
 */
describe('GoodsReceiptService', () => {
  type Prismarized = {
    purchaseOrder: { findUnique: jest.Mock; update: jest.Mock };
    purchaseOrderLine: { findMany: jest.Mock; update: jest.Mock };
    purchaseOrderPr: { findFirst: jest.Mock };
    goodsReceipt: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    goodsReceiptLine: { update: jest.Mock; groupBy: jest.Mock };
    appUser: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
    $executeRawUnsafe: jest.Mock;
  };

  let prisma: Prismarized;
  let svc: GoodsReceiptService;

  const userOwn = 'usr00000-0000-0000-0000-000000000001';
  const otherUser = 'usr00000-0000-0000-0000-000000000002';
  const poId = 'po000000-0000-0000-0000-000000000010';
  const poLine1 = 'pol00000-0000-0000-0000-000000000011';
  const poLine2 = 'pol00000-0000-0000-0000-000000000012';
  const grId = 'gr000000-0000-0000-0000-000000000020';
  const grLine1 = 'grl00000-0000-0000-0000-000000000021';
  const grLine2 = 'grl00000-0000-0000-0000-000000000022';

  const magasinier: AuthenticatedUser = {
    id: 'kc-mag', email: 'mag@x', fullName: 'Mag', roles: ['MAGASINIER'],
  };
  const demandeurOwner: AuthenticatedUser = {
    id: 'kc-do', email: 'd@x', fullName: 'D', roles: ['DEMANDEUR'],
  };
  const demandeurOther: AuthenticatedUser = {
    id: 'kc-do2', email: 'd2@x', fullName: 'D2', roles: ['DEMANDEUR'],
  };

  function makePo(overrides: Partial<PurchaseOrder> = {}, lines: Partial<PurchaseOrderLine>[] = []): PurchaseOrder & { lines: PurchaseOrderLine[] } {
    const base: PurchaseOrder = {
      id: poId,
      poNumber: 'BC-2026-0001',
      prId: 'pr-1',
      supplierId: 'sup-1',
      orderDate: new Date(),
      expectedDate: null,
      status: PoStatus.sent,
      totalHt: new Prisma.Decimal('100000'),
      totalVat: new Prisma.Decimal('0'),
      totalTtc: new Prisma.Decimal('100000'),
      currency: 'XOF',
      incoterm: null,
      deliveryAddress: null,
      buyerId: null,
      sentAt: new Date(),
      acknowledgedAt: null,
      acknowledgedBy: null,
      cancelledAt: null,
      cancellationReason: null,
      pdfObjectKey: 'pos/2026/05/po-id.pdf',
      emailSentAt: null,
      emailSentTo: null,
      createdAt: new Date(),
      // US-003-bis : colonnes multidevise ADR-005 (nullable, non testées ici).
      total_ht_xof: null,
      total_vat_xof: null,
      total_ttc_xof: null,
      fx_rate: null,
      fx_rate_date: null,
      ...overrides,
    };
    const defaultLines: PurchaseOrderLine[] = [
      {
        id: poLine1, poId: base.id, prLineId: null, lineNumber: 1,
        description: 'Gants nitrile', quantity: new Prisma.Decimal('10'),
        quantityReceived: new Prisma.Decimal('0'), quantityInvoiced: new Prisma.Decimal('0'),
        unit: 'box', unitPrice: new Prisma.Decimal('5000'),
        taxCodeId: null, lineTotal: new Prisma.Decimal('50000'),
        budgetLineId: 'bl-1',
        unit_price_xof: null, fx_rate: null, fx_rate_date: null,
      },
      {
        id: poLine2, poId: base.id, prLineId: null, lineNumber: 2,
        description: 'Pipettes', quantity: new Prisma.Decimal('5'),
        quantityReceived: new Prisma.Decimal('0'), quantityInvoiced: new Prisma.Decimal('0'),
        unit: 'unit', unitPrice: new Prisma.Decimal('10000'),
        taxCodeId: null, lineTotal: new Prisma.Decimal('50000'),
        budgetLineId: 'bl-1',
        unit_price_xof: null, fx_rate: null, fx_rate_date: null,
      },
    ];
    const merged = lines.length > 0
      ? defaultLines.map((d, i) => ({ ...d, ...(lines[i] ?? {}) }))
      : defaultLines;
    return { ...base, lines: merged };
  }

  function makeGr(overrides: Partial<GoodsReceipt> = {}, lines: Partial<GoodsReceiptLine>[] = []): GoodsReceipt & { lines: Array<GoodsReceiptLine & { poLine?: PurchaseOrderLine }> } {
    const base: GoodsReceipt = {
      id: grId,
      grNumber: 'GR-2026-0001',
      poId,
      receiptDate: new Date(),
      receivedBy: 'app-mag',
      status: GrStatus.draft,
      deliveryNoteRef: null,
      notes: null,
      coldChainRequired: false,
      rejectedReason: null,
      rejectedAt: null,
      rejectedBy: null,
      cancelledAt: null,
      cancelledReason: null,
      cancelledBy: null,
      completedAt: null,
      completedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    const defaultLines: Array<GoodsReceiptLine & { poLine: PurchaseOrderLine }> = [
      {
        id: grLine1, grId: base.id, poLineId: poLine1,
        quantity: new Prisma.Decimal('0'),
        batchNumber: null, expiryDate: null, serialNumbers: [],
        qualityCheck: null, coldChainOk: null,
        poLine: {
          id: poLine1, poId, prLineId: null, lineNumber: 1,
          description: 'Gants nitrile', quantity: new Prisma.Decimal('10'),
          quantityReceived: new Prisma.Decimal('0'), quantityInvoiced: new Prisma.Decimal('0'),
          unit: 'box', unitPrice: new Prisma.Decimal('5000'),
          taxCodeId: null, lineTotal: new Prisma.Decimal('50000'), budgetLineId: 'bl-1',
          unit_price_xof: null, fx_rate: null, fx_rate_date: null,
        },
      },
      {
        id: grLine2, grId: base.id, poLineId: poLine2,
        quantity: new Prisma.Decimal('0'),
        batchNumber: null, expiryDate: null, serialNumbers: [],
        qualityCheck: null, coldChainOk: null,
        poLine: {
          id: poLine2, poId, prLineId: null, lineNumber: 2,
          description: 'Pipettes', quantity: new Prisma.Decimal('5'),
          quantityReceived: new Prisma.Decimal('0'), quantityInvoiced: new Prisma.Decimal('0'),
          unit: 'unit', unitPrice: new Prisma.Decimal('10000'),
          taxCodeId: null, lineTotal: new Prisma.Decimal('50000'), budgetLineId: 'bl-1',
          unit_price_xof: null, fx_rate: null, fx_rate_date: null,
        },
      },
    ];
    const merged = lines.length > 0
      ? defaultLines.map((d, i) => ({ ...d, ...(lines[i] ?? {}) }))
      : defaultLines;
    return { ...base, lines: merged };
  }

  beforeEach(() => {
    prisma = {
      purchaseOrder: {
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...makePo(), ...data })),
      },
      purchaseOrderLine: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      purchaseOrderPr: { findFirst: jest.fn().mockResolvedValue({ poId }) },
      goodsReceipt: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...makeGr(), ...data })),
      },
      goodsReceiptLine: {
        update: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      appUser: {
        findUnique: jest.fn(({ where }: { where: { email: string } }) => {
          const map: Record<string, string> = {
            'mag@x': 'app-mag', 'd@x': userOwn, 'd2@x': otherUser,
          };
          return Promise.resolve(map[where.email] ? { id: map[where.email] } : null);
        }),
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb: unknown) => {
        if (typeof cb === 'function') return (cb as (tx: unknown) => unknown)(prisma);
        return Promise.all(cb as unknown[]);
      }),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    svc = new GoodsReceiptService(prisma as unknown as PrismaService);
  });

  // ============================================================
  // createFromPo
  // ============================================================
  describe('createFromPo', () => {
    it('happy path : creates GR draft with quantity=0 lines', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      prisma.goodsReceipt.create.mockResolvedValue({ ...makeGr(), lines: [
        { id: grLine1, grId, poLineId: poLine1, quantity: new Prisma.Decimal('0'), batchNumber: null, expiryDate: null, serialNumbers: [], qualityCheck: null, coldChainOk: null },
        { id: grLine2, grId, poLineId: poLine2, quantity: new Prisma.Decimal('0'), batchNumber: null, expiryDate: null, serialNumbers: [], qualityCheck: null, coldChainOk: null },
      ] });

      const res = await svc.createFromPo(magasinier, poId, {});

      expect(res.grNumber).toMatch(/^GR-\d{4}-\d{4}$/);
      expect(res.status).toBe(GrStatus.draft);
      expect(res.lines).toHaveLength(2);
      const create = prisma.goodsReceipt.create.mock.calls[0][0].data;
      expect(create.lines.create).toEqual([
        { poLineId: poLine1, quantity: new Prisma.Decimal(0) },
        { poLineId: poLine2, quantity: new Prisma.Decimal(0) },
      ]);
    });

    it('rejects PO not found', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(null);
      await expect(svc.createFromPo(magasinier, poId, {})).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('rejects PO in draft (not yet sent)', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.draft }));
      await expect(svc.createFromPo(magasinier, poId, {})).rejects.toBeInstanceOf(PoNotReceivableException);
    });

    it('rejects PO cancelled', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.cancelled }));
      await expect(svc.createFromPo(magasinier, poId, {})).rejects.toBeInstanceOf(PoNotReceivableException);
    });

    it('accepts PO in partially_received (second GR)', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo({ status: PoStatus.partially_received }));
      prisma.goodsReceipt.create.mockResolvedValue({ ...makeGr(), lines: [] });
      await expect(svc.createFromPo(magasinier, poId, {})).resolves.toBeDefined();
    });

    it('persists coldChainRequired flag', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      prisma.goodsReceipt.create.mockResolvedValue({ ...makeGr({ coldChainRequired: true }), lines: [] });
      await svc.createFromPo(magasinier, poId, { coldChainRequired: true });
      const data = prisma.goodsReceipt.create.mock.calls[0][0].data;
      expect(data.coldChainRequired).toBe(true);
    });
  });

  // ============================================================
  // update (header)
  // ============================================================
  describe('update header', () => {
    it('happy path : patch notes and date when draft', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr());
      prisma.goodsReceipt.update.mockResolvedValue({ ...makeGr({ notes: 'updated' }), lines: [] });
      const res = await svc.update(magasinier, grId, { notes: 'updated' });
      expect(res.notes).toBe('updated');
    });

    it('rejects when GR is complete', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr({ status: GrStatus.complete }));
      await expect(svc.update(magasinier, grId, { notes: 'x' })).rejects.toBeInstanceOf(GrNotEditableException);
    });

    it('rejects when GR not found', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(null);
      await expect(svc.update(magasinier, grId, {})).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ============================================================
  // updateLines
  // ============================================================
  describe('updateLines', () => {
    it('happy path : updates quantities and batch info', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr());
      prisma.goodsReceipt.findUniqueOrThrow.mockResolvedValue({ ...makeGr(), lines: [] });
      await svc.updateLines(magasinier, grId, {
        lines: [
          { lineId: grLine1, quantity: 8, batchNumber: 'LOT-A', expiryDate: new Date('2027-01-01') },
          { lineId: grLine2, quantity: 5 },
        ],
      });
      expect(prisma.goodsReceiptLine.update).toHaveBeenCalledTimes(2);
    });

    it('rejects unknown lineId', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr());
      await expect(
        svc.updateLines(magasinier, grId, { lines: [{ lineId: 'unknown-id', quantity: 1 }] }),
      ).rejects.toBeInstanceOf(GrLineNotFoundException);
    });

    it('rejects quantity > ordered', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr());
      await expect(
        svc.updateLines(magasinier, grId, { lines: [{ lineId: grLine1, quantity: 999 }] }),
      ).rejects.toBeInstanceOf(GrQtyExceedsOrderException);
    });

    it('rejects quantity + other completed > ordered', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr());
      // 6 déjà reçus ailleurs + nouvelle qty 5 = 11 > 10 ordered
      prisma.goodsReceiptLine.groupBy.mockResolvedValue([{ poLineId: poLine1, _sum: { quantity: new Prisma.Decimal('6') } }]);
      await expect(
        svc.updateLines(magasinier, grId, { lines: [{ lineId: grLine1, quantity: 5 }] }),
      ).rejects.toBeInstanceOf(GrQtyExceedsOrderException);
    });

    it('rejects edit when GR is rejected', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr({ status: GrStatus.rejected }));
      await expect(
        svc.updateLines(magasinier, grId, { lines: [{ lineId: grLine1, quantity: 1 }] }),
      ).rejects.toBeInstanceOf(GrNotEditableException);
    });

    it('allows partial PATCH (only batch, no quantity change)', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr());
      prisma.goodsReceipt.findUniqueOrThrow.mockResolvedValue({ ...makeGr(), lines: [] });
      await svc.updateLines(magasinier, grId, {
        lines: [{ lineId: grLine1, batchNumber: 'LOT-X' }],
      });
      const call = prisma.goodsReceiptLine.update.mock.calls[0][0];
      expect(call.data.batchNumber).toBe('LOT-X');
      expect(call.data.quantity).toBeUndefined();
    });
  });

  // ============================================================
  // complete
  // ============================================================
  describe('complete', () => {
    it('happy path partial : updates qty + sets PO partially_received', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr({}, [
        { id: grLine1, quantity: new Prisma.Decimal('5') }, // partiel 5/10
        { id: grLine2, quantity: new Prisma.Decimal('0') }, // rien
      ]));
      prisma.purchaseOrderLine.findMany.mockResolvedValue([
        { quantity: new Prisma.Decimal('10'), quantityReceived: new Prisma.Decimal('5') },
        { quantity: new Prisma.Decimal('5'), quantityReceived: new Prisma.Decimal('0') },
      ]);
      const res = await svc.complete(magasinier, grId);
      expect(res.poStatus).toBe(PoStatus.partially_received);
      expect(res.totalReceivedLines).toBe(1);
      expect(prisma.purchaseOrderLine.update).toHaveBeenCalledTimes(1); // 1 ligne reçue
    });

    it('happy path total : sets PO received when every line is fully covered', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr({}, [
        { id: grLine1, quantity: new Prisma.Decimal('10') },
        { id: grLine2, quantity: new Prisma.Decimal('5') },
      ]));
      prisma.purchaseOrderLine.findMany.mockResolvedValue([
        { quantity: new Prisma.Decimal('10'), quantityReceived: new Prisma.Decimal('10') },
        { quantity: new Prisma.Decimal('5'), quantityReceived: new Prisma.Decimal('5') },
      ]);
      const res = await svc.complete(magasinier, grId);
      expect(res.poStatus).toBe(PoStatus.received);
      expect(res.totalReceivedLines).toBe(2);
    });

    it('rejects when no line has quantity > 0', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr());
      await expect(svc.complete(magasinier, grId)).rejects.toBeInstanceOf(GrEmptyLinesException);
    });

    it('rejects when GR already complete', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr({ status: GrStatus.complete }));
      await expect(svc.complete(magasinier, grId)).rejects.toBeInstanceOf(GrAlreadyCompleteException);
    });

    it('rejects when GR is cancelled', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr({ status: GrStatus.cancelled }));
      await expect(svc.complete(magasinier, grId)).rejects.toBeInstanceOf(GrNotEditableException);
    });

    it('cold chain : rejects if batch missing on biomedical line', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr({ coldChainRequired: true }, [
        { id: grLine1, quantity: new Prisma.Decimal('5'), batchNumber: null, expiryDate: null, coldChainOk: true },
        { id: grLine2, quantity: new Prisma.Decimal('0') },
      ]));
      await expect(svc.complete(magasinier, grId)).rejects.toBeInstanceOf(BatchInfoRequiredException);
    });

    it('cold chain : rejects if cold_chain_ok=false on any received line', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr({ coldChainRequired: true }, [
        { id: grLine1, quantity: new Prisma.Decimal('5'),
          batchNumber: 'LOT-A', expiryDate: new Date('2027-01-01'), coldChainOk: false },
        { id: grLine2, quantity: new Prisma.Decimal('0') },
      ]));
      await expect(svc.complete(magasinier, grId)).rejects.toBeInstanceOf(ColdChainBrokenException);
    });

    it('cold chain : passes when batch + expiry + ok present', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr({ coldChainRequired: true }, [
        { id: grLine1, quantity: new Prisma.Decimal('5'),
          batchNumber: 'LOT-A', expiryDate: new Date('2027-01-01'), coldChainOk: true },
        { id: grLine2, quantity: new Prisma.Decimal('0') },
      ]));
      prisma.purchaseOrderLine.findMany.mockResolvedValue([
        { quantity: new Prisma.Decimal('10'), quantityReceived: new Prisma.Decimal('5') },
        { quantity: new Prisma.Decimal('5'), quantityReceived: new Prisma.Decimal('0') },
      ]);
      const res = await svc.complete(magasinier, grId);
      expect(res.poStatus).toBe(PoStatus.partially_received);
    });

    it('re-checks overflow at complete time (concurrence)', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr({}, [
        { id: grLine1, quantity: new Prisma.Decimal('5') },
      ]));
      // Une autre GR a été completée entretemps avec qty=8 → 8+5=13 > 10
      prisma.goodsReceiptLine.groupBy.mockResolvedValue([
        { poLineId: poLine1, _sum: { quantity: new Prisma.Decimal('8') } },
      ]);
      await expect(svc.complete(magasinier, grId)).rejects.toBeInstanceOf(GrQtyExceedsOrderException);
    });
  });

  // ============================================================
  // cancel
  // ============================================================
  describe('cancel', () => {
    it('happy path on draft', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr());
      prisma.goodsReceipt.update.mockResolvedValue(makeGr({ status: GrStatus.cancelled, cancelledReason: 'erreur' }));
      const res = await svc.cancel(magasinier, grId, { reason: 'erreur saisie' });
      expect(res.status).toBe(GrStatus.cancelled);
    });

    it('rejects when not draft', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr({ status: GrStatus.complete }));
      await expect(svc.cancel(magasinier, grId, { reason: 'too late' })).rejects.toBeInstanceOf(GrNotCancellableException);
    });
  });

  // ============================================================
  // reject
  // ============================================================
  describe('reject', () => {
    it('happy path : refuses delivery, status = rejected', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr());
      prisma.goodsReceipt.update.mockResolvedValue(makeGr({ status: GrStatus.rejected, rejectedReason: 'qty KO' }));
      const res = await svc.reject(magasinier, grId, { reason: 'mauvais produit livré' });
      expect(res.status).toBe(GrStatus.rejected);
    });

    it('rejects when reason is whitespace only', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr());
      await expect(svc.reject(magasinier, grId, { reason: '     ' })).rejects.toBeInstanceOf(RejectionReasonMissingException);
    });

    it('rejects when GR not draft', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr({ status: GrStatus.complete }));
      await expect(svc.reject(magasinier, grId, { reason: 'late' })).rejects.toBeInstanceOf(GrNotRejectableException);
    });
  });

  // ============================================================
  // findOne / findMany / RBAC
  // ============================================================
  describe('RBAC scope', () => {
    it('MAGASINIER sees any GR', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr());
      await expect(svc.findOne(magasinier, grId)).resolves.toBeDefined();
    });

    it('DEMANDEUR owner of linked PR sees the GR', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr());
      prisma.purchaseOrderPr.findFirst.mockResolvedValue({ poId });
      await expect(svc.findOne(demandeurOwner, grId)).resolves.toBeDefined();
    });

    it('DEMANDEUR non-owner gets 404 (obscurity)', async () => {
      prisma.goodsReceipt.findUnique.mockResolvedValue(makeGr());
      prisma.purchaseOrderPr.findFirst.mockResolvedValue(null);
      await expect(svc.findOne(demandeurOther, grId)).rejects.toBeInstanceOf(PrNotOwnedException);
    });

    it('findMany applies scope filter for DEMANDEUR', async () => {
      prisma.goodsReceipt.findMany.mockResolvedValue([]);
      prisma.goodsReceipt.count.mockResolvedValue(0);
      await svc.findMany(demandeurOwner, {
        page: 1, pageSize: 20, sort: 'createdAt', order: 'desc',
      } as never);
      const where = prisma.goodsReceipt.findMany.mock.calls[0][0].where;
      expect(where.po).toBeDefined();
    });

    it('findMany NO scope filter for MAGASINIER', async () => {
      prisma.goodsReceipt.findMany.mockResolvedValue([]);
      prisma.goodsReceipt.count.mockResolvedValue(0);
      await svc.findMany(magasinier, {
        page: 1, pageSize: 20, sort: 'createdAt', order: 'desc',
      } as never);
      const where = prisma.goodsReceipt.findMany.mock.calls[0][0].where;
      expect(where.po).toBeUndefined();
    });
  });

  // ============================================================
  // remainingForPo
  // ============================================================
  describe('remainingForPo', () => {
    it('returns ordered/received/remaining per po_line', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(
        makePo({}, [
          { quantityReceived: new Prisma.Decimal('3') },
          { quantityReceived: new Prisma.Decimal('5') },
        ]),
      );
      const res = await svc.remainingForPo(magasinier, poId);
      expect(res).toEqual([
        { poLineId: poLine1, lineNumber: 1, description: 'Gants nitrile', unit: 'box', ordered: 10, received: 3, remaining: 7 },
        { poLineId: poLine2, lineNumber: 2, description: 'Pipettes', unit: 'unit', ordered: 5, received: 5, remaining: 0 },
      ]);
    });
  });

  // ============================================================
  // GR number sequence
  // ============================================================
  describe('GR number sequence', () => {
    it('generates GR-YYYY-NNNN format', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(makePo());
      prisma.goodsReceipt.count.mockResolvedValue(7);
      prisma.goodsReceipt.create.mockResolvedValue({ ...makeGr(), lines: [] });
      await svc.createFromPo(magasinier, poId, {});
      const created = prisma.goodsReceipt.create.mock.calls[0][0].data;
      const year = new Date().getFullYear();
      expect(created.grNumber).toBe(`GR-${year}-0008`);
    });
  });
});
