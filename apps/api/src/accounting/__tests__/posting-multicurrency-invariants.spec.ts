import { Prisma, PoStatus, InvoiceStatus } from '@prisma/client';
import type { BankAccount, Invoice, Payment, PurchaseOrder } from '@prisma/client';
import { PostingService } from '../services/posting.service';
import { ExchangeRateService } from '../../referential/exchange-rate/exchange-rate.service';
import { createPrismaMock, type PrismaMock } from '../../test-utils/prisma-mock';
import { useFakeDate, restoreRealDate } from '../../test-utils/fake-time';
import { UnknownCurrencyException } from '../../common/exceptions/business.exception';

/**
 * Tests SENTINELLES US-022 — invariants multidevise du posting (US-020/F18).
 *
 * Verrouille, au niveau service, les invariants que US-020 a introduits sur
 * gl.journal_line, pour prévenir toute régression (posting réintroduit sans
 * taux, mélange de devises, montant brut écrit en colonne XOF) :
 *
 *  I1. currency != 'XOF' ⟹ fx_rate ET fx_rate_date renseignés.
 *  I2. debit/credit sont en XOF (devise de tenue) ; le brut transactionnel
 *      est dans debit_tx_amount/credit_tx_amount.
 *  I3. fx_rate renseigné ⟹ fx_rate > 0.
 *  I4. fx_rate renseigné ⟹ fx_rate_date non null.
 *  I5. Toutes les lignes d'un entry partagent la même currency
 *      (createCommitmentEntry/postPayment écrivent po/payment.currency).
 *
 * Note Phase 4 : l'équilibre sum(debit_xof)=sum(credit_xof) par entry est
 * AUSSI enforced par le trigger PG gl.check_entry_balance (sur debit/credit,
 * désormais en XOF) → double protection ; on l'asserte ici côté code.
 *
 * Note Phase 3 (defense in depth DB) : un CHECK chk_fx_consistency sur
 * gl.journal_line (I1/I3/I4) est reporté à une story future (US-140) : il
 * exige d'abord (a) que postInvoice peuple fx_rate/fx_rate_date sur TOUTES
 * ses lignes (main/TVA/fournisseur/extournes — non couvert par US-020), et
 * (b) le backfill des lignes USD existantes au fx_rate NULL. Voir rapport.
 */
