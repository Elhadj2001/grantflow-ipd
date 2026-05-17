import { Prisma, InvoiceStatus } from '@prisma/client';
import type { BankAccount, PaymentRun } from '@prisma/client';
import { PaymentRunService } from '../payment-run.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { PostingService } from '../../../accounting/services/posting.service';
import { IbanFraudService } from '../iban-fraud.service';
import {
  BankAccountInactiveException,
  BankAccountNotFoundException,
  EntityNotFoundException,
  ExchangeRateForPaymentMissingException,
  InvoiceAlreadyInRunException,
  InvoiceNotPayableException,
  MissingIbanException,
  PaymentCurrencyMismatchException,
  PaymentRunCancelReasonRequiredException,
  PaymentRunEmptyException,
  PaymentRunNotApprovableException,
  PaymentRunNotCancellableException,
  PaymentRunNotEditableException,
  PaymentRunNotPreparableException,
  PaymentRunNotRejectableException,
  PaymentRunRejectReasonRequiredException,
} from '../../../common/exceptions/business.exception';

/**
 * Tests unitaires PaymentRunService — couvre :
 *  - createRun : factures payables uniquement, devise matche bankAccount,
 *    pas déjà dans un run actif, numérotation PAY-YYYY-NNNN
 *  - addInvoices / removeInvoices : draft uniquement
 *  - prepare : empty run / IBAN invalide / IBAN absent / warnings
 *  - approve : passe par PostingService.postPayment + bascule
 *    invoice.status à paid / partially_paid
 *  - reject : prepared → rejected, payments → cancelled
 *  - cancel : draft → cancelled
 */
