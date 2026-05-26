import { Prisma } from '@prisma/client';
import type { FiscalPeriod } from '@prisma/client';
import {
  ACCOUNT_DEFERRED_INCOME,
  ACCOUNT_PREPAID_EXPENSE,
  PrepaymentService,
  SOURCE_TYPE_PREPAYMENT_CCA,
  SOURCE_TYPE_PREPAYMENT_CCA_REVERSAL,
  SOURCE_TYPE_PREPAYMENT_PCA,
  SOURCE_TYPE_PREPAYMENT_PCA_REVERSAL,
} from '../services/prepayment.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EntityNotFoundException,
  InvalidClassPrefixException,
  PeriodAlreadyClosedException,
  PeriodNotFoundException,
} from '../../common/exceptions/business.exception';
import type { PrepaymentEntryInput } from '../dto/prepayment.dto';

describe('PrepaymentService (sprint F5b-a Lot 3)', () => {
  const periodId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const nextPeriodId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const grantId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const actor = {
    id: 'uuuuuuuu-uuuu-uuuu-uuuu-uuuuuuuuuuuu',
    email: 'cg@pasteur.sn',
    fullName: 'CG',
  };

  const openPeriod = {
    id: periodId,
    code: '2026-12',
    periodType: 'month',
    startDate: new Date('2026-12-01'),
    endDate: new Date('2026-12-31'),
    isClosed: false,
  } as unknown as FiscalPeriod;
  const nextPeriod = {
    id: nextPeriodId,
    code: '2027-01',
    periodType: 'month',
    startDate: new Date('2027-01-01'),
    endDate: new Date('2027-01-31'),
    isClosed: false,
  } as unknown as FiscalPeriod;

  type PrismaMock = {
    fiscalPeriod: { findUnique: jest.Mock; findFirst: jest.Mock };
    glAccount: { findMany: jest.Mock };
    journalEntry: { create: jest.Mock; update: jest.Mock; findFirst: jest.Mock };
    journalLine: { createMany: jest.Mock };
    periodCloseEvent: { create: jest.Mock };
    $transaction: jest.Mock;
  };

  let prisma: PrismaMock;
  let svc: PrepaymentService;
  let createdEntries: Array<{
    id: string;
    sourceType: string | null;
    lines: Array<{ accountCode: string; debit: number; credit: number }>;
  }>;

  beforeEach(() => {
    createdEntries = [];

    let counter = 0;
    const createEntry = (args: { data: { sourceType: string | null } }) => {
      counter += 1;
      const e = {
        id: `e-${counter}`,
        entryNumber: `OD-2026-000${counter}`,
        sourceType: args.data.sourceType ?? null,
      };
      createdEntries.push({ id: e.id, sourceType: e.sourceType, lines: [] });
      return Promise.resolve(e);
    };
    const createManyLines = (args: { data: Array<Record<string, unknown>> }) => {
      for (const l of args.data) {
        const entryId = l.entryId as string;
        const found = createdEntries.find((e) => e.id === entryId);
        if (found) {
          found.lines.push({
            accountCode: l.accountCode as string,
            debit: Number((l.debit as Prisma.Decimal) ?? 0),
            credit: Number((l.credit as Prisma.Decimal) ?? 0),
          });
        }
      }
      return Promise.resolve({ count: args.data.length });
    };

    prisma = {
      fiscalPeriod: { findUnique: jest.fn(), findFirst: jest.fn() },
      glAccount: {
        findMany: jest.fn().mockResolvedValue([
          { code: ACCOUNT_PREPAID_EXPENSE, class: '4', label: 'CCA' },
          { code: ACCOUNT_DEFERRED_INCOME, class: '4', label: 'PCA' },
          { code: '622', class: '6', label: 'Locations' },
          { code: '754', class: '7', label: 'Subvention' },
          // '401' utilisé pour le test "INVALID_CLASS_PREFIX" — classe 4
          { code: '401', class: '4', label: 'Fournisseurs' },
        ]),
      },
      journalEntry: {
        create: jest.fn(createEntry),
        update: jest.fn().mockResolvedValue({}),
        // findFirst utilisé par generateEntryNumber (max sequence par année)
        findFirst: jest.fn().mockResolvedValue(null),
      },
      journalLine: { createMany: jest.fn(createManyLines) },
      periodCloseEvent: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => unknown)({
            ...prisma,
            $executeRawUnsafe: jest.fn().mockResolvedValue(0),
          });
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };
    svc = new PrepaymentService(prisma as unknown as PrismaService);
  });

  // ----------------------------------------------------------------
  // Garde-fous
  // ----------------------------------------------------------------

  it('refuse si la période est introuvable', async () => {
    prisma.fiscalPeriod.findUnique.mockResolvedValue(null);
    await expect(
      svc.runPrepayments(actor, periodId, [
        { direction: 'CCA', accountCode: '622', amount: 1000, label: 'X' },
      ]),
    ).rejects.toBeInstanceOf(PeriodNotFoundException);
  });

  it('refuse si la période est déjà close', async () => {
    prisma.fiscalPeriod.findUnique.mockResolvedValue({ ...openPeriod, isClosed: true } as FiscalPeriod);
    await expect(
      svc.runPrepayments(actor, periodId, [
        { direction: 'CCA', accountCode: '622', amount: 1000, label: 'X' },
      ]),
    ).rejects.toBeInstanceOf(PeriodAlreadyClosedException);
  });

  it('refuse si le compte de charge n\'existe pas (404)', async () => {
    prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
    prisma.fiscalPeriod.findFirst.mockResolvedValue(nextPeriod);
    prisma.glAccount.findMany.mockResolvedValue([
      { code: ACCOUNT_PREPAID_EXPENSE, class: '4', label: 'CCA' },
      { code: ACCOUNT_DEFERRED_INCOME, class: '4', label: 'PCA' },
    ]);
    await expect(
      svc.runPrepayments(actor, periodId, [
        { direction: 'CCA', accountCode: '9999', amount: 1000, label: 'X' },
      ]),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  it('refuse si CCA mappée sur compte hors classe 6', async () => {
    prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
    prisma.fiscalPeriod.findFirst.mockResolvedValue(nextPeriod);
    await expect(
      svc.runPrepayments(actor, periodId, [
        { direction: 'CCA', accountCode: '401', amount: 1000, label: 'X' },
      ]),
    ).rejects.toBeInstanceOf(InvalidClassPrefixException);
  });

  it('refuse si PCA mappée sur compte hors classe 7', async () => {
    prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
    prisma.fiscalPeriod.findFirst.mockResolvedValue(nextPeriod);
    await expect(
      svc.runPrepayments(actor, periodId, [
        { direction: 'PCA', accountCode: '622', amount: 1000, label: 'X' },
      ]),
    ).rejects.toBeInstanceOf(InvalidClassPrefixException);
  });

  // ----------------------------------------------------------------
  // CCA — Charge constatée d'avance
  // ----------------------------------------------------------------

  describe('CCA', () => {
    beforeEach(() => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.fiscalPeriod.findFirst.mockResolvedValue(nextPeriod);
    });

    const ccaInput: PrepaymentEntryInput = {
      direction: 'CCA',
      accountCode: '622',
      amount: 12_000,
      grantId,
      label: 'Loyer janvier 2027 prépayé en déc. 2026',
      sourceReference: 'INV-2026-Q4-LOC-001',
    };

    it('crée 1 OD régularisation + 1 OD extourne', async () => {
      const res = await svc.runPrepayments(actor, periodId, [ccaInput]);
      expect(res.processed).toBe(1);
      expect(res.totalCca).toBe(12_000);
      expect(res.totalPca).toBe(0);
      expect(createdEntries).toHaveLength(2);
      expect(
        createdEntries.find((e) => e.sourceType === SOURCE_TYPE_PREPAYMENT_CCA),
      ).toBeDefined();
      expect(
        createdEntries.find((e) => e.sourceType === SOURCE_TYPE_PREPAYMENT_CCA_REVERSAL),
      ).toBeDefined();
    });

    it('écriture clôture : Débit 476 / Crédit 622 — équilibre D = C', async () => {
      await svc.runPrepayments(actor, periodId, [ccaInput]);
      const cca = createdEntries.find((e) => e.sourceType === SOURCE_TYPE_PREPAYMENT_CCA)!;
      const totalDebit = cca.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = cca.lines.reduce((s, l) => s + l.credit, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(12_000);

      const l476 = cca.lines.find((l) => l.accountCode === ACCOUNT_PREPAID_EXPENSE);
      const l622 = cca.lines.find((l) => l.accountCode === '622');
      expect(l476?.debit).toBe(12_000);
      expect(l476?.credit).toBe(0);
      expect(l622?.debit).toBe(0);
      expect(l622?.credit).toBe(12_000);
    });

    it('extourne : Débit 622 / Crédit 476 — équilibre D = C', async () => {
      await svc.runPrepayments(actor, periodId, [ccaInput]);
      const rev = createdEntries.find(
        (e) => e.sourceType === SOURCE_TYPE_PREPAYMENT_CCA_REVERSAL,
      )!;
      const totalDebit = rev.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = rev.lines.reduce((s, l) => s + l.credit, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(12_000);

      const l476 = rev.lines.find((l) => l.accountCode === ACCOUNT_PREPAID_EXPENSE);
      const l622 = rev.lines.find((l) => l.accountCode === '622');
      expect(l622?.debit).toBe(12_000);
      expect(l476?.credit).toBe(12_000);
    });

    it('imputation analytique grantId présente sur les deux écritures', async () => {
      await svc.runPrepayments(actor, periodId, [ccaInput]);
      const callsCreateMany = prisma.journalLine.createMany.mock.calls;
      // 2 appels : régularisation + extourne, 2 lignes chacun
      for (const call of callsCreateMany) {
        const lines = (call[0] as { data: Array<Record<string, unknown>> }).data;
        for (const l of lines) {
          expect(l.grantId).toBe(grantId);
        }
      }
    });
  });

  // ----------------------------------------------------------------
  // PCA — Produit constaté d'avance
  // ----------------------------------------------------------------

  describe('PCA', () => {
    beforeEach(() => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.fiscalPeriod.findFirst.mockResolvedValue(nextPeriod);
    });

    const pcaInput: PrepaymentEntryInput = {
      direction: 'PCA',
      accountCode: '754',
      amount: 50_000,
      grantId,
      label: 'Subvention reçue déc. 2026 — prestation 2027',
    };

    it('écriture clôture : Débit 754 / Crédit 477 — équilibre D = C', async () => {
      await svc.runPrepayments(actor, periodId, [pcaInput]);
      const pca = createdEntries.find((e) => e.sourceType === SOURCE_TYPE_PREPAYMENT_PCA)!;
      const totalDebit = pca.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = pca.lines.reduce((s, l) => s + l.credit, 0);
      expect(totalDebit).toBe(totalCredit);

      const l754 = pca.lines.find((l) => l.accountCode === '754');
      const l477 = pca.lines.find((l) => l.accountCode === ACCOUNT_DEFERRED_INCOME);
      expect(l754?.debit).toBe(50_000);
      expect(l477?.credit).toBe(50_000);
    });

    it('extourne : Débit 477 / Crédit 754 — équilibre D = C', async () => {
      await svc.runPrepayments(actor, periodId, [pcaInput]);
      const rev = createdEntries.find(
        (e) => e.sourceType === SOURCE_TYPE_PREPAYMENT_PCA_REVERSAL,
      )!;
      const l754 = rev.lines.find((l) => l.accountCode === '754');
      const l477 = rev.lines.find((l) => l.accountCode === ACCOUNT_DEFERRED_INCOME);
      expect(l477?.debit).toBe(50_000);
      expect(l754?.credit).toBe(50_000);
    });
  });

  // ----------------------------------------------------------------
  // Plusieurs entrées + sans période suivante
  // ----------------------------------------------------------------

  it('plusieurs entrées CCA + PCA → totaux ventilés correctement', async () => {
    prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
    prisma.fiscalPeriod.findFirst.mockResolvedValue(nextPeriod);

    const res = await svc.runPrepayments(actor, periodId, [
      { direction: 'CCA', accountCode: '622', amount: 10_000, label: 'CCA 1' },
      { direction: 'CCA', accountCode: '622', amount: 5_000, label: 'CCA 2' },
      { direction: 'PCA', accountCode: '754', amount: 8_000, label: 'PCA 1' },
    ]);
    expect(res.processed).toBe(3);
    expect(res.totalCca).toBe(15_000);
    expect(res.totalPca).toBe(8_000);
    expect(createdEntries).toHaveLength(6); // 3 × (reg + reversal)
  });

  it('pas de période suivante → reg créée sans extourne', async () => {
    prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
    prisma.fiscalPeriod.findFirst.mockResolvedValue(null);

    const res = await svc.runPrepayments(actor, periodId, [
      { direction: 'CCA', accountCode: '622', amount: 1000, label: 'X' },
    ]);
    expect(res.reversalsPeriodId).toBeNull();
    expect(res.lines[0].reversalEntryId).toBeNull();
    expect(createdEntries).toHaveLength(1);
  });

  it('audit : crée un period_close_event "prepayments_regularization"', async () => {
    prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
    prisma.fiscalPeriod.findFirst.mockResolvedValue(nextPeriod);
    await svc.runPrepayments(actor, periodId, [
      { direction: 'CCA', accountCode: '622', amount: 1000, label: 'X' },
    ]);
    expect(prisma.periodCloseEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'prepayments_regularization',
          userId: actor.id,
        }),
      }),
    );
  });
});