describe('PostingService — invariants multidevise (sentinelles US-022)', () => {
  let prisma: PrismaMock;
  let svc: PostingService;

  type LineArg = {
    accountCode: string;
    debit: number;
    credit: number;
    currency: string;
    debitTxAmount: Prisma.Decimal | number | null;
    creditTxAmount: Prisma.Decimal | number | null;
    fx_rate: number | null;
    fx_rate_date: Date | null;
  };
  const linesOf = (calls: unknown[][]): LineArg[] =>
    (calls[0][0] as { data: LineArg[] }).data;

  const actor = { id: 'usr-1', email: 'a@x', fullName: 'A' };
  const openPeriod = { id: 'per-month', periodType: 'month', isClosed: false };

  function makePo(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder & { prLinks: Array<{ prId: string }> } {
    return {
      id: 'po-1', poNumber: 'BC-2026-0001', prId: 'pr-1', supplierId: 'sup-1',
      orderDate: new Date('2026-05-15T00:00:00Z'), expectedDate: null,
      status: PoStatus.draft,
      totalHt: new Prisma.Decimal('500000'), totalVat: new Prisma.Decimal('0'),
      totalTtc: new Prisma.Decimal('500000'), currency: 'XOF',
      incoterm: null, deliveryAddress: null, buyerId: null, sentAt: null,
      acknowledgedAt: null, acknowledgedBy: null, cancelledAt: null,
      cancellationReason: null, pdfObjectKey: null, emailSentAt: null,
      emailSentTo: null, createdAt: new Date(),
      ...overrides, prLinks: [{ prId: 'pr-1' }],
    } as PurchaseOrder & { prLinks: Array<{ prId: string }> };
  }

  function makePayment(currency = 'XOF'): Payment & {
    invoice: Invoice & { supplier: { code: string; name: string } };
  } {
    const invoice = {
      id: 'inv-1', invoiceNumber: 'F-001', supplierId: 's1',
      invoiceDate: new Date('2026-05-16'), dueDate: new Date('2026-06-15'),
      receivedAt: new Date(), status: InvoiceStatus.posted,
      totalHt: new Prisma.Decimal('100000'), totalVat: new Prisma.Decimal('18000'),
      totalTtc: new Prisma.Decimal('118000'), currency, exchangeRate: null,
      poId: 'po-1', ocrConfidence: null, pdfObjectKey: null, capturedPayload: null,
      rejectionReason: null, postedAt: new Date(), createdAt: new Date(),
      matchedBy: null, matchedAt: null, matchSummary: null,
      supplier: { code: 'ACME', name: 'ACME Corp' },
    } as unknown as Invoice & { supplier: { code: string; name: string } };
    return {
      id: 'pay-1', paymentRunId: 'run-1', invoiceId: 'inv-1',
      amount: new Prisma.Decimal('118000'), currency, method: 'sepa',
      paymentDate: new Date('2026-05-16'), status: 'executed', bankReference: null,
      fxGainLoss: new Prisma.Decimal('0'), createdAt: new Date(), invoice,
    } as unknown as Payment & { invoice: Invoice & { supplier: { code: string; name: string } } };
  }

  function makeBank(currency = 'XOF'): BankAccount {
    return {
      id: 'ba', code: 'CBAO', label: 'CBAO', accountNumber: 'SN0120101', bic: 'CBAOSNDA',
      bankName: 'CBAO', currency, glAccountCode: '521', isActive: true,
      createdAt: new Date(), updatedAt: new Date(),
    } as BankAccount;
  }

  beforeAll(() => useFakeDate('2026-06-15'));
  afterAll(() => restoreRealDate());

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.journalEntry.findFirst.mockResolvedValue(null as never);
    prisma.fiscalPeriod.findMany.mockResolvedValue([openPeriod] as never);
    prisma.purchaseRequest.findUnique.mockResolvedValue({
      projectId: 'prj-1', grantId: 'grt-1', costCenterId: null, activityId: null,
      lines: [{ budgetLineId: 'bl-1' }],
    } as never);
    prisma.supplier.findUnique.mockResolvedValue({ name: 'ACME' } as never);
    prisma.glAccount.findUnique.mockResolvedValue({ code: '521', class: '5' } as never);
    prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
    prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] } as never);
    prisma.$executeRawUnsafe.mockResolvedValue(1 as never);

    // Stub FX déterministe : XOF identité, EUR parité BCEAO, USD taux indicatif.
    // Toute autre devise → UnknownCurrencyException (comme le vrai service).
    const fx = {
      convertToXof: jest.fn(
        async (amount: number | { toString(): string }, currency: string) => {
          const n = Number(amount);
          const fxRateDate = new Date('2026-06-15');
          if (currency === 'XOF') return { xofAmount: Math.round(n), fxRate: 1, fxRateDate, isIndicativeFallback: false };
          if (currency === 'EUR') return { xofAmount: Math.round(n * 655.957), fxRate: 655.957, fxRateDate, isIndicativeFallback: false };
          if (currency === 'USD') return { xofAmount: Math.round(n * 600), fxRate: 600, fxRateDate, isIndicativeFallback: true };
          throw new UnknownCurrencyException(currency);
        },
      ),
    };
    svc = new PostingService(prisma, fx as unknown as ExchangeRateService);
  });

  // ================= createCommitmentEntry =================
  describe('createCommitmentEntry', () => {
    it('I1/I3/I4 — ligne EUR : fx_rate (>0) ET fx_rate_date renseignés', async () => {
      await svc.createCommitmentEntry(makePo({ totalHt: new Prisma.Decimal('100000'), currency: 'EUR' }), actor);
      const lines = linesOf(prisma.journalLine.createMany.mock.calls);
      for (const l of lines) {
        expect(l.fx_rate).not.toBeNull();
        expect(l.fx_rate as number).toBeGreaterThan(0); // I3
        expect(l.fx_rate_date).toBeInstanceOf(Date); // I4
      }
      expect(lines[0].fx_rate).toBe(655.957); // I1
    });

    it('I2 — montant en XOF dans debit, brut transactionnel dans debit_tx_amount', async () => {
      await svc.createCommitmentEntry(makePo({ totalHt: new Prisma.Decimal('100000'), currency: 'EUR' }), actor);
      const lines = linesOf(prisma.journalLine.createMany.mock.calls);
      expect(lines[0].debit).toBe(65595700); // XOF, PAS 100000
      expect(Number(lines[0].debitTxAmount)).toBe(100000); // brut EUR
      expect(Number(lines[1].creditTxAmount)).toBe(100000);
    });

    it('I2 (XOF natif) — pas de debit_tx_amount, fx_rate = 1', async () => {
      await svc.createCommitmentEntry(makePo({ totalHt: new Prisma.Decimal('500000'), currency: 'XOF' }), actor);
      const lines = linesOf(prisma.journalLine.createMany.mock.calls);
      expect(lines[0].debit).toBe(500000);
      expect(lines[0].debitTxAmount).toBeNull();
      expect(lines[0].fx_rate).toBe(1);
    });

    it('I5 — toutes les lignes de l\'écriture partagent la même currency', async () => {
      await svc.createCommitmentEntry(makePo({ totalHt: new Prisma.Decimal('100000'), currency: 'EUR' }), actor);
      const lines = linesOf(prisma.journalLine.createMany.mock.calls);
      const currencies = new Set(lines.map((l) => l.currency));
      expect(currencies.size).toBe(1);
      expect([...currencies][0]).toBe('EUR');
    });

    it('Phase 4 — équilibre XOF : sum(debit) = sum(credit) par entry', async () => {
      await svc.createCommitmentEntry(makePo({ totalHt: new Prisma.Decimal('100000'), currency: 'EUR' }), actor);
      const lines = linesOf(prisma.journalLine.createMany.mock.calls);
      const debit = lines.reduce((s, l) => s + l.debit, 0);
      const credit = lines.reduce((s, l) => s + l.credit, 0);
      expect(debit).toBe(credit); // 65 595 700 = 65 595 700
    });

    it('I1 (gate) — devise inconnue ⟹ exception, AUCUNE ligne écrite', async () => {
      await expect(
        svc.createCommitmentEntry(makePo({ totalHt: new Prisma.Decimal('100000'), currency: 'ZZZ' }), actor),
      ).rejects.toBeInstanceOf(UnknownCurrencyException);
      expect(prisma.journalLine.createMany).not.toHaveBeenCalled();
    });
  });

  // ================= postPayment =================
  describe('postPayment', () => {
    it('I1/I2 — paiement EUR : debit en XOF, fx_rate set, debit_tx_amount = brut', async () => {
      await svc.postPayment(actor, makePayment('EUR'), makeBank('EUR'));
      const lines = linesOf(prisma.journalLine.createMany.mock.calls);
      // 118 000 EUR × 655,957 = 77 402 926 XOF (postPayment stocke un Decimal).
      expect(Number(lines[0].debit)).toBe(77402926);
      expect(Number(lines[0].debitTxAmount)).toBe(118000);
      expect(lines[0].fx_rate).toBe(655.957);
      expect(lines[0].fx_rate_date).toBeInstanceOf(Date);
    });

    it('Phase 4 — équilibre XOF (paiement XOF) : sum(debit) = sum(credit)', async () => {
      await svc.postPayment(actor, makePayment('XOF'), makeBank('XOF'));
      const lines = linesOf(prisma.journalLine.createMany.mock.calls);
      const debit = lines.reduce((s, l) => s + Number(l.debit), 0);
      const credit = lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(debit).toBe(credit);
      expect(lines.every((l) => l.fx_rate === 1)).toBe(true); // I3 : XOF → 1 > 0
    });
  });
});