describe('PaymentRunService', () => {
  let prisma: {
    paymentRun: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    payment: {
      findMany: jest.Mock;
      createMany: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
      update: jest.Mock;
      aggregate: jest.Mock;
    };
    invoice: {
      findMany: jest.Mock;
      update: jest.Mock;
    };
    bankAccount: { findUnique: jest.Mock };
    glAccount: { findUnique: jest.Mock };
    $transaction: jest.Mock;
    $executeRawUnsafe: jest.Mock;
  };
  let posting: { postPayment: jest.Mock; listEntriesForPayment: jest.Mock };
  let svc: PaymentRunService;

  const actor = { id: 'usr-1', email: 'tres@x', fullName: 'T' };
  const bankAccountXof: BankAccount = {
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

  function makeInvoice(overrides: Record<string, unknown> = {}) {
    return {
      id: 'inv-1',
      currency: 'XOF',
      totalTtc: new Prisma.Decimal('118000'),
      status: InvoiceStatus.posted,
      payments: [],
      ...overrides,
    };
  }

  function makeRun(overrides: Partial<PaymentRun> = {}): PaymentRun {
    return {
      id: 'run-1',
      runNumber: 'PAY-2026-0001',
      runDate: new Date('2026-05-16'),
      currency: 'XOF',
      bankAccountLegacy: null,
      bankAccountId: bankAccountXof.id,
      preparedBy: actor.id,
      approvedBy: null,
      totalAmount: new Prisma.Decimal('118000'),
      status: 'draft',
      sepaFileKey: null,
      preparationWarnings: null,
      rejectionReason: null,
      approvedAt: null,
      executedAt: null,
      createdAt: new Date(),
      ...overrides,
    } as PaymentRun;
  }

  beforeEach(() => {
    prisma = {
      paymentRun: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      payment: {
        findMany: jest.fn(),
        createMany: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
      },
      invoice: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      bankAccount: { findUnique: jest.fn() },
      glAccount: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb: unknown) => {
        if (typeof cb === 'function') return (cb as (tx: unknown) => unknown)(prisma);
        return Promise.all(cb as unknown[]);
      }),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    posting = {
      postPayment: jest.fn(),
      listEntriesForPayment: jest.fn(),
    };
    const ibanFraud = { checkPaymentRun: jest.fn().mockResolvedValue([]) };
    svc = new PaymentRunService(
      prisma as unknown as PrismaService,
      posting as unknown as PostingService,
      ibanFraud as unknown as IbanFraudService,
    );
  });

  // ------------------------------------------------------------------
  describe('createRun', () => {
    it('creates a draft run with PAY-YYYY-NNNN, payments, and totalAmount', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof);
      prisma.invoice.findMany.mockResolvedValue([makeInvoice()]);
      prisma.payment.findMany.mockResolvedValue([]); // no active link
      prisma.paymentRun.count.mockResolvedValue(0);
      prisma.paymentRun.create.mockResolvedValue(makeRun());
      prisma.paymentRun.findUniqueOrThrow.mockResolvedValue({
        ...makeRun(),
        payments: [{ id: 'p1', amount: new Prisma.Decimal('118000') }],
      });

      const r = await svc.createRun(actor, {
        bankAccountId: bankAccountXof.id,
        invoiceIds: ['inv-1'],
        method: 'sepa',
      });

      const createArgs = prisma.paymentRun.create.mock.calls[0][0].data;
      const year = new Date().getFullYear();
      expect(createArgs.runNumber).toBe(`PAY-${year}-0001`);
      expect(createArgs.status).toBe('draft');
      expect(Number(createArgs.totalAmount)).toBe(118000);
      expect(r).toBeDefined();
    });

    it('rejects INVOICE_NOT_PAYABLE when invoice not posted', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof);
      prisma.invoice.findMany.mockResolvedValue([
        makeInvoice({ status: InvoiceStatus.captured }),
      ]);
      await expect(
        svc.createRun(actor, {
          bankAccountId: bankAccountXof.id,
          invoiceIds: ['inv-1'],
          method: 'sepa',
        }),
      ).rejects.toBeInstanceOf(InvoiceNotPayableException);
    });

    it('multi-currency : converts via ref.exchange_rate when invoice currency differs', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof);
      prisma.invoice.findMany.mockResolvedValue([
        makeInvoice({ currency: 'EUR', totalTtc: new Prisma.Decimal('100') }),
      ]);
      // mock du taux : 1 EUR = 655.957 XOF
      (prisma as unknown as { exchangeRate: { findFirst: jest.Mock } }).exchangeRate = {
        findFirst: jest.fn().mockResolvedValue({ rate: new Prisma.Decimal('655.957') }),
      };
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.paymentRun.count.mockResolvedValue(0);
      prisma.paymentRun.create.mockResolvedValue(makeRun());
      prisma.paymentRun.findUniqueOrThrow.mockResolvedValue({
        ...makeRun(),
        payments: [],
      });

      await svc.createRun(actor, {
        bankAccountId: bankAccountXof.id,
        invoiceIds: ['inv-1'],
        method: 'sepa',
      });
      const payArgs = prisma.payment.createMany.mock.calls[0][0].data;
      expect(Number(payArgs[0].amount)).toBeCloseTo(65595.7, 0); // 100 EUR × 655.957
      expect(payArgs[0].originalCurrency).toBe('EUR');
      expect(Number(payArgs[0].originalAmount)).toBe(100);
      expect(Number(payArgs[0].exchangeRate)).toBe(655.957);
    });

    it('rejects EXCHANGE_RATE_FOR_PAYMENT_MISSING if no rate found', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof);
      prisma.invoice.findMany.mockResolvedValue([
        makeInvoice({ currency: 'USD', totalTtc: new Prisma.Decimal('100') }),
      ]);
      (prisma as unknown as { exchangeRate: { findFirst: jest.Mock } }).exchangeRate = {
        findFirst: jest.fn().mockResolvedValue(null),
      };
      prisma.payment.findMany.mockResolvedValue([]);
      await expect(
        svc.createRun(actor, {
          bankAccountId: bankAccountXof.id,
          invoiceIds: ['inv-1'],
          method: 'sepa',
        }),
      ).rejects.toBeInstanceOf(ExchangeRateForPaymentMissingException);
    });

    it('rejects INVOICE_ALREADY_IN_RUN when invoice already linked', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof);
      prisma.invoice.findMany.mockResolvedValue([makeInvoice()]);
      prisma.payment.findMany.mockResolvedValue([
        {
          invoiceId: 'inv-1',
          paymentRunId: 'other-run',
          paymentRun: { runNumber: 'PAY-2026-0099' },
        },
      ]);
      await expect(
        svc.createRun(actor, {
          bankAccountId: bankAccountXof.id,
          invoiceIds: ['inv-1'],
          method: 'sepa',
        }),
      ).rejects.toBeInstanceOf(InvoiceAlreadyInRunException);
    });

    it('rejects when bank account is inactive', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue({ ...bankAccountXof, isActive: false });
      await expect(
        svc.createRun(actor, {
          bankAccountId: bankAccountXof.id,
          invoiceIds: ['inv-1'],
          method: 'sepa',
        }),
      ).rejects.toBeInstanceOf(BankAccountInactiveException);
    });

    it('rejects unknown bank account', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(null);
      await expect(
        svc.createRun(actor, {
          bankAccountId: 'missing',
          invoiceIds: ['inv-1'],
          method: 'sepa',
        }),
      ).rejects.toBeInstanceOf(BankAccountNotFoundException);
    });

    it('rejects when explicit currency mismatches bank account currency', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof);
      await expect(
        svc.createRun(actor, {
          bankAccountId: bankAccountXof.id,
          currency: 'EUR',
          invoiceIds: ['inv-1'],
          method: 'sepa',
        }),
      ).rejects.toBeInstanceOf(PaymentCurrencyMismatchException);
    });

    it('handles partial payment — remaining = totalTtc − Σ executed payments', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof);
      prisma.invoice.findMany.mockResolvedValue([
        makeInvoice({
          status: InvoiceStatus.partially_paid,
          payments: [{ amount: new Prisma.Decimal('50000') }],
        }),
      ]);
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.paymentRun.count.mockResolvedValue(0);
      prisma.paymentRun.create.mockResolvedValue(makeRun());
      prisma.paymentRun.findUniqueOrThrow.mockResolvedValue({
        ...makeRun(),
        payments: [],
      });

      await svc.createRun(actor, {
        bankAccountId: bankAccountXof.id,
        invoiceIds: ['inv-1'],
        method: 'sepa',
      });
      const payArgs = prisma.payment.createMany.mock.calls[0][0].data;
      expect(Number(payArgs[0].amount)).toBe(68000); // 118000 - 50000
    });
  });

  // ------------------------------------------------------------------
  describe('addInvoices', () => {
    it('rejects when run is not draft', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'prepared' }));
      await expect(
        svc.addInvoices(actor, 'run-1', { invoiceIds: ['inv-2'] }),
      ).rejects.toBeInstanceOf(PaymentRunNotEditableException);
    });

    it('appends invoices to a draft run', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun());
      prisma.invoice.findMany.mockResolvedValue([makeInvoice({ id: 'inv-2' })]);
      prisma.payment.findMany.mockResolvedValueOnce([]); // active link check
      prisma.payment.findMany.mockResolvedValueOnce([
        { amount: new Prisma.Decimal('118000') },
        { amount: new Prisma.Decimal('100000') },
      ]); // sum after add
      prisma.paymentRun.findUniqueOrThrow.mockResolvedValue({
        ...makeRun({ totalAmount: new Prisma.Decimal('218000') }),
        payments: [],
      });

      await svc.addInvoices(actor, 'run-1', { invoiceIds: ['inv-2'] });
      expect(prisma.payment.createMany).toHaveBeenCalled();
      const updateArgs = prisma.paymentRun.update.mock.calls[0][0];
      expect(updateArgs.data.totalAmount).toBe(218000);
    });
  });

  describe('removeInvoices', () => {
    it('rejects when run is not draft', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'executed' }));
      await expect(
        svc.removeInvoices(actor, 'run-1', ['p1']),
      ).rejects.toBeInstanceOf(PaymentRunNotEditableException);
    });

    it('removes payments and recomputes totalAmount', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun());
      prisma.payment.deleteMany.mockResolvedValue({ count: 1 });
      prisma.payment.findMany.mockResolvedValue([{ amount: new Prisma.Decimal('50000') }]);
      prisma.paymentRun.findUniqueOrThrow.mockResolvedValue({
        ...makeRun({ totalAmount: new Prisma.Decimal('50000') }),
        payments: [],
      });

      await svc.removeInvoices(actor, 'run-1', ['p1']);
      const updateArgs = prisma.paymentRun.update.mock.calls[0][0];
      expect(updateArgs.data.totalAmount).toBe(50000);
    });
  });

  // ------------------------------------------------------------------
  describe('prepare', () => {
    it('rejects if run not draft', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'prepared' }));
      await expect(svc.prepare(actor, 'run-1')).rejects.toBeInstanceOf(
        PaymentRunNotPreparableException,
      );
    });

    it('rejects empty run', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun());
      prisma.payment.findMany.mockResolvedValue([]);
      await expect(svc.prepare(actor, 'run-1')).rejects.toBeInstanceOf(PaymentRunEmptyException);
    });

    it('rejects when SEPA payment supplier has no IBAN', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun());
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          invoiceId: 'inv-1',
          method: 'sepa',
          invoice: { id: 'inv-1', supplier: { id: 's1', code: 'ACME', iban: null } },
        },
      ]);
      await expect(svc.prepare(actor, 'run-1')).rejects.toBeInstanceOf(MissingIbanException);
    });

    it('rejects when supplier IBAN has invalid format (mod 97)', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun());
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          invoiceId: 'inv-1',
          method: 'sepa',
          invoice: {
            id: 'inv-1',
            supplier: { id: 's1', code: 'ACME', iban: 'FR9999999999999999999999999' }, // invalide
          },
        },
      ]);
      await expect(svc.prepare(actor, 'run-1')).rejects.toBeInstanceOf(MissingIbanException);
    });

    it('promotes run to prepared with valid IBAN', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun());
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          invoiceId: 'inv-1',
          method: 'sepa',
          invoice: {
            id: 'inv-1',
            supplier: { id: 's1', code: 'ACME', iban: 'FR1420041010050500013M02606' }, // valide
          },
        },
      ]);
      prisma.paymentRun.update.mockResolvedValue(makeRun({ status: 'prepared' }));
      const r = await svc.prepare(actor, 'run-1');
      expect(r.status).toBe('prepared');
    });

    it('accepts cash payment without IBAN (warning only)', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun());
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          invoiceId: 'inv-1',
          method: 'cash',
          invoice: { id: 'inv-1', supplier: { id: 's1', code: 'ACME', iban: null } },
        },
      ]);
      prisma.paymentRun.update.mockResolvedValue(makeRun({ status: 'prepared' }));
      const r = await svc.prepare(actor, 'run-1');
      expect(r.status).toBe('prepared');
      const updateArgs = prisma.paymentRun.update.mock.calls[0][0].data;
      expect(updateArgs.preparationWarnings).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  describe('approve', () => {
    const preparedRun = makeRun({ status: 'prepared' });

    it('rejects if run not prepared', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'draft' }));
      await expect(svc.approve(actor, 'run-1')).rejects.toBeInstanceOf(
        PaymentRunNotApprovableException,
      );
    });

    it('marks invoice as paid when full amount is paid', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(preparedRun);
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof);
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          invoiceId: 'inv-1',
          amount: new Prisma.Decimal('118000'),
          currency: 'XOF',
          invoice: {
            id: 'inv-1',
            invoiceNumber: 'F001',
            totalTtc: new Prisma.Decimal('118000'),
            supplier: { code: 'ACME', name: 'ACME' },
          },
        },
      ]);
      posting.postPayment.mockResolvedValue({
        entryId: 'je-1',
        entryNumber: 'BQ-2026-0001',
        amountXof: 118000,
      });
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal('118000') } });
      prisma.paymentRun.findUniqueOrThrow.mockResolvedValue({ ...preparedRun, status: 'executed' });

      const r = await svc.approve(actor, 'run-1');
      expect(posting.postPayment).toHaveBeenCalled();
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: InvoiceStatus.paid },
      });
      expect(r.status).toBe('executed');
    });

    it('marks invoice as partially_paid when partial', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(preparedRun);
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof);
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          invoiceId: 'inv-1',
          amount: new Prisma.Decimal('50000'),
          currency: 'XOF',
          invoice: {
            id: 'inv-1',
            invoiceNumber: 'F001',
            totalTtc: new Prisma.Decimal('118000'),
            supplier: { code: 'ACME', name: 'ACME' },
          },
        },
      ]);
      posting.postPayment.mockResolvedValue({
        entryId: 'je-1',
        entryNumber: 'BQ-2026-0001',
        amountXof: 50000,
      });
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal('50000') } });
      prisma.paymentRun.findUniqueOrThrow.mockResolvedValue({ ...preparedRun, status: 'executed' });

      await svc.approve(actor, 'run-1');
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: InvoiceStatus.partially_paid },
      });
    });

    it('rejects when run has no bankAccount', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue({ ...preparedRun, bankAccountId: null });
      await expect(svc.approve(actor, 'run-1')).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('rejects when payments list is empty', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(preparedRun);
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof);
      prisma.payment.findMany.mockResolvedValue([]);
      await expect(svc.approve(actor, 'run-1')).rejects.toBeInstanceOf(PaymentRunEmptyException);
    });
  });

  // ------------------------------------------------------------------
  describe('reject', () => {
    it('requires a reason of at least 5 chars', async () => {
      await expect(svc.reject(actor, 'run-1', 'a')).rejects.toBeInstanceOf(
        PaymentRunRejectReasonRequiredException,
      );
    });

    it('rejects when run is not prepared', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'draft' }));
      await expect(svc.reject(actor, 'run-1', 'bad supplier IBAN error')).rejects.toBeInstanceOf(
        PaymentRunNotRejectableException,
      );
    });

    it('cancels payments and marks run as rejected', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'prepared' }));
      prisma.paymentRun.update.mockResolvedValue(
        makeRun({ status: 'rejected', rejectionReason: 'bank refused transfer' }),
      );
      const r = await svc.reject(actor, 'run-1', 'bank refused transfer');
      expect(r.status).toBe('rejected');
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { paymentRunId: 'run-1' },
        data: { status: 'cancelled' },
      });
    });
  });

  // ------------------------------------------------------------------
  describe('cancel', () => {
    it('requires a reason of at least 5 chars', async () => {
      await expect(svc.cancel(actor, 'run-1', 'no')).rejects.toBeInstanceOf(
        PaymentRunCancelReasonRequiredException,
      );
    });

    it('rejects when run is not draft', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'prepared' }));
      await expect(svc.cancel(actor, 'run-1', 'changed our mind')).rejects.toBeInstanceOf(
        PaymentRunNotCancellableException,
      );
    });

    it('cancels a draft run', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun());
      prisma.paymentRun.update.mockResolvedValue(
        makeRun({ status: 'cancelled', rejectionReason: 'changed our mind' }),
      );
      const r = await svc.cancel(actor, 'run-1', 'changed our mind');
      expect(r.status).toBe('cancelled');
    });
  });
});
