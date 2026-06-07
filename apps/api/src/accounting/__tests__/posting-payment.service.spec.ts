import { Prisma, JournalType, EntryStatus, InvoiceStatus } from '@prisma/client';
import type { BankAccount, Invoice, Payment } from '@prisma/client';
import { PostingService } from '../services/posting.service';
import { ExchangeRateService } from '../../referential/exchange-rate/exchange-rate.service';
import { createPrismaMock, type PrismaMock } from '../../test-utils/prisma-mock';
import {
  BankAccountWrongClassException,
  EntityNotFoundException,
  NoOpenFiscalPeriodException,
  PaymentCurrencyMismatchException,
  PeriodClosedException,
} from '../../common/exceptions/business.exception';

/**
 * Tests unitaires `PostingService.postPayment` (sprint 5.1).
 *
 * Couvre :
 *  - création écriture BQ équilibrée (401 debit = 521 credit)
 *  - auxiliary_code = supplier.code sur la ligne 401
 *  - numérotation BQ-YYYY-NNNN
 *  - PERIOD_CLOSED si période fermée
 *  - PAYMENT_CURRENCY_MISMATCH si devise paiement ≠ devise bank account
 *  - BANK_ACCOUNT_WRONG_CLASS si glAccount n'est pas en classe 5
 *  - listEntriesForPayment filtre sourceType='payment'
 */
