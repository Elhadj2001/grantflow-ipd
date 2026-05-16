import { Prisma, JournalType, EntryStatus, InvoiceStatus } from '@prisma/client';
import type { BankAccount, Invoice, Payment } from '@prisma/client';
import { PostingService } from '../services/posting.service';
import { PrismaService } from '../../prisma/prisma.service';
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
  let prisma: {
    journalEntry: { create: jest.Mock; update: jest.Mock; count: jest.Mock; findMany: jest.Mock };
    journalLine: { createMany: jest.Mock };
    fiscalPeriod: { findMany: jest.Mock };
    glAccount: { findUnique: jest.Mock };
    $transaction: jest.Mock;
    $executeRawUnsafe: jest.Mock;
  };
  let svc: PostingService;

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
    prisma = {
      journalEntry: {
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn(),
      },
      journalLine: { createMany: jest.fn() },
      fiscalPeriod: { findMany: jest.fn().mockResolvedValue([openPeriod]) },
      glAccount: { findUnique: jest.fn().mockResolvedValue({ code: '521', class: '5' }) },
      $transaction: jest.fn(async (cb: unknown) => {
        if (typeof cb === 'function') return (cb as (tx: unknown) => unknown)(prisma);
        return Promise.all(cb as unknown[]);
      }),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    svc = new PostingService(prisma as unknown as PrismaService);
  });

  it('creates a balanced BQ entry : debit 401 + credit 521', async () => {
    prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
    prisma.journalEntry.update.mockResolvedValue({ id: 'je-1' });
    await svc.postPayment(actor, makePayment(), bankXof);

    const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      accountCode: '401',
      auxiliaryCode: 'ACME',
      debit: 118000,
      credit: 0,
    });
    expect(lines[1]).toMatchObject({
      accountCode: '521',
      debit: 0,
      credit: 118000,
    });
    // balanced
    const totalDebit = lines.reduce(
      (s: number, l: { debit: number }) => s + Number(l.debit),
      0,
    );
    const totalCredit = lines.reduce(
      (s: number, l: { credit: number }) => s + Number(l.credit),
      0,
    );
    expect(totalDebit).toBe(totalCredit);
  });

  it('numbers entry BQ-YYYY-NNNN with sequence count', async () => {
    prisma.journalEntry.count.mockResolvedValue(7);
    prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
    prisma.journalEntry.update.mockResolvedValue({ id: 'je-1' });
    const r = await svc.postPayment(actor, makePayment(), bankXof);
    const year = new Date().getFullYear();
    expect(r.entryNumber).toBe(`BQ-${year}-0008`);
    const createArgs = prisma.journalEntry.create.mock.calls[0][0].data;
    expect(createArgs.journal).toBe(JournalType.BQ);
  });

  it('sourceType=payment + sourceId=payment.id', async () => {
    prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
    prisma.journalEntry.update.mockResolvedValue({ id: 'je-1' });
    await svc.postPayment(actor, makePayment(), bankXof);
    const createArgs = prisma.journalEntry.create.mock.calls[0][0].data;
    expect(createArgs.sourceType).toBe('payment');
    expect(createArgs.sourceId).toBe('pay-1');
  });

  it('label includes supplier code and invoice number', async () => {
    prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
    prisma.journalEntry.update.mockResolvedValue({ id: 'je-1' });
    await svc.postPayment(actor, makePayment(), bankXof);
    const createArgs = prisma.journalEntry.create.mock.calls[0][0].data;
    expect(createArgs.label).toContain('Paiement ACME');
    expect(createArgs.label).toContain('F-001');
  });

  it('promotes entry to posted with postedBy + postedAt', async () => {
    prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
    prisma.journalEntry.update.mockResolvedValue({ id: 'je-1' });
    await svc.postPayment(actor, makePayment(), bankXof);
    const updateArgs = prisma.journalEntry.update.mock.calls[0][0];
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
    prisma.glAccount.findUnique.mockResolvedValue({ code: '601', class: '6' });
    const bank601 = { ...bankXof, glAccountCode: '601' };
    await expect(svc.postPayment(actor, makePayment(), bank601)).rejects.toBeInstanceOf(
      BankAccountWrongClassException,
    );
  });

  it('rejects when bank gl_account does not exist', async () => {
    prisma.glAccount.findUnique.mockResolvedValue(null);
    await expect(svc.postPayment(actor, makePayment(), bankXof)).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });

  it('rejects when fiscal period is closed', async () => {
    prisma.fiscalPeriod.findMany.mockResolvedValue([
      { ...openPeriod, isClosed: true, code: '2026-05' },
    ]);
    await expect(svc.postPayment(actor, makePayment(), bankXof)).rejects.toBeInstanceOf(
      PeriodClosedException,
    );
  });

  it('rejects when no fiscal period covers the payment date', async () => {
    prisma.fiscalPeriod.findMany.mockResolvedValue([]);
    await expect(svc.postPayment(actor, makePayment(), bankXof)).rejects.toBeInstanceOf(
      NoOpenFiscalPeriodException,
    );
  });

  it('records the right currency on each journal line', async () => {
    prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' });
    prisma.journalEntry.update.mockResolvedValue({ id: 'je-1' });
    await svc.postPayment(actor, makePayment(), bankXof);
    const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
    expect(lines[0].currency).toBe('XOF');
    expect(lines[1].currency).toBe('XOF');
  });

  it('listEntriesForPayment filters by sourceType=payment and sourceId', async () => {
    prisma.journalEntry.findMany.mockResolvedValue([{ id: 'je-1' }]);
    await svc.listEntriesForPayment('pay-1');
    const args = prisma.journalEntry.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ sourceType: 'payment', sourceId: 'pay-1' });
    expect(args.include).toBeDefined();
  });
});
