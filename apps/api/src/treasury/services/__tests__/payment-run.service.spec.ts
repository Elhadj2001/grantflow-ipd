import { Prisma, InvoiceStatus } from '@prisma/client';
import type { BankAccount, PaymentRun } from '@prisma/client';
import { PaymentRunService } from '../payment-run.service';
import { PostingService } from '../../../accounting/services/posting.service';
import { createPrismaMock, type PrismaMock } from '../../../test-utils/prisma-mock';
import {
  BankAccountInactiveException,
  BankAccountNotFoundException,
  EntityNotFoundException,
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
  let prisma: PrismaMock;
  let posting: { postPayment: jest.Mock; listEntriesForPayment: jest.Mock };
  let svc: PaymentRunService;

  // Projections typées des arguments lus sur `*.mock.calls` (les délégués
  // DeepMockProxy exposent des types union Prisma non-indexables → TS7053).
  type RunCreateArg = { runNumber: string; status: string; totalAmount: number };
  const runCreateData = (calls: unknown[][]): RunCreateArg =>
    (calls[0][0] as { data: RunCreateArg }).data;

  type PaymentCreateArg = { amount: Prisma.Decimal | number };
  const paymentCreateData = (calls: unknown[][]): PaymentCreateArg[] =>
    (calls[0][0] as { data: PaymentCreateArg[] }).data;

  type RunUpdateArg = {
    data: { totalAmount?: number; preparationWarnings?: unknown };
  };
  const runUpdateArg = (calls: unknown[][]): RunUpdateArg => calls[0][0] as RunUpdateArg;

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
    prisma = createPrismaMock();
    // `$executeRawUnsafe` est utilisé par le générateur de numéro de run
    // (advisory lock) ; le passthrough de `$transaction` re-passe `prisma`
    // comme `tx`, donc ce stub couvre l'usage in-transaction.
    prisma.$executeRawUnsafe.mockResolvedValue(1 as never);
    posting = {
      postPayment: jest.fn(),
      listEntriesForPayment: jest.fn(),
    };
    // Sprint F4a — IbanFraudService + SepaService injectés
    const ibanFraud = {
      computeAlertsForRun: jest.fn().mockResolvedValue([]),
      countUnacknowledged: jest.fn().mockReturnValue(0),
      acknowledgeAll: jest.fn((alerts: unknown[]) => alerts),
      maskIban: jest.fn((s: string) => s),
    };
    const sepa = {
      generate: jest.fn().mockReturnValue('<Document/>'),
      validateStructure: jest.fn().mockReturnValue({ valid: true, missing: [] }),
    };
    svc = new PaymentRunService(
      prisma,
      posting as unknown as PostingService,
      ibanFraud as unknown as import('../iban-fraud.service').IbanFraudService,
      sepa as unknown as import('../sepa.service').SepaService,
    );
  });

  // ------------------------------------------------------------------
  describe('createRun', () => {
    it('creates a draft run with PAY-YYYY-NNNN, payments, and totalAmount', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof as never);
      prisma.invoice.findMany.mockResolvedValue([makeInvoice()] as never);
      prisma.payment.findMany.mockResolvedValue([] as never); // no active link
      prisma.paymentRun.findFirst.mockResolvedValue(null as never); // dernier seq (générateur)
      prisma.paymentRun.create.mockResolvedValue(makeRun() as never);
      prisma.paymentRun.findUniqueOrThrow.mockResolvedValue({
        ...makeRun(),
        payments: [{ id: 'p1', amount: new Prisma.Decimal('118000') }],
      } as never);

      const r = await svc.createRun(actor, {
        bankAccountId: bankAccountXof.id,
        invoiceIds: ['inv-1'],
        method: 'sepa',
      });

      const createArgs = runCreateData(prisma.paymentRun.create.mock.calls);
      const year = new Date().getFullYear();
      expect(createArgs.runNumber).toBe(`PAY-${year}-0001`);
      expect(createArgs.status).toBe('draft');
      expect(Number(createArgs.totalAmount)).toBe(118000);
      expect(r).toBeDefined();
    });

    it('rejects INVOICE_NOT_PAYABLE when invoice not posted', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof as never);
      prisma.invoice.findMany.mockResolvedValue([
        makeInvoice({ status: InvoiceStatus.captured }),
      ] as never);
      await expect(
        svc.createRun(actor, {
          bankAccountId: bankAccountXof.id,
          invoiceIds: ['inv-1'],
          method: 'sepa',
        }),
      ).rejects.toBeInstanceOf(InvoiceNotPayableException);
    });

    it('rejects PAYMENT_CURRENCY_MISMATCH when invoice currency differs from bank', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof as never);
      prisma.invoice.findMany.mockResolvedValue([makeInvoice({ currency: 'EUR' })] as never);
      await expect(
        svc.createRun(actor, {
          bankAccountId: bankAccountXof.id,
          invoiceIds: ['inv-1'],
          method: 'sepa',
        }),
      ).rejects.toBeInstanceOf(PaymentCurrencyMismatchException);
    });

    it('rejects INVOICE_ALREADY_IN_RUN when invoice already linked', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof as never);
      prisma.invoice.findMany.mockResolvedValue([makeInvoice()] as never);
      prisma.payment.findMany.mockResolvedValue([
        {
          invoiceId: 'inv-1',
          paymentRunId: 'other-run',
          paymentRun: { runNumber: 'PAY-2026-0099' },
        },
      ] as never);
      await expect(
        svc.createRun(actor, {
          bankAccountId: bankAccountXof.id,
          invoiceIds: ['inv-1'],
          method: 'sepa',
        }),
      ).rejects.toBeInstanceOf(InvoiceAlreadyInRunException);
    });

    it('rejects when bank account is inactive', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue({ ...bankAccountXof, isActive: false } as never);
      await expect(
        svc.createRun(actor, {
          bankAccountId: bankAccountXof.id,
          invoiceIds: ['inv-1'],
          method: 'sepa',
        }),
      ).rejects.toBeInstanceOf(BankAccountInactiveException);
    });

    it('rejects unknown bank account', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(null as never);
      await expect(
        svc.createRun(actor, {
          bankAccountId: 'missing',
          invoiceIds: ['inv-1'],
          method: 'sepa',
        }),
      ).rejects.toBeInstanceOf(BankAccountNotFoundException);
    });

    it('rejects when explicit currency mismatches bank account currency', async () => {
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof as never);
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
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof as never);
      prisma.invoice.findMany.mockResolvedValue([
        makeInvoice({
          status: InvoiceStatus.partially_paid,
          payments: [{ amount: new Prisma.Decimal('50000') }],
        }),
      ] as never);
      prisma.payment.findMany.mockResolvedValue([] as never);
      prisma.paymentRun.findFirst.mockResolvedValue(null as never); // dernier seq (générateur)
      prisma.paymentRun.create.mockResolvedValue(makeRun() as never);
      prisma.paymentRun.findUniqueOrThrow.mockResolvedValue({
        ...makeRun(),
        payments: [],
      } as never);

      await svc.createRun(actor, {
        bankAccountId: bankAccountXof.id,
        invoiceIds: ['inv-1'],
        method: 'sepa',
      });
      const payArgs = paymentCreateData(prisma.payment.createMany.mock.calls);
      expect(Number(payArgs[0].amount)).toBe(68000); // 118000 - 50000
    });
  });

  // ------------------------------------------------------------------
  describe('addInvoices', () => {
    it('rejects when run is not draft', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'prepared' }) as never);
      await expect(
        svc.addInvoices(actor, 'run-1', { invoiceIds: ['inv-2'] }),
      ).rejects.toBeInstanceOf(PaymentRunNotEditableException);
    });

    it('appends invoices to a draft run', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun() as never);
      prisma.invoice.findMany.mockResolvedValue([makeInvoice({ id: 'inv-2' })] as never);
      prisma.payment.findMany.mockResolvedValueOnce([] as never); // active link check
      prisma.payment.findMany.mockResolvedValueOnce([
        { amount: new Prisma.Decimal('118000') },
        { amount: new Prisma.Decimal('100000') },
      ] as never); // sum after add
      prisma.paymentRun.findUniqueOrThrow.mockResolvedValue({
        ...makeRun({ totalAmount: new Prisma.Decimal('218000') }),
        payments: [],
      } as never);

      await svc.addInvoices(actor, 'run-1', { invoiceIds: ['inv-2'] });
      expect(prisma.payment.createMany).toHaveBeenCalled();
      const updateArgs = runUpdateArg(prisma.paymentRun.update.mock.calls);
      expect(updateArgs.data.totalAmount).toBe(218000);
    });
  });

  describe('removeInvoices', () => {
    it('rejects when run is not draft', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'executed' }) as never);
      await expect(
        svc.removeInvoices(actor, 'run-1', ['p1']),
      ).rejects.toBeInstanceOf(PaymentRunNotEditableException);
    });

    it('removes payments and recomputes totalAmount', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun() as never);
      prisma.payment.deleteMany.mockResolvedValue({ count: 1 } as never);
      prisma.payment.findMany.mockResolvedValue([{ amount: new Prisma.Decimal('50000') }] as never);
      prisma.paymentRun.findUniqueOrThrow.mockResolvedValue({
        ...makeRun({ totalAmount: new Prisma.Decimal('50000') }),
        payments: [],
      } as never);

      await svc.removeInvoices(actor, 'run-1', ['p1']);
      const updateArgs = runUpdateArg(prisma.paymentRun.update.mock.calls);
      expect(updateArgs.data.totalAmount).toBe(50000);
    });
  });

  // ------------------------------------------------------------------
  describe('prepare', () => {
    it('rejects if run not draft', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'prepared' }) as never);
      await expect(svc.prepare(actor, 'run-1')).rejects.toBeInstanceOf(
        PaymentRunNotPreparableException,
      );
    });

    it('rejects empty run', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun() as never);
      prisma.payment.findMany.mockResolvedValue([] as never);
      await expect(svc.prepare(actor, 'run-1')).rejects.toBeInstanceOf(PaymentRunEmptyException);
    });

    it('rejects when SEPA payment supplier has no IBAN', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun() as never);
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          invoiceId: 'inv-1',
          method: 'sepa',
          invoice: { id: 'inv-1', supplier: { id: 's1', code: 'ACME', iban: null } },
        },
      ] as never);
      await expect(svc.prepare(actor, 'run-1')).rejects.toBeInstanceOf(MissingIbanException);
    });

    it('rejects when supplier IBAN has invalid format (mod 97)', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun() as never);
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
      ] as never);
      await expect(svc.prepare(actor, 'run-1')).rejects.toBeInstanceOf(MissingIbanException);
    });

    it('promotes run to prepared with valid IBAN', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun() as never);
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
      ] as never);
      prisma.paymentRun.update.mockResolvedValue(makeRun({ status: 'prepared' }) as never);
      const r = await svc.prepare(actor, 'run-1');
      expect(r.status).toBe('prepared');
    });

    it('accepts cash payment without IBAN (warning only)', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun() as never);
      prisma.payment.findMany.mockResolvedValue([
        {
          id: 'p1',
          invoiceId: 'inv-1',
          method: 'cash',
          invoice: { id: 'inv-1', supplier: { id: 's1', code: 'ACME', iban: null } },
        },
      ] as never);
      prisma.paymentRun.update.mockResolvedValue(makeRun({ status: 'prepared' }) as never);
      const r = await svc.prepare(actor, 'run-1');
      expect(r.status).toBe('prepared');
      const updateArgs = runUpdateArg(prisma.paymentRun.update.mock.calls).data;
      expect(updateArgs.preparationWarnings).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  describe('approve', () => {
    const preparedRun = makeRun({ status: 'prepared' });

    it('rejects if run not prepared', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'draft' }) as never);
      await expect(svc.approve(actor, 'run-1')).rejects.toBeInstanceOf(
        PaymentRunNotApprovableException,
      );
    });

    it('marks invoice as paid when full amount is paid', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(preparedRun as never);
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof as never);
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
      ] as never);
      posting.postPayment.mockResolvedValue({
        entryId: 'je-1',
        entryNumber: 'BQ-2026-0001',
        amountXof: 118000,
      });
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal('118000') } } as never);
      prisma.paymentRun.findUniqueOrThrow.mockResolvedValue({ ...preparedRun, status: 'executed' } as never);

      const r = await svc.approve(actor, 'run-1');
      expect(posting.postPayment).toHaveBeenCalled();
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: InvoiceStatus.paid },
      });
      expect(r.status).toBe('executed');
    });

    it('marks invoice as partially_paid when partial', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(preparedRun as never);
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof as never);
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
      ] as never);
      posting.postPayment.mockResolvedValue({
        entryId: 'je-1',
        entryNumber: 'BQ-2026-0001',
        amountXof: 50000,
      });
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal('50000') } } as never);
      prisma.paymentRun.findUniqueOrThrow.mockResolvedValue({ ...preparedRun, status: 'executed' } as never);

      await svc.approve(actor, 'run-1');
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: InvoiceStatus.partially_paid },
      });
    });

    it('rejects when run has no bankAccount', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue({ ...preparedRun, bankAccountId: null } as never);
      await expect(svc.approve(actor, 'run-1')).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('rejects when payments list is empty', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(preparedRun as never);
      prisma.bankAccount.findUnique.mockResolvedValue(bankAccountXof as never);
      prisma.payment.findMany.mockResolvedValue([] as never);
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
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'draft' }) as never);
      await expect(svc.reject(actor, 'run-1', 'bad supplier IBAN error')).rejects.toBeInstanceOf(
        PaymentRunNotRejectableException,
      );
    });

    it('cancels payments and marks run as rejected', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'prepared' }) as never);
      prisma.paymentRun.update.mockResolvedValue(
        makeRun({ status: 'rejected', rejectionReason: 'bank refused transfer' }) as never,
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
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun({ status: 'prepared' }) as never);
      await expect(svc.cancel(actor, 'run-1', 'changed our mind')).rejects.toBeInstanceOf(
        PaymentRunNotCancellableException,
      );
    });

    it('cancels a draft run', async () => {
      prisma.paymentRun.findUnique.mockResolvedValue(makeRun() as never);
      prisma.paymentRun.update.mockResolvedValue(
        makeRun({ status: 'cancelled', rejectionReason: 'changed our mind' }) as never,
      );
      const r = await svc.cancel(actor, 'run-1', 'changed our mind');
      expect(r.status).toBe('cancelled');
    });
  });
});