describe('PostingService.postPayment', () => {
  let prisma: PrismaMock;
  let svc: PostingService;

  // Projection typée des lignes lues sur `journalLine.createMany.mock.calls` :
  // l'argument est une union Prisma non-indexable (TS7053), on en extrait
  // strictement les champs lus par les assertions.
  // `debit`/`credit` sont écrits par la prod comme `Prisma.Decimal` (montant
  // exact, cf. F10), pas comme `number` : on les lit via `Number()` pour les
  // assertions de valeur.
  type LineArg = {
    accountCode: string;
    auxiliaryCode?: string;
    debit: Prisma.Decimal | number;
    credit: Prisma.Decimal | number;
    currency: string;
  };
  const linesOf = (calls: unknown[][]): LineArg[] =>
    (calls[0][0] as { data: LineArg[] }).data;

  const actor = { id: 'usr-1', email: 'a@x', fullName: 'A' };
  const openPeriod = { id: 'per-1', periodType: 'month', isClosed: false };

  const bankXof: BankAccount = {
    id: 'ba-xof',
    code: 'CBAO-XOF',
    label: 'CBAO XOF',
    accountNumber: 'SN012010100000123456789012',
    bic: 'CBAOSNDA',
    bankName: 'CBAO',
    currency: 'XOF',
    glAccountCode: '521',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makePayment(
    overrides: Partial<Payment> = {},
    invoiceOverrides: Record<string, unknown> = {},
  ): Payment & { invoice: Invoice & { supplier: { code: string; name: string } } } {
    const invoice = {
      id: 'inv-1',
      invoiceNumber: 'F-001',
      supplierId: 's1',
      invoiceDate: new Date('2026-05-16'),
      dueDate: new Date('2026-06-15'),
      receivedAt: new Date(),
      status: InvoiceStatus.posted,
      totalHt: new Prisma.Decimal('100000'),
      totalVat: new Prisma.Decimal('18000'),
      totalTtc: new Prisma.Decimal('118000'),
      currency: 'XOF',
      exchangeRate: null,
      poId: 'po-1',
      ocrConfidence: null,
      pdfObjectKey: null,
      capturedPayload: null,
      rejectionReason: null,
      postedAt: new Date(),
      createdAt: new Date(),
      matchedBy: null,
      matchedAt: null,
      matchSummary: null,
      supplier: { code: 'ACME', name: 'ACME Corp' },
      ...invoiceOverrides,
    } as Invoice & { supplier: { code: string; name: string } };

    return {
      id: 'pay-1',
      paymentRunId: 'run-1',
      invoiceId: 'inv-1',
      amount: new Prisma.Decimal('118000'),
      currency: 'XOF',
      method: 'sepa',
      paymentDate: new Date('2026-05-16'),
      status: 'executed',
      bankReference: null,
      fxGainLoss: new Prisma.Decimal('0'),
      createdAt: new Date(),
      invoice,
      ...overrides,
    } as Payment & { invoice: Invoice & { supplier: { code: string; name: string } } };
  }

  beforeEach(() => {
    prisma = createPrismaMock();
    // Numérotation : production lit `journalEntry.findFirst` (MAX par préfixe).
    // null → première pièce de l'année (séquence = 1).
    prisma.journalEntry.findFirst.mockResolvedValue(null as never);
    prisma.fiscalPeriod.findMany.mockResolvedValue([openPeriod] as never);
    prisma.glAccount.findUnique.mockResolvedValue({ code: '521', class: '5' } as never);
    prisma.$executeRawUnsafe.mockResolvedValue(1 as never);
    // US-020 (F18) : ExchangeRateService stub. Les tests de paiement sont en
    // XOF → identité (xofAmount = montant, fxRate = 1).
    const fx = {
      convertToXof: jest.fn(
        async (amount: number | { toString(): string }, currency: string) => {
          const n = Number(amount);
          const fxRateDate = new Date('2026-06-15');
          if (currency === 'EUR') {
            return { xofAmount: Math.round(n * 655.957), fxRate: 655.957, fxRateDate, isIndicativeFallback: false };
          }
          return { xofAmount: Math.round(n), fxRate: 1, fxRateDate, isIndicativeFallback: false };
        },
      ),
    };
    svc = new PostingService(prisma, fx as unknown as ExchangeRateService);
  });

  it('creates a balanced BQ entry : debit 401 + credit 521', async () => {
    prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
    prisma.journalEntry.update.mockResolvedValue({ id: 'je-1' } as never);
    await svc.postPayment(actor, makePayment(), bankXof);

    const lines = linesOf(prisma.journalLine.createMany.mock.calls);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountCode: '401', auxiliaryCode: 'ACME' });
    expect(Number(lines[0].debit)).toBe(118000);
    expect(Number(lines[0].credit)).toBe(0);
    expect(lines[1]).toMatchObject({ accountCode: '521' });
    expect(Number(lines[1].debit)).toBe(0);
    expect(Number(lines[1].credit)).toBe(118000);
    // balanced
    const totalDebit = lines.reduce((s: number, l: LineArg) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s: number, l: LineArg) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it('numbers entry BQ-YYYY-NNNN with sequence count', async () => {
    const year = new Date().getFullYear();
    // Production lit le dernier numéro (MAX) via findFirst puis incrémente.
    prisma.journalEntry.findFirst.mockResolvedValue({
      entryNumber: `BQ-${year}-0007`,
    } as never);
    prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
    prisma.journalEntry.update.mockResolvedValue({ id: 'je-1' } as never);
    const r = await svc.postPayment(actor, makePayment(), bankXof);
    expect(r.entryNumber).toBe(`BQ-${year}-0008`);
    const createArgs = (
      prisma.journalEntry.create.mock.calls[0][0] as { data: { journal: JournalType } }
    ).data;
    expect(createArgs.journal).toBe(JournalType.BQ);
  });

  it('sourceType=payment + sourceId=payment.id', async () => {
    prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
    prisma.journalEntry.update.mockResolvedValue({ id: 'je-1' } as never);
    await svc.postPayment(actor, makePayment(), bankXof);
    const createArgs = (
      prisma.journalEntry.create.mock.calls[0][0] as {
        data: { sourceType: string; sourceId: string };
      }
    ).data;
    expect(createArgs.sourceType).toBe('payment');
    expect(createArgs.sourceId).toBe('pay-1');
  });

  it('label includes supplier code and invoice number', async () => {
    prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
    prisma.journalEntry.update.mockResolvedValue({ id: 'je-1' } as never);
    await svc.postPayment(actor, makePayment(), bankXof);
    const createArgs = (
      prisma.journalEntry.create.mock.calls[0][0] as { data: { label: string } }
    ).data;
    expect(createArgs.label).toContain('Paiement ACME');
    expect(createArgs.label).toContain('F-001');
  });

  it('promotes entry to posted with postedBy + postedAt', async () => {
    prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
    prisma.journalEntry.update.mockResolvedValue({ id: 'je-1' } as never);
    await svc.postPayment(actor, makePayment(), bankXof);
    const updateArgs = prisma.journalEntry.update.mock.calls[0][0] as {
      data: { status: EntryStatus; postedBy: string; postedAt: Date };
    };
    expect(updateArgs.data).toMatchObject({
      status: EntryStatus.posted,
      postedBy: actor.id,
    });
    expect(updateArgs.data.postedAt).toBeInstanceOf(Date);
  });

  it('rejects when payment currency mismatches bank account currency', async () => {
    await expect(
      svc.postPayment(actor, makePayment({ currency: 'EUR' }), bankXof),
    ).rejects.toBeInstanceOf(PaymentCurrencyMismatchException);
  });

  it('rejects when bank account gl_account is not class 5', async () => {
    prisma.glAccount.findUnique.mockResolvedValue({ code: '601', class: '6' } as never);
    const bank601 = { ...bankXof, glAccountCode: '601' };
    await expect(svc.postPayment(actor, makePayment(), bank601)).rejects.toBeInstanceOf(
      BankAccountWrongClassException,
    );
  });

  it('rejects when bank gl_account does not exist', async () => {
    prisma.glAccount.findUnique.mockResolvedValue(null as never);
    await expect(svc.postPayment(actor, makePayment(), bankXof)).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });

  it('rejects when fiscal period is closed', async () => {
    prisma.fiscalPeriod.findMany.mockResolvedValue([
      { ...openPeriod, isClosed: true, code: '2026-05' },
    ] as never);
    await expect(svc.postPayment(actor, makePayment(), bankXof)).rejects.toBeInstanceOf(
      PeriodClosedException,
    );
  });

  it('rejects when no fiscal period covers the payment date', async () => {
    prisma.fiscalPeriod.findMany.mockResolvedValue([] as never);
    await expect(svc.postPayment(actor, makePayment(), bankXof)).rejects.toBeInstanceOf(
      NoOpenFiscalPeriodException,
    );
  });

  it('records the right currency on each journal line', async () => {
    prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
    prisma.journalEntry.update.mockResolvedValue({ id: 'je-1' } as never);
    await svc.postPayment(actor, makePayment(), bankXof);
    const lines = linesOf(prisma.journalLine.createMany.mock.calls);
    expect(lines[0].currency).toBe('XOF');
    expect(lines[1].currency).toBe('XOF');
  });

  it('listEntriesForPayment filters by sourceType=payment and sourceId', async () => {
    prisma.journalEntry.findMany.mockResolvedValue([{ id: 'je-1' }] as never);
    await svc.listEntriesForPayment('pay-1');
    const args = prisma.journalEntry.findMany.mock.calls[0][0] as {
      where: unknown;
      include?: unknown;
    };
    expect(args.where).toEqual({ sourceType: 'payment', sourceId: 'pay-1' });
    expect(args.include).toBeDefined();
  });
});
