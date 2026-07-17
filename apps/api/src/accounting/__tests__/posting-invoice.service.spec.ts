import { Prisma, InvoiceStatus, EntryStatus, JournalType, PoStatus } from '@prisma/client';
import { PostingService } from '../services/posting.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExchangeRateService } from '../../referential/exchange-rate/exchange-rate.service';
import {
  EntityNotFoundException,
  ExchangeRateMissingException,
  GlAccountNotFoundException,
  InvoiceAlreadyPostedException,
  InvoiceNoLinesNotPostableException,
  InvoiceNotPostableException,
  PeriodClosedException,
  PostingCancelReasonRequiredException,
} from '../../common/exceptions/business.exception';
import { useFakeDate, restoreRealDate } from '../../test-utils/fake-time';

/**
 * Tests unitaires PostingService — sprint 4.2b (postInvoice + cancelPosting).
 *
 * Couverture :
 *  - postInvoice : facture XOF simple → AC équilibrée + OD extournement
 *  - postInvoice : facture EUR → conversion + exchange_rate stocké
 *  - postInvoice : facture sans compte 6xx résolvable → 409
 *  - postInvoice : période fermée → 409 PERIOD_CLOSED
 *  - postInvoice : facture déjà posted → 409 ALREADY_POSTED
 *  - postInvoice : facture pas matched → 409 INVOICE_NOT_POSTABLE
 *  - postInvoice : multidevises sans taux → 409 EXCHANGE_RATE_MISSING
 *  - postInvoice : fraction 50% → extournement partiel
 *  - postInvoice : fraction cumulée 100% → engagement marqué reversed
 *  - postInvoice : imputation analytique copiée sur les lignes 6xx
 *  - postInvoice : compte priorité invoice_line.glAccount > budget > 605
 *  - postInvoice : invoice sans poId → 404
 *  - cancelPosting : reason vide → 400
 *  - cancelPosting : facture pas posted → 409 INVOICE_NOT_POSTABLE
 *  - cancelPosting : facture posted → AC inverse + classe 8 re-créée
 *  - listEntriesForInvoice : retourne les entries source=invoice
 */
