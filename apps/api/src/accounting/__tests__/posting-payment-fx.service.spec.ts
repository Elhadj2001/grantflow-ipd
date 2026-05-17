import { Prisma, InvoiceStatus } from '@prisma/client';
import type { BankAccount, Invoice, Payment } from '@prisma/client';
import { PostingService } from '../services/posting.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EntityNotFoundException,
  FxDiffTooLargeException,
} from '../../common/exceptions/business.exception';

/**
 * Tests unitaires PostingService.postPayment — branche multidevises (sprint 5.2).
 *
 * Couvre :
 *  - Gain de change → ligne 766 créditée
 *  - Perte de change → ligne 666 débitée
 *  - Pas de FX line en mono-devise
 *  - payment.fx_gain_loss persisté
 *  - FX_DIFF_TOO_LARGE quand écart > 10%
 *  - Erreur si invoice.exchangeRate manquant en multidevises
 *  - AC reste équilibrée (Σdebit = Σcredit)
 */
describe('PostingService.postPayment — multidevises (sprint 5.2)', () => {
  let prisma: {
    journalEntry: { create: jest.Mock; update: jest.Mock; count: jest.Mock };
    journalLine: { createMany: jest.Mock };
    fiscalPeriod: { findMany: jest.Mock };
    glAccount: { findUnique: jest.Mock };
    payment: { update: jest.Mock };
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

  /**
   * EUR invoice posted at historical rate 655 XOF/EUR.
   * Total TTC = 100 EUR => 65500 XOF originally credited on 401.
   */
  function makeEurPayment(opts: {
    paymentRate: number;
    originalAmount?: number;
  }): Payment & { invoice: Invoice & { supplier: { code: string; name: string } } } {
    const originalAmount = opts.originalAmount ?? 100;
    const amountInXof = originalAmount * opts.paymentRate;
    const invoice = {
      id: 'inv-eur-1',
      invoiceNumber: 'F-EUR-001',
      supplierId: 's1',
      invoiceDate: new Date('2026-05-01'),
      dueDate: new Date('2026-06-01'),
      receivedAt: new Date(),
      status: InvoiceStatus.posted,
      totalHt: new Prisma.Decimal('100'),
      totalVat: new Prisma.Decimal('0'),
      totalTtc: new Prisma.Decimal('100'),
      currency: 'EUR',
      exchangeRate: new Prisma.Decimal('655'),
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
      supplier: { code: 'EU-SUP', name: 'EU Supplier' },
    } as Invoice & { supplier: { code: string; name: string } };

    return {
      id: 'pay-eur-1',
      paymentRunId: 'run-1',
      invoiceId: 'inv-eur-1',
      amount: new Prisma.Decimal(amountInXof.toString()),
      currency: 'XOF',
      originalAmount: new Prisma.Decimal(originalAmount.toString()),
      originalCurrency: 'EUR',
      exchangeRate: new Prisma.Decimal(opts.paymentRate.toString()),
      method: 'sepa',
      paymentDate: new Date('2026-05-17'),
      status: 'executed',
      bankReference: null,
      fxGainLoss: new Prisma.Decimal('0'),
      createdAt: new Date(),
      invoice,
    } as Payment & { invoice: Invoice & { supplier: { code: string; name: string } } };
  }

  beforeEach(() => {
    prisma = {
      journalEntry: {
        create: jest.fn().mockResolvedValue({ id: 'je-1' }),
        update: jest.fn().mockResolvedValue({ id: 'je-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      journalLine: { createMany: jest.fn() },
      fiscalPeriod: { findMany: jest.fn().mockResolvedValue([openPeriod]) },
      glAccount: { findUnique: jest.fn().mockResolvedValue({ code: '521', class: '5' }) },
      payment: { update: jest.fn() },
      $transaction: jest.fn(async (cb: unknown) => {
        if (typeof cb === 'function') return (cb as (tx: unknown) => unknown)(prisma);
        return Promise.all(cb as unknown[]);
      }),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    svc = new PostingService(prisma as unknown as PrismaService);
  });

  it('multidevises GAIN : 401 > bank → ligne 766 créditée', async () => {
    // Invoice posted @ 655, payment @ 650 → 401 was 65500, bank pays 65000 → gain 500
    const payment = makeEurPayment({ paymentRate: 650 });
    const r = await svc.postPayment(actor, payment, bankXof);
    const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ accountCode: '401', debit: 65500, credit: 0 });
    expect(lines[1]).toMatchObject({ accountCode: '521', debit: 0, credit: 65000 });
    expect(lines[2]).toMatchObject({ accountCode: '766', debit: 0, credit: 500 });
    expect(r.fxGainLoss).toBe(500);
  });

  it('multidevises PERTE : bank > 401 → ligne 666 débitée', async () => {
    // Invoice posted @ 655, payment @ 660 → 401 was 65500, bank pays 66000 → loss 500
    const payment = makeEurPayment({ paymentRate: 660 });
    const r = await svc.postPayment(actor, payment, bankXof);
    const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ accountCode: '401', debit: 65500, credit: 0 });
    expect(lines[1]).toMatchObject({ accountCode: '521', debit: 0, credit: 66000 });
    expect(lines[2]).toMatchObject({ accountCode: '666', debit: 500, credit: 0 });
    expect(r.fxGainLoss).toBe(-500);
  });

  it('AC reste équilibrée (Σdebit = Σcredit) avec écart de change', async () => {
    const payment = makeEurPayment({ paymentRate: 660 });
    await svc.postPayment(actor, payment, bankXof);
    const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
    const sumD = lines.reduce((s: number, l: { debit: number }) => s + Number(l.debit), 0);
    const sumC = lines.reduce((s: number, l: { credit: number }) => s + Number(l.credit), 0);
    expect(sumD).toBe(sumC);
    expect(sumD).toBe(66000);
  });

  it('mono-devise (invoice XOF) : pas de ligne FX', async () => {
    const payment = makeEurPayment({ paymentRate: 1 });
    // Override : same currency
    payment.currency = 'XOF';
    payment.originalCurrency = null;
    payment.originalAmount = null;
    payment.exchangeRate = null;
    payment.invoice.currency = 'XOF';
    payment.invoice.exchangeRate = null;
    payment.amount = new Prisma.Decimal('50000');
    await svc.postPayment(actor, payment, bankXof);
    const lines = prisma.journalLine.createMany.mock.calls[0][0].data;
    expect(lines).toHaveLength(2);
    expect(lines.find((l: { accountCode: string }) => l.accountCode === '666')).toBeUndefined();
    expect(lines.find((l: { accountCode: string }) => l.accountCode === '766')).toBeUndefined();
  });

  it('payment.fx_gain_loss persisté en multidevises (gain)', async () => {
    const payment = makeEurPayment({ paymentRate: 650 });
    await svc.postPayment(actor, payment, bankXof);
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-eur-1' },
      data: { fxGainLoss: 500 },
    });
  });

  it('payment.fx_gain_loss persisté en multidevises (perte)', async () => {
    const payment = makeEurPayment({ paymentRate: 660 });
    await svc.postPayment(actor, payment, bankXof);
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-eur-1' },
      data: { fxGainLoss: -500 },
    });
  });

  it('FX_DIFF_TOO_LARGE quand écart > 10% du montant facture', async () => {
    // Invoice @ 655, payment @ 800 → 401=65500, bank=80000, diff -14500 = 22% loss → exceeds 10%
    const payment = makeEurPayment({ paymentRate: 800 });
    await expect(svc.postPayment(actor, payment, bankXof)).rejects.toBeInstanceOf(
      FxDiffTooLargeException,
    );
  });

  it('erreur si invoice.exchangeRate null en multidevises', async () => {
    const payment = makeEurPayment({ paymentRate: 650 });
    payment.invoice.exchangeRate = null;
    await expect(svc.postPayment(actor, payment, bankXof)).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });

  it('result.fxGainLoss = 0 en mono-devise', async () => {
    const payment = makeEurPayment({ paymentRate: 1 });
    payment.currency = 'XOF';
    payment.originalCurrency = null;
    payment.invoice.currency = 'XOF';
    payment.invoice.exchangeRate = null;
    payment.amount = new Prisma.Decimal('50000');
    const r = await svc.postPayment(actor, payment, bankXof);
    expect(r.fxGainLoss).toBe(0);
  });
});
