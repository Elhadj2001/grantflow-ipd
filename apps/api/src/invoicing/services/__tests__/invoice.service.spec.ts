import { Prisma, InvoiceStatus } from '@prisma/client';
import type { Invoice, InvoiceLine } from '@prisma/client';
import { InvoiceService } from '../invoice.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';
import {
  EntityNotFoundException,
  InvoiceDuplicateNumberException,
  InvoiceNoPoLinkedException,
  InvoiceNotCapturableException,
  InvoiceNotEditableException,
  InvoiceNotRejectableException,
  MatchingEmptyInvoiceException,
  MatchingForceReasonRequiredException,
  PrNotOwnedException,
} from '../../../common/exceptions/business.exception';
import { useFakeDate, restoreRealDate } from '../../../test-utils/fake-time';

/**
 * Tests unitaires InvoiceService — Prisma + storage + OCR + matching mockés.
 * On vérifie principalement les chemins métier (validations, RBAC, statuts).
 */
describe('InvoiceService', () => {
  // US-062 (fix F22) : horloge figée → horodatages par défaut déterministes,
  // indépendants de la date d'exécution.
  beforeAll(() => useFakeDate('2026-06-15'));
  afterAll(() => restoreRealDate());

  type PrismaMock = {
    invoice: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    invoiceMatch: { findMany: jest.Mock };
    supplier: { findFirst: jest.Mock };
    purchaseOrder: { findUnique: jest.Mock; findFirst: jest.Mock };
    appUser: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };

  let prisma: PrismaMock;
  let storage: { putObject: jest.Mock; getObject: jest.Mock };
  let ocr: { extractFromPdf: jest.Mock };
  let matching: { matchInvoice: jest.Mock };
  let svc: InvoiceService;

  const invoiceId = 'inv00000-0000-0000-0000-000000000001';
  const supplierId = 'sup00000-0000-0000-0000-000000000010';
  const poId = 'po000000-0000-0000-0000-000000000020';
  const userOwn = 'usr00000-0000-0000-0000-000000000001';
  const otherUser = 'usr00000-0000-0000-0000-000000000002';

  const comptable: AuthenticatedUser = {
    id: 'kc-cpt', email: 'cpt@x', fullName: 'CPT', roles: ['COMPTABLE'],
  };
  const daf: AuthenticatedUser = {
    id: 'kc-daf', email: 'daf@x', fullName: 'DAF', roles: ['DAF'],
  };
  const demandeurOwner: AuthenticatedUser = {
    id: 'kc-do', email: 'd@x', fullName: 'D', roles: ['DEMANDEUR'],
  };
  const demandeurOther: AuthenticatedUser = {
    id: 'kc-do2', email: 'd2@x', fullName: 'D2', roles: ['DEMANDEUR'],
  };

  function makeInvoice(overrides: Partial<Invoice> = {}, lines: InvoiceLine[] = []): Invoice & { lines: InvoiceLine[] } {
    const base: Invoice = {
      id: invoiceId,
      invoiceNumber: 'INV-2026-001',
      supplierId,
      invoiceDate: new Date('2026-05-14'),
      dueDate: new Date('2026-06-13'),
      receivedAt: new Date(),
      status: InvoiceStatus.captured,
      totalHt: new Prisma.Decimal(100000),
      totalVat: new Prisma.Decimal(18000),
      totalTtc: new Prisma.Decimal(118000),
      currency: 'XOF',
      exchangeRate: null,
      poId,
      ocrConfidence: new Prisma.Decimal(85),
      pdfObjectKey: 'invoices/2026/05/abc.pdf',
      capturedPayload: null,
      rejectionReason: null,
      postedAt: null,
      createdAt: new Date(),
      matchedBy: null,
      matchedAt: null,
      matchSummary: null,
      // US-003-bis : colonnes multidevise ADR-005 (nullable, non testées ici).
      total_ht_xof: null,
      total_vat_xof: null,
      total_ttc_xof: null,
      fx_rate: null,
      fx_rate_date: null,
      ...overrides,
    };
    return { ...base, lines };
  }

  beforeEach(() => {
    prisma = {
      invoice: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      invoiceMatch: { findMany: jest.fn().mockResolvedValue([]) },
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: supplierId }) },
      purchaseOrder: {
        findUnique: jest.fn().mockResolvedValue({ id: poId }),
        findFirst: jest.fn().mockResolvedValue({ id: poId }),
      },
      appUser: {
        findUnique: jest.fn(({ where }: { where: { email: string } }) => {
          const map: Record<string, string> = {
            'cpt@x': 'app-cpt',
            'daf@x': 'app-daf',
            'd@x': userOwn,
            'd2@x': otherUser,
          };
          return Promise.resolve(map[where.email] ? { id: map[where.email] } : null);
        }),
        create: jest.fn(),
      },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
    };
    storage = {
      putObject: jest.fn().mockResolvedValue({ objectKey: 'invoices/2026/05/x.pdf' }),
      getObject: jest.fn().mockResolvedValue({ buffer: Buffer.from('%PDF-'), contentType: 'application/pdf' }),
    };
    ocr = {
      extractFromPdf: jest.fn().mockResolvedValue({
        rawText: 'Facture INV-2026-001 Total TTC: 118000 XOF',
        isImageScan: false,
        confidence: 85,
        fields: {
          invoiceNumber: 'INV-2026-001',
          invoiceDate: new Date('2026-05-14'),
          dueDate: new Date('2026-06-13'),
          totalHt: 100000, totalVat: 18000, totalTtc: 118000,
          currency: 'XOF', poReference: 'BC-2026-001',
        },
        fieldConfidence: { invoiceNumber: 95, totalTtc: 95 },
      }),
    };
    matching = {
      matchInvoice: jest.fn().mockResolvedValue({
        invoiceId, newStatus: InvoiceStatus.matched,
        summary: { totalLinesMatched: 1, totalLinesException: 0, priceVarianceMax: 0, qtyVarianceMax: 0, priceTolerancePct: 2, qtyTolerancePct: 5, details: [] },
      }),
    };
    const posting = {
      postInvoice: jest.fn(),
      cancelPosting: jest.fn(),
      listEntriesForInvoice: jest.fn().mockResolvedValue([]),
    };
    svc = new InvoiceService(
      prisma as unknown as PrismaService,
      storage as never,
      ocr as never,
      matching as never,
      posting as never,
    );
  });

  // ============================================================
  // uploadAndCapture
  // ============================================================
  describe('uploadAndCapture', () => {
    it('happy path : OCR → MinIO upload → invoice captured', async () => {
      // OCR ne retourne pas de supplierName : on passe le hint
      prisma.invoice.create.mockResolvedValue(makeInvoice());
      const res = await svc.uploadAndCapture(comptable, Buffer.from('%PDF-'), 'inv.pdf', { supplierId });
      expect(res.invoice.status).toBe(InvoiceStatus.captured);
      expect(res.pdfObjectKey).toMatch(/^invoices\/\d{4}\/\d{2}\//);
      expect(storage.putObject).toHaveBeenCalled();
      expect(ocr.extractFromPdf).toHaveBeenCalled();
    });

    it('uses hint.supplierId when OCR fails to identify supplier', async () => {
      ocr.extractFromPdf.mockResolvedValue({
        rawText: 'opaque', isImageScan: false, confidence: 50,
        fields: {}, fieldConfidence: {},
      });
      prisma.supplier.findFirst.mockResolvedValue(null);
      prisma.invoice.create.mockResolvedValue(makeInvoice());
      const res = await svc.uploadAndCapture(comptable, Buffer.from('%PDF-'), 'x.pdf', { supplierId });
      expect(res.invoice.supplierId).toBe(supplierId);
    });

    it('rejects when no supplier hint AND OCR cannot identify', async () => {
      ocr.extractFromPdf.mockResolvedValue({
        rawText: 'opaque', isImageScan: false, confidence: 50,
        fields: {}, fieldConfidence: {},
      });
      prisma.supplier.findFirst.mockResolvedValue(null);
      await expect(svc.uploadAndCapture(comptable, Buffer.from('%PDF-'), 'x.pdf'))
        .rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('rejects duplicate invoice number', async () => {
      prisma.invoice.findFirst.mockResolvedValue({ id: 'existing-inv' });
      await expect(svc.uploadAndCapture(comptable, Buffer.from('%PDF-'), 'x.pdf', { supplierId }))
        .rejects.toBeInstanceOf(InvoiceDuplicateNumberException);
    });

    it('auto-generates invoice number when OCR found none', async () => {
      ocr.extractFromPdf.mockResolvedValue({
        rawText: 'x', isImageScan: false, confidence: 50,
        fields: { totalTtc: 1000 }, fieldConfidence: {},
      });
      prisma.invoice.create.mockResolvedValue(makeInvoice());
      await svc.uploadAndCapture(comptable, Buffer.from('%PDF-'), 'x.pdf', { supplierId });
      const data = prisma.invoice.create.mock.calls[0][0].data;
      expect(data.invoiceNumber).toMatch(/^IMPORT-\d{4}-/);
    });

    it('falls back to status captured when OCR is image-scan (totals=0)', async () => {
      ocr.extractFromPdf.mockResolvedValue({
        rawText: '', isImageScan: true, confidence: 0,
        fields: {}, fieldConfidence: {},
      });
      prisma.invoice.create.mockResolvedValue(makeInvoice({ totalTtc: new Prisma.Decimal(0) }));
      const res = await svc.uploadAndCapture(comptable, Buffer.from('%PDF-'), 'x.pdf', { supplierId });
      expect(res.ocr.isImageScan).toBe(true);
    });

    // ----- US-077 (F-S8-04) — ligne de repli + warnings persistés -----

    it('US-077 : aucune ligne OCR + totalHt>0 → ligne de repli « Import global » créée', async () => {
      ocr.extractFromPdf.mockResolvedValue({
        rawText: 'x', isImageScan: false, confidence: 90,
        fields: { totalHt: 16400, totalVat: 2952, totalTtc: 19352 }, fieldConfidence: {},
      });
      prisma.invoice.create.mockResolvedValue(makeInvoice());
      await svc.uploadAndCapture(comptable, Buffer.from('%PDF-'), 'x.pdf', { supplierId });
      const data = prisma.invoice.create.mock.calls[0][0].data;
      expect(data.lines.create).toHaveLength(1);
      expect(data.lines.create[0]).toMatchObject({
        lineNumber: 1,
        description: 'Import global — détail non extrait (OCR)',
      });
      expect(Number(data.lines.create[0].lineTotal)).toBe(16400);
    });

    it('US-077 : totaux à 0 (image scan) → PAS de ligne de repli', async () => {
      ocr.extractFromPdf.mockResolvedValue({
        rawText: '', isImageScan: true, confidence: 0,
        fields: {}, fieldConfidence: {},
      });
      prisma.invoice.create.mockResolvedValue(makeInvoice({ totalTtc: new Prisma.Decimal(0) }));
      await svc.uploadAndCapture(comptable, Buffer.from('%PDF-'), 'x.pdf', { supplierId });
      const data = prisma.invoice.create.mock.calls[0][0].data;
      expect(data.lines).toBeUndefined();
    });

    it('US-077 : warnings OCR persistés dans capturedPayload (ocrWarnings)', async () => {
      ocr.extractFromPdf.mockResolvedValue({
        rawText: 'x', isImageScan: false, confidence: 45,
        fields: { totalHt: 16400, totalVat: 18, totalTtc: 19352 }, fieldConfidence: {},
        warnings: ['totals_inconsistent: HT(16400) + TVA(18) ≠ TTC(19352)'],
      });
      prisma.invoice.create.mockResolvedValue(makeInvoice());
      await svc.uploadAndCapture(comptable, Buffer.from('%PDF-'), 'x.pdf', { supplierId });
      const data = prisma.invoice.create.mock.calls[0][0].data;
      expect(data.capturedPayload.ocrWarnings).toHaveLength(1);
      expect(data.capturedPayload.ocrWarnings[0]).toMatch(/totals_inconsistent/);
    });
  });

  // ============================================================
  // createManual
  // ============================================================
  describe('createManual', () => {
    it('happy path', async () => {
      prisma.invoice.create.mockResolvedValue(makeInvoice());
      const res = await svc.createManual(comptable, {
        invoiceNumber: 'INV-MAN-001', supplierId,
        invoiceDate: new Date('2026-05-14'), dueDate: new Date('2026-06-13'),
        currency: 'XOF', totalHt: 100, totalVat: 18, totalTtc: 118,
        lines: [{ lineNumber: 1, description: 'X', lineTotal: 118 }],
      });
      expect(res.id).toBe(invoiceId);
    });

    it('rejects duplicate number', async () => {
      prisma.invoice.findFirst.mockResolvedValue({ id: 'dup' });
      await expect(svc.createManual(comptable, {
        invoiceNumber: 'INV-MAN-001', supplierId,
        invoiceDate: new Date(), dueDate: new Date(),
        currency: 'XOF', totalHt: 0, totalVat: 0, totalTtc: 1,
        lines: [{ lineNumber: 1, description: 'X', lineTotal: 1 }],
      })).rejects.toBeInstanceOf(InvoiceDuplicateNumberException);
    });
  });

  // ============================================================
  // update
  // ============================================================
  describe('update', () => {
    it('updates in captured status', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice());
      prisma.invoice.update.mockResolvedValue(makeInvoice({ totalTtc: new Prisma.Decimal(120000) }));
      const res = await svc.update(comptable, invoiceId, { totalTtc: 120000 });
      expect(Number(res.totalTtc)).toBe(120000);
    });

    it('rejects when invoice is matched (frozen)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({ status: InvoiceStatus.matched }));
      await expect(svc.update(comptable, invoiceId, { totalTtc: 1 }))
        .rejects.toBeInstanceOf(InvoiceNotEditableException);
    });

    it('rejects when invoice not found', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);
      await expect(svc.update(comptable, invoiceId, {}))
        .rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('rejects when changing supplier+number to conflict with existing', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice());
      prisma.invoice.findFirst.mockResolvedValue({ id: 'other-inv' });
      await expect(svc.update(comptable, invoiceId, { invoiceNumber: 'OTHER-001' }))
        .rejects.toBeInstanceOf(InvoiceDuplicateNumberException);
    });
  });

  // ============================================================
  // submitForMatching
  // ============================================================
  describe('submitForMatching', () => {
    it('happy path : captured + poId → matched', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice());
      prisma.invoice.update.mockResolvedValue(makeInvoice({ status: InvoiceStatus.matched }));
      const res = await svc.submitForMatching(comptable, invoiceId);
      expect(res.invoice.status).toBe(InvoiceStatus.matched);
      expect(matching.matchInvoice).toHaveBeenCalledWith(invoiceId);
    });

    it('rejects when status != captured', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({ status: InvoiceStatus.matched }));
      await expect(svc.submitForMatching(comptable, invoiceId))
        .rejects.toBeInstanceOf(InvoiceNotCapturableException);
    });

    it('rejects when no poId', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({ poId: null }));
      await expect(svc.submitForMatching(comptable, invoiceId))
        .rejects.toBeInstanceOf(InvoiceNoPoLinkedException);
    });

    it('US-078 (F-S8-06) : totaux nuls → 409 MATCHING_EMPTY_INVOICE (précondition codée)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(
        makeInvoice({ totalTtc: new Prisma.Decimal(0) }),
      );
      const err = await svc.submitForMatching(comptable, invoiceId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MatchingEmptyInvoiceException);
      expect((err as MatchingEmptyInvoiceException).details).toMatchObject({
        reason: 'zero_totals',
      });
      // Le moteur de matching n'est jamais sollicité.
      expect(matching.matchInvoice).not.toHaveBeenCalled();
    });

    it('persists matchSummary returned by MatchingService', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice());
      matching.matchInvoice.mockResolvedValue({
        invoiceId, newStatus: InvoiceStatus.exception_price,
        summary: { totalLinesMatched: 0, totalLinesException: 1, priceVarianceMax: 10, qtyVarianceMax: 0, priceTolerancePct: 2, qtyTolerancePct: 5, details: [] },
      });
      prisma.invoice.update.mockResolvedValue(makeInvoice({ status: InvoiceStatus.exception_price }));
      await svc.submitForMatching(comptable, invoiceId);
      const upd = prisma.invoice.update.mock.calls[0][0];
      expect(upd.data.status).toBe(InvoiceStatus.exception_price);
      expect(upd.data.matchSummary).toBeDefined();
    });
  });

  // ============================================================
  // forceMatch (DAF only)
  // ============================================================
  describe('forceMatch', () => {
    it('happy path : exception_price → matched + audit trail', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({ status: InvoiceStatus.exception_price }));
      prisma.invoice.update.mockResolvedValue(makeInvoice({ status: InvoiceStatus.matched }));
      const res = await svc.forceMatch(daf, invoiceId, { reason: 'remise négociée hors-contrat' });
      expect(res.status).toBe(InvoiceStatus.matched);
      const upd = prisma.invoice.update.mock.calls[0][0];
      const sum = upd.data.matchSummary as Record<string, unknown>;
      expect(sum.forcedMatch).toBeDefined();
      expect((sum.forcedMatch as Record<string, unknown>).reason).toBe('remise négociée hors-contrat');
    });

    it('rejects empty reason', async () => {
      await expect(svc.forceMatch(daf, invoiceId, { reason: '     ' }))
        .rejects.toBeInstanceOf(MatchingForceReasonRequiredException);
    });

    it('rejects when invoice is not in exception state', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({ status: InvoiceStatus.matched }));
      await expect(svc.forceMatch(daf, invoiceId, { reason: 'remise' }))
        .rejects.toBeInstanceOf(InvoiceNotCapturableException);
    });
  });

  // ============================================================
  // reject
  // ============================================================
  describe('reject', () => {
    it('happy path on captured', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice());
      prisma.invoice.update.mockResolvedValue(makeInvoice({ status: InvoiceStatus.rejected, rejectionReason: 'no service' }));
      const res = await svc.reject(comptable, invoiceId, { reason: 'no service rendu' });
      expect(res.status).toBe(InvoiceStatus.rejected);
    });

    it('rejects when invoice already paid', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({ status: InvoiceStatus.paid }));
      await expect(svc.reject(comptable, invoiceId, { reason: 'too late' }))
        .rejects.toBeInstanceOf(InvoiceNotRejectableException);
    });

    it('US-092 (F-S8-07) : facture POSTED non-rejetable (écritures orphelines sinon)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({ status: InvoiceStatus.posted }));
      await expect(svc.reject(comptable, invoiceId, { reason: 'erreur de saisie' }))
        .rejects.toBeInstanceOf(InvoiceNotRejectableException);
      // Chemin légitime : cancelPosting (extourne) d'abord — aucun write ici.
      expect(prisma.invoice.update).not.toHaveBeenCalled();
    });

    it('US-092 : facture PARTIALLY_PAID non-rejetable', async () => {
      prisma.invoice.findUnique.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.partially_paid }),
      );
      await expect(svc.reject(comptable, invoiceId, { reason: 'paiement partiel en cours' }))
        .rejects.toBeInstanceOf(InvoiceNotRejectableException);
    });
  });

  // ============================================================
  // RBAC
  // ============================================================
  describe('RBAC', () => {
    it('COMPTABLE sees any invoice', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice());
      await expect(svc.findOne(comptable, invoiceId)).resolves.toBeDefined();
    });

    it('DEMANDEUR owner sees own invoice (via PO ↔ DA chain)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice());
      prisma.purchaseOrder.findFirst.mockResolvedValue({ id: poId });
      await expect(svc.findOne(demandeurOwner, invoiceId)).resolves.toBeDefined();
    });

    it('DEMANDEUR non-owner gets 404 (obscurity)', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice());
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);
      await expect(svc.findOne(demandeurOther, invoiceId)).rejects.toBeInstanceOf(PrNotOwnedException);
    });

    it('findMany applies scope filter for DEMANDEUR', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.$transaction.mockResolvedValue([[], 0]);
      await svc.findMany(demandeurOwner, {
        page: 1, pageSize: 20, sort: 'createdAt', order: 'desc',
      } as never);
      // Le where doit contenir po.prLinks.some.pr.requestedBy
      const where = prisma.invoice.findMany.mock.calls[0][0].where;
      expect(where.po).toBeDefined();
    });

    it('findMany NO scope filter for COMPTABLE', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.$transaction.mockResolvedValue([[], 0]);
      await svc.findMany(comptable, {
        page: 1, pageSize: 20, sort: 'createdAt', order: 'desc',
      } as never);
      const where = prisma.invoice.findMany.mock.calls[0][0].where;
      expect(where.po).toBeUndefined();
    });
  });
});