describe('PostingService — postInvoice/cancelPosting (sprint-4.2b)', () => {
  // US-062 (fix F22) : horloge figée → numéros de séquence YYYY-NNNN et
  // horodatages par défaut déterministes, indépendants de la date d'exécution.
  beforeAll(() => useFakeDate('2026-06-15'));
  afterAll(() => restoreRealDate());

  type PrismaMock = {
    invoice: { findUnique: jest.Mock; update: jest.Mock };
    purchaseOrder: { findUnique: jest.Mock };
    supplier: { findUnique: jest.Mock };
    budgetLine: { findMany: jest.Mock };
    glAccount: { findMany: jest.Mock };
    exchangeRate: { findFirst: jest.Mock };
    fiscalPeriod: { findMany: jest.Mock };
    purchaseRequest: { findUnique: jest.Mock };
    journalEntry: {
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    journalLine: { createMany: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
    $executeRawUnsafe: jest.Mock;
  };

  let prisma: PrismaMock;
  let svc: PostingService;

  const invoiceId = 'inv00000-0000-0000-0000-000000000001';
  const supplierId = 'sup00000-0000-0000-0000-000000000010';
  const poId = 'po000000-0000-0000-0000-000000000020';
  const poLineId = 'pol00000-0000-0000-0000-000000000021';
  const prId = 'pr000000-0000-0000-0000-000000000030';
  const projectId = 'prj00000-0000-0000-0000-000000000040';
  const grantId = 'grt00000-0000-0000-0000-000000000050';
  const blId = 'bl000000-0000-0000-0000-000000000060';
  const ilId = 'il000000-0000-0000-0000-000000000100';

  const periodMonth = { id: 'per-month', periodType: 'month', isClosed: false, code: 'M-2026-05' };
  const periodMonthClosed = { id: 'per-month-c', periodType: 'month', isClosed: true, code: 'M-2026-04' };

  const actor = { id: 'usr-1', email: 'cpt@x', fullName: 'CPT' };

  function makeInvoice(overrides: {
    status?: InvoiceStatus;
    currency?: string;
    totalHt?: number;
    totalVat?: number;
    totalTtc?: number;
    poId?: string | null;
    lines?: Array<{ id: string; lineNumber: number; description: string; lineTotal: number; poLineId: string | null; glAccount: string | null }>;
  } = {}) {
    return {
      id: invoiceId,
      invoiceNumber: 'INV-2026-001',
      supplierId,
      invoiceDate: new Date('2026-05-14'),
      dueDate: new Date('2026-06-13'),
      receivedAt: new Date(),
      status: overrides.status ?? InvoiceStatus.matched,
      totalHt: new Prisma.Decimal(overrides.totalHt ?? 100000),
      totalVat: new Prisma.Decimal(overrides.totalVat ?? 18000),
      totalTtc: new Prisma.Decimal(overrides.totalTtc ?? 118000),
      currency: overrides.currency ?? 'XOF',
      exchangeRate: null,
      poId: overrides.poId === undefined ? poId : overrides.poId,
      ocrConfidence: null,
      pdfObjectKey: null,
      capturedPayload: null,
      rejectionReason: null,
      postedAt: null,
      matchedBy: null,
      matchedAt: null,
      matchSummary: null,
      // US-003-bis : colonnes multidevise ADR-005 (nullable, non testées ici).
      total_ht_xof: null,
      total_vat_xof: null,
      total_ttc_xof: null,
      fx_rate: null,
      fx_rate_date: null,
      lines: overrides.lines ?? [{
        id: ilId, lineNumber: 1, description: 'Gants nitrile',
        lineTotal: 100000, poLineId, glAccount: null,
      }],
      createdAt: new Date(),
    };
  }

  function makePo() {
    return {
      id: poId, poNumber: 'BC-2026-0001', prId, supplierId,
      orderDate: new Date('2026-05-13'), expectedDate: null,
      status: PoStatus.received, totalHt: new Prisma.Decimal(100000),
      totalVat: new Prisma.Decimal(0), totalTtc: new Prisma.Decimal(100000),
      currency: 'XOF', incoterm: null, deliveryAddress: null, buyerId: null,
      sentAt: null, acknowledgedAt: null, acknowledgedBy: null,
      cancelledAt: null, cancellationReason: null,
      pdfObjectKey: null, emailSentAt: null, emailSentTo: null,
      createdAt: new Date(),
      lines: [{
        id: poLineId, poId, lineNumber: 1, description: 'Gants nitrile',
        quantity: new Prisma.Decimal(10), unitPrice: new Prisma.Decimal(10000),
        unit: 'box', taxCodeId: null, budgetLineId: blId,
        quantityReceived: new Prisma.Decimal(10), quantityInvoiced: new Prisma.Decimal(0),
        prLineId: null, lineTotal: new Prisma.Decimal(100000),
      }],
      prLinks: [{ prId }],
    };
  }

  beforeEach(() => {
    prisma = {
      invoice: {
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...makeInvoice(), ...data })),
      },
      purchaseOrder: { findUnique: jest.fn().mockResolvedValue(makePo()) },
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: supplierId, code: 'ACME-001', name: 'ACME' }) },
      budgetLine: { findMany: jest.fn().mockResolvedValue([{ id: blId, defaultAccount: '601' }]) },
      glAccount: { findMany: jest.fn().mockResolvedValue([{ code: '601' }, { code: '605' }, { code: '445' }, { code: '401' }, { code: '801' }, { code: '802' }]) },
      exchangeRate: { findFirst: jest.fn() },
      fiscalPeriod: { findMany: jest.fn().mockResolvedValue([periodMonth]) },
      purchaseRequest: {
        findUnique: jest.fn().mockResolvedValue({
          projectId, grantId, costCenterId: null, activityId: null,
          lines: [{ budgetLineId: blId }],
        }),
      },
      journalEntry: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: `je-${Math.random()}`, ...data })),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
          // Pour findOriginalEngagement : 1 entry posted avec label "Engagement BC..."
          if ((where as { label?: { startsWith?: string } }).label?.startsWith === 'Engagement BC') {
            return Promise.resolve({
              id: 'je-original-801',
              sourceType: 'purchase_order',
              sourceId: poId,
              status: EntryStatus.posted,
              periodId: periodMonth.id,
              journal: JournalType.OD,
              entryNumber: 'OD-2026-0001',
              label: 'Engagement BC BC-2026-0001 - ACME',
              lines: [
                { lineNumber: 1, accountCode: '801', debit: new Prisma.Decimal(100000), credit: new Prisma.Decimal(0), currency: 'XOF', projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null, label: 'Engagement BC-2026-0001' },
                { lineNumber: 2, accountCode: '802', debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(100000), currency: 'XOF', projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null, label: 'Contre-engagement BC-2026-0001' },
              ],
            });
          }
          return Promise.resolve(null);
        }),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      journalLine: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        // US-099 : lignes 801 du BC pour le calcul du résidu — défaut [] =
        // résidu nul = pas d'OD de solde.
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (cb: unknown) => {
        if (typeof cb === 'function') return (cb as (tx: unknown) => unknown)(prisma);
        return Promise.all(cb as unknown[]);
      }),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    // US-020 (F18) : postInvoice fait sa propre conversion (lookup taux) et
    // n'appelle pas ExchangeRateService → stub minimal suffisant pour la DI.
    const fx = { convertToXof: jest.fn() };
    svc = new PostingService(
      prisma as unknown as PrismaService,
      fx as unknown as ExchangeRateService,
    );
  });

  // ============================================================
  describe('postInvoice — preconditions', () => {
    it('rejects when invoice already posted', async () => {
      const inv = makeInvoice({ status: InvoiceStatus.posted });
      await expect(svc.postInvoice(inv, actor)).rejects.toBeInstanceOf(InvoiceAlreadyPostedException);
    });

    it('rejects when invoice not matched (status captured)', async () => {
      const inv = makeInvoice({ status: InvoiceStatus.captured });
      await expect(svc.postInvoice(inv, actor)).rejects.toBeInstanceOf(InvoiceNotPostableException);
    });

    it('rejects when invoice has no poId', async () => {
      const inv = makeInvoice({ poId: null });
      await expect(svc.postInvoice(inv, actor)).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('US-079 (F-S8-03) : facture matched SANS lignes → 409 INVOICE_NO_LINES_NOT_POSTABLE (plus un 404)', async () => {
      const inv = makeInvoice({ lines: [] });
      const err = await svc.postInvoice(inv, actor).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvoiceNoLinesNotPostableException);
      expect((err as InvoiceNoLinesNotPostableException).getStatus()).toBe(409);
      expect((err as InvoiceNoLinesNotPostableException).code).toBe(
        'BUSINESS.INVOICE_NO_LINES_NOT_POSTABLE',
      );
    });

    it('rejects when fiscal period covering date is closed', async () => {
      prisma.fiscalPeriod.findMany.mockResolvedValue([periodMonthClosed]);
      const inv = makeInvoice();
      await expect(svc.postInvoice(inv, actor)).rejects.toBeInstanceOf(PeriodClosedException);
    });
  });

  // ============================================================
  describe('postInvoice — happy path XOF', () => {
    it('creates balanced AC entry (debit 6xx + debit 445 = credit 401)', async () => {
      const inv = makeInvoice();
      await svc.postInvoice(inv, actor);
      // 1ère création = AC entry, 2ème = OD reversal
      const allLines = prisma.journalLine.createMany.mock.calls.flatMap((c) => c[0].data);
      const acLines = allLines.filter((l: { accountCode: string }) => ['601', '605', '445', '401'].includes(l.accountCode));
      const sumDebit = acLines.reduce((s: number, l: { debit: number }) => s + Number(l.debit), 0);
      const sumCredit = acLines.reduce((s: number, l: { credit: number }) => s + Number(l.credit), 0);
      expect(sumDebit).toBe(sumCredit);
      expect(sumDebit).toBe(118000);
    });

    it('uses 601 from budget_line.default_account', async () => {
      const inv = makeInvoice();
      await svc.postInvoice(inv, actor);
      const allLines = prisma.journalLine.createMany.mock.calls.flatMap((c) => c[0].data);
      const expense = allLines.find((l: { accountCode: string }) => l.accountCode === '601');
      expect(expense).toBeDefined();
      expect(Number(expense.debit)).toBe(100000);
    });

    it('falls back to 605 when no glAccount and no budget default', async () => {
      prisma.budgetLine.findMany.mockResolvedValue([{ id: blId, defaultAccount: null }]);
      const inv = makeInvoice();
      await svc.postInvoice(inv, actor);
      const allLines = prisma.journalLine.createMany.mock.calls.flatMap((c) => c[0].data);
      const expense = allLines.find((l: { accountCode: string }) => l.accountCode === '605');
      expect(expense).toBeDefined();
    });

    it('explicit invoice_line.glAccount wins over budget default', async () => {
      const inv = makeInvoice({
        lines: [{
          id: ilId, lineNumber: 1, description: 'Custom', lineTotal: 100000,
          poLineId, glAccount: '601',
        }],
      });
      await svc.postInvoice(inv, actor);
      const allLines = prisma.journalLine.createMany.mock.calls.flatMap((c) => c[0].data);
      const expense = allLines.find((l: { accountCode: string }) => l.accountCode === '601');
      expect(expense).toBeDefined();
    });

    it('copies analytical imputation (project/grant/budgetLine) on 6xx lines only', async () => {
      const inv = makeInvoice();
      await svc.postInvoice(inv, actor);
      const allLines = prisma.journalLine.createMany.mock.calls.flatMap((c) => c[0].data);
      const expenseLine = allLines.find((l: { accountCode: string }) => l.accountCode === '601');
      const vatLine = allLines.find((l: { accountCode: string }) => l.accountCode === '445');
      const supplierLine = allLines.find((l: { accountCode: string }) => l.accountCode === '401');
      expect(expenseLine).toMatchObject({ projectId, grantId, budgetLineId: blId });
      // TVA et 401 : pas d'imputation analytique (par convention SYSCEBNL)
      expect(vatLine.projectId).toBeUndefined();
      expect(supplierLine.projectId).toBeUndefined();
      expect(supplierLine.auxiliaryCode).toBe('ACME-001');
    });

    it('creates an OD class 8 reversal (801 credit / 802 debit) at invoice HT', async () => {
      const inv = makeInvoice();
      await svc.postInvoice(inv, actor);
      const allLines = prisma.journalLine.createMany.mock.calls.flatMap((c) => c[0].data);
      const c801 = allLines.find((l: { accountCode: string; credit: number | Prisma.Decimal }) => l.accountCode === '801' && Number(l.credit) > 0);
      const d802 = allLines.find((l: { accountCode: string; debit: number | Prisma.Decimal }) => l.accountCode === '802' && Number(l.debit) > 0);
      expect(c801).toBeDefined();
      expect(d802).toBeDefined();
      expect(Number(c801.credit)).toBe(100000);
      expect(Number(d802.debit)).toBe(100000);
    });

    it('updates invoice.status=posted + postedAt + matchSummary.posting', async () => {
      const inv = makeInvoice();
      await svc.postInvoice(inv, actor);
      const upd = prisma.invoice.update.mock.calls[0][0];
      expect(upd.data.status).toBe(InvoiceStatus.posted);
      expect(upd.data.postedAt).toBeInstanceOf(Date);
      const summary = upd.data.matchSummary as Record<string, unknown>;
      expect((summary.posting as Record<string, unknown>).acEntryNumber).toBeDefined();
      expect((summary.commitmentReversedEntries as unknown[]).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  describe('postInvoice — multidevises', () => {
    it('lookups exchange_rate and stores converted XOF + original currency', async () => {
      prisma.exchangeRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal('655.957') });
      const inv = makeInvoice({
        currency: 'EUR', totalHt: 100, totalVat: 18, totalTtc: 118,
        lines: [{ id: ilId, lineNumber: 1, description: 'Gants', lineTotal: 100, poLineId, glAccount: null }],
      });
      await svc.postInvoice(inv, actor);
      const allLines = prisma.journalLine.createMany.mock.calls.flatMap((c) => c[0].data);
      const expense = allLines.find((l: { accountCode: string }) => l.accountCode === '601');
      // 100 EUR * 655.957 ≈ 65595.7
      expect(Number(expense.debit)).toBeCloseTo(65595.7, 1);
      expect(Number(expense.debitTxAmount)).toBe(100);
      expect(expense.currency).toBe('EUR');
      // US-140 (I1) : fx_rate + fx_rate_date renseignés sur CHAQUE ligne EUR.
      allLines
        .filter((l: { currency: string }) => l.currency === 'EUR')
        .forEach((l: { fx_rate: unknown; fx_rate_date: unknown }) => {
          expect(Number(l.fx_rate)).toBeCloseTo(655.957, 3);
          expect(l.fx_rate_date).toBeInstanceOf(Date);
        });
    });

    it('rejects when no exchange rate found', async () => {
      prisma.exchangeRate.findFirst.mockResolvedValue(null);
      const inv = makeInvoice({ currency: 'USD' });
      await expect(svc.postInvoice(inv, actor)).rejects.toBeInstanceOf(ExchangeRateMissingException);
    });

    it('persists invoice.exchangeRate (not null for non-XOF)', async () => {
      prisma.exchangeRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal('1.05') });
      const inv = makeInvoice({ currency: 'EUR' });
      await svc.postInvoice(inv, actor);
      const upd = prisma.invoice.update.mock.calls[0][0];
      expect(Number(upd.data.exchangeRate)).toBe(1.05);
    });
  });

  // ============================================================
  describe('postInvoice — GL account resolution failure', () => {
    it('throws GlAccountNotFoundException when 605 fallback is also missing in gl_account', async () => {
      prisma.budgetLine.findMany.mockResolvedValue([{ id: blId, defaultAccount: null }]);
      // gl_account only has 401/445/801/802 — no 605
      prisma.glAccount.findMany.mockResolvedValue([{ code: '445' }, { code: '401' }, { code: '801' }, { code: '802' }]);
      const inv = makeInvoice();
      await expect(svc.postInvoice(inv, actor)).rejects.toBeInstanceOf(GlAccountNotFoundException);
    });
  });

  // ============================================================
  describe('postInvoice — partial reversal cumulation', () => {
    it('does NOT mark original 801 entry as reversed when fraction < 99.9%', async () => {
      // 1ʳᵉ facture sur un BC de 200000, fact=80000 → 40%
      const inv = makeInvoice({ totalHt: 80000, totalVat: 0, totalTtc: 80000 });
      // PO override : totalHt=200000
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...makePo(),
        totalHt: new Prisma.Decimal(200000),
      });
      await svc.postInvoice(inv, actor);
      // Vérifie qu'on n'a PAS appelé update pour reverser l'original
      const updates = prisma.journalEntry.update.mock.calls.map((c) => c[0]);
      const reversed = updates.find((u) => u.data?.status === EntryStatus.reversed && u.where?.id === 'je-original-801');
      expect(reversed).toBeUndefined();
    });

    // US-099 (F-S8-26, Option A ADR-005) : fin de vie « totalement facturé »
    // avec résidu classe 8 (arrondis d'extournes partielles multi-taux) →
    // OD de solde 801/802, hors résultat.
    it('US-099 — facturation complète avec résidu → OD de solde 801/802 (jamais 676/776)', async () => {
      // Extournes précédentes 90 000 + facture 10 000 = 100 000 → fraction 100 %.
      prisma.journalEntry.findMany.mockResolvedValue([
        {
          id: 'je-prev-rev', lines: [
            { accountCode: '801', credit: new Prisma.Decimal(90000), debit: new Prisma.Decimal(0) },
          ],
        },
      ]);
      // Résidu simulé : 801 débit 100 000 (engagement) − crédit 99 000
      // (extournes, arrondis cumulés) = +1 000 → l'OD crédite 801 / débite 802.
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal(100000), credit: new Prisma.Decimal(0), projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null },
        { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(99000), projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null },
      ]);
      const inv = makeInvoice({ totalHt: 10000, totalVat: 0, totalTtc: 10000 });
      await svc.postInvoice(inv, actor);

      const allLines = prisma.journalLine.createMany.mock.calls.flatMap((c) => c[0].data);
      const solde801 = allLines.find((l: { label?: string }) => String(l.label).startsWith('Solde résidu 801'));
      const solde802 = allLines.find((l: { label?: string }) => String(l.label).startsWith('Solde résidu 802'));
      expect(solde801).toBeDefined();
      expect(Number(solde801.credit)).toBe(1000);
      expect(Number(solde801.debit)).toBe(0);
      expect(Number(solde802.debit)).toBe(1000);
      expect(solde801).toMatchObject({ currency: 'XOF', projectId, grantId, budgetLineId: blId });
      expect(allLines.some((l: { accountCode: string }) => l.accountCode === '676' || l.accountCode === '776')).toBe(false);
      // L'OD de solde est bien une écriture dédiée, libellé explicite.
      const entries = prisma.journalEntry.create.mock.calls.map((c) => c[0].data);
      expect(entries.some((e: { label: string }) => e.label.startsWith('Solde résidu engagement BC'))).toBe(true);
    });

    it('US-099 — résidu nul → aucune OD de solde', async () => {
      // Fraction 100 % atteinte (même montage que ci-dessus)…
      prisma.journalEntry.findMany.mockResolvedValue([
        {
          id: 'je-prev-rev', lines: [
            { accountCode: '801', credit: new Prisma.Decimal(90000), debit: new Prisma.Decimal(0) },
          ],
        },
      ]);
      // …mais lignes 801 parfaitement soldées (journalLine.findMany défaut [])
      // → résidu 0 → aucune OD de solde.
      const inv = makeInvoice({ totalHt: 10000, totalVat: 0, totalTtc: 10000 });
      await svc.postInvoice(inv, actor);
      const entries = prisma.journalEntry.create.mock.calls.map((c) => c[0].data);
      expect(entries.some((e: { label: string }) => e.label.startsWith('Solde résidu engagement BC'))).toBe(false);
    });

    it('marks original 801 entry as reversed when cumulative fraction ≥ 99.9%', async () => {
      // 1ʳᵉ extournement de 90000 déjà fait, on extourne le reste 10000
      prisma.journalEntry.findMany.mockResolvedValue([
        {
          id: 'je-prev-rev', lines: [
            { accountCode: '801', credit: new Prisma.Decimal(90000), debit: new Prisma.Decimal(0) },
          ],
        },
      ]);
      const inv = makeInvoice({ totalHt: 10000, totalVat: 0, totalTtc: 10000 });
      await svc.postInvoice(inv, actor);
      const reversed = prisma.journalEntry.update.mock.calls
        .map((c) => c[0])
        .find((u) => u.data?.status === EntryStatus.reversed && u.where?.id === 'je-original-801');
      expect(reversed).toBeDefined();
    });
  });

  // ============================================================
  describe('cancelPosting', () => {
    it('rejects empty reason', async () => {
      await expect(svc.cancelPosting(invoiceId, actor, '   ')).rejects.toBeInstanceOf(PostingCancelReasonRequiredException);
    });

    it('rejects when invoice is not posted', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({ status: InvoiceStatus.matched }));
      await expect(svc.cancelPosting(invoiceId, actor, 'erreur de saisie comptable')).rejects.toBeInstanceOf(InvoiceNotPostableException);
    });

    it('happy path : creates AC inverse + re-creates class 8 engagement + status=matched', async () => {
      const postedInv = {
        ...makeInvoice({ status: InvoiceStatus.posted }),
        matchSummary: {
          commitmentReversedEntries: [{ entryId: 'je-reversal-1', entryNumber: 'OD-2026-0002', amountReversed: 100000 }],
        },
      };
      prisma.invoice.findUnique.mockResolvedValue(postedInv);
      // Mock AC entry to reverse
      prisma.journalEntry.findFirst.mockImplementationOnce(() =>
        Promise.resolve({
          id: 'je-ac-1', sourceType: 'invoice', sourceId: invoiceId,
          journal: JournalType.AC, status: EntryStatus.posted,
          label: 'Facture ACME-001 INV-2026-001',
          lines: [
            { lineNumber: 1, accountCode: '601', debit: new Prisma.Decimal(100000), credit: new Prisma.Decimal(0), currency: 'XOF', debitTxAmount: null, creditTxAmount: null, projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null, auxiliaryCode: null, label: 'Achat' },
            { lineNumber: 2, accountCode: '445', debit: new Prisma.Decimal(18000), credit: new Prisma.Decimal(0), currency: 'XOF', debitTxAmount: null, creditTxAmount: null, projectId: null, grantId: null, budgetLineId: null, costCenterId: null, activityId: null, auxiliaryCode: null, label: 'TVA' },
            { lineNumber: 3, accountCode: '401', debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(118000), currency: 'XOF', debitTxAmount: null, creditTxAmount: null, projectId: null, grantId: null, budgetLineId: null, costCenterId: null, activityId: null, auxiliaryCode: 'ACME-001', label: 'Fournisseur' },
          ],
        }),
      );
      // Mock prev reversal entry for re-creation
      prisma.journalEntry.findUnique.mockResolvedValue({
        id: 'je-reversal-1', sourceId: poId, sourceType: 'purchase_order',
        status: EntryStatus.posted,
        lines: [
          { lineNumber: 1, accountCode: '801', credit: new Prisma.Decimal(100000), debit: new Prisma.Decimal(0), currency: 'XOF', projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null, label: 'Extourne 801' },
          { lineNumber: 2, accountCode: '802', credit: new Prisma.Decimal(0), debit: new Prisma.Decimal(100000), currency: 'XOF', projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null, label: 'Extourne 802' },
        ],
      });
      const res = await svc.cancelPosting(invoiceId, actor, 'erreur de saisie comptable détectée');
      expect(res.invoice.status).toBe(InvoiceStatus.matched);
      expect(res.acReverseEntryNumber).toMatch(/^AC-\d{4}-\d{4}$/);
      expect(res.class8RecreatedEntryNumber).toMatch(/^OD-\d{4}-\d{4}$/);
    });
  });

  // ============================================================
  describe('listEntriesForInvoice', () => {
    it('filters entries by sourceType=invoice', async () => {
      const fakeEntries = [{ id: 'je-1', sourceType: 'invoice', sourceId: invoiceId, lines: [] }];
      prisma.journalEntry.findMany.mockResolvedValue(fakeEntries);
      const res = await svc.listEntriesForInvoice(invoiceId);
      expect(res).toBe(fakeEntries);
      expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sourceType: 'invoice', sourceId: invoiceId } }),
      );
    });
  });
});
