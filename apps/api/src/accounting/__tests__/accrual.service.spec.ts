import { Prisma } from '@prisma/client';
import type { FiscalPeriod } from '@prisma/client';
import {
  ACCOUNT_FNP,
  ACCOUNT_FALLBACK_EXPENSE,
  AccrualService,
  SOURCE_TYPE_ACCRUAL_FNP,
  SOURCE_TYPE_ACCRUAL_FNP_REVERSAL,
} from '../services/accrual.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PeriodAlreadyClosedException,
  PeriodNotFoundException,
} from '../../common/exceptions/business.exception';

describe('AccrualService (sprint F5b-a Lot 2)', () => {
  const periodId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const nextPeriodId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const actor = {
    id: 'uuuuuuuu-uuuu-uuuu-uuuu-uuuuuuuuuuuu',
    email: 'compta@pasteur.sn',
    fullName: 'Compta',
  };

  const openPeriod: FiscalPeriod = {
    id: periodId,
    code: '2026-04',
    periodType: 'month',
    startDate: new Date('2026-04-01'),
    endDate: new Date('2026-04-30'),
    isClosed: false,
    closedAt: null,
    closedBy: null,
    reopenedAt: null,
    reopenedBy: null,
    reopenReason: null,
  } as unknown as FiscalPeriod;

  const nextOpenPeriod: FiscalPeriod = {
    ...openPeriod,
    id: nextPeriodId,
    code: '2026-05',
    startDate: new Date('2026-05-01'),
    endDate: new Date('2026-05-31'),
  } as FiscalPeriod;

  const closedPeriod: FiscalPeriod = {
    ...openPeriod,
    isClosed: true,
  } as FiscalPeriod;

  /** Construit un GR avec 2 lignes mappées à des budget_lines distincts. */
  function makeReceipt(overrides: Partial<{ id: string; grNumber: string }> = {}) {
    return {
      id: overrides.id ?? 'gr-1',
      grNumber: overrides.grNumber ?? 'GR-2026-0001',
      po: {
        id: 'po-1',
        poNumber: 'BC-2026-0001',
        currency: 'XOF',
        supplierId: 'sup-1',
        prLinks: [{ prId: 'pr-1' }],
      },
      lines: [
        {
          id: 'gl-1',
          quantity: new Prisma.Decimal('10'),
          poLine: {
            id: 'pol-1',
            unitPrice: new Prisma.Decimal('1500'),
            budgetLineId: 'bl-1',
            budgetLine: {
              id: 'bl-1',
              code: 'L01',
              label: 'Consommables',
              defaultAccount: '6041',
              grantId: 'gr-1-uuid',
              grant: { projectId: 'proj-1' },
            },
          },
        },
        {
          id: 'gl-2',
          quantity: new Prisma.Decimal('2'),
          poLine: {
            id: 'pol-2',
            unitPrice: new Prisma.Decimal('25000'),
            budgetLineId: 'bl-2',
            budgetLine: {
              id: 'bl-2',
              code: 'L02',
              label: 'Équipements',
              defaultAccount: null, // pas de default → fallback 605
              grantId: 'gr-1-uuid',
              grant: { projectId: 'proj-1' },
            },
          },
        },
      ],
    };
  }

  type PrismaMock = {
    fiscalPeriod: { findUnique: jest.Mock; findFirst: jest.Mock };
    goodsReceipt: { findMany: jest.Mock };
    journalEntry: { create: jest.Mock; update: jest.Mock; findFirst: jest.Mock };
    journalLine: { createMany: jest.Mock };
    periodCloseEvent: { create: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  let prisma: PrismaMock;
  let svc: AccrualService;
  let createdEntries: Array<{ id: string; sourceType: string | null; lines: Array<{ accountCode: string; debit: number; credit: number }> }>;

  beforeEach(() => {
    createdEntries = [];

    // journalEntry.create renvoie un id unique + on stocke pour les assertions.
    let entryCounter = 0;
    const createEntry = (args: { data: { sourceType: string | null } }) => {
      entryCounter += 1;
      const entry = {
        id: `entry-${entryCounter}`,
        entryNumber: `OD-2026-000${entryCounter}`,
        sourceType: args.data.sourceType ?? null,
      };
      createdEntries.push({ id: entry.id, sourceType: entry.sourceType, lines: [] });
      return Promise.resolve(entry);
    };

    const createManyLines = (args: { data: Array<Record<string, unknown>> }) => {
      // Rattache les lignes à la dernière entry créée — suffisant pour les tests d'équilibre.
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
      goodsReceipt: { findMany: jest.fn().mockResolvedValue([]) },
      journalEntry: {
        create: jest.fn(createEntry),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      journalLine: { createMany: jest.fn(createManyLines) },
      periodCloseEvent: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([]),
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
    svc = new AccrualService(prisma as unknown as PrismaService);
  });

  // ----------------------------------------------------------------
  // Garde-fous
  // ----------------------------------------------------------------

  it('refuse si la période est introuvable', async () => {
    prisma.fiscalPeriod.findUnique.mockResolvedValue(null);
    await expect(svc.runFnpAccruals(actor, periodId)).rejects.toBeInstanceOf(
      PeriodNotFoundException,
    );
  });

  it('refuse si la période est déjà close (PERIOD_ALREADY_CLOSED)', async () => {
    prisma.fiscalPeriod.findUnique.mockResolvedValue(closedPeriod);
    await expect(svc.runFnpAccruals(actor, periodId)).rejects.toBeInstanceOf(
      PeriodAlreadyClosedException,
    );
  });

  it('aucune GR éligible → run renvoie processed=0 + audit event', async () => {
    prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
    prisma.fiscalPeriod.findFirst.mockResolvedValue(nextOpenPeriod);
    prisma.$queryRaw.mockResolvedValue([]);

    const res = await svc.runFnpAccruals(actor, periodId);
    expect(res.processed).toBe(0);
    expect(res.totalAccrued).toBe(0);
    expect(res.lines).toHaveLength(0);
    expect(prisma.periodCloseEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'fnp_accruals' }),
      }),
    );
  });

  // ----------------------------------------------------------------
  // Génération FNP + extourne
  // ----------------------------------------------------------------

  describe('génération FNP', () => {
    beforeEach(() => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.fiscalPeriod.findFirst.mockResolvedValue(nextOpenPeriod);
      prisma.$queryRaw.mockResolvedValue([{ id: 'gr-1' }]);
      prisma.goodsReceipt.findMany.mockResolvedValue([makeReceipt()]);
    });

    it('montant FNP = somme(quantity × unit_price) = 10×1500 + 2×25000 = 65 000', async () => {
      const res = await svc.runFnpAccruals(actor, periodId);
      expect(res.processed).toBe(1);
      expect(res.totalAccrued).toBe(65_000);
      expect(res.lines[0].amount).toBe(65_000);
    });

    it('crée 2 entries (FNP + extourne) chaînées par reversedById', async () => {
      await svc.runFnpAccruals(actor, periodId);
      expect(createdEntries).toHaveLength(2);
      const fnp = createdEntries.find((e) => e.sourceType === SOURCE_TYPE_ACCRUAL_FNP);
      const reversal = createdEntries.find(
        (e) => e.sourceType === SOURCE_TYPE_ACCRUAL_FNP_REVERSAL,
      );
      expect(fnp).toBeDefined();
      expect(reversal).toBeDefined();
      // L'extourne est postée puis la FNP est mise à jour avec reversedById
      const updateCalls = prisma.journalEntry.update.mock.calls;
      const chainUpdate = updateCalls.find(
        (c) => (c[0] as { data: { reversedById?: string } }).data?.reversedById === reversal!.id,
      );
      expect(chainUpdate).toBeDefined();
    });

    it('écriture FNP : débit charges (6041 + 605 fallback) / crédit 408 — équilibre D = C', async () => {
      await svc.runFnpAccruals(actor, periodId);
      const fnp = createdEntries.find((e) => e.sourceType === SOURCE_TYPE_ACCRUAL_FNP)!;
      const totalDebit = fnp.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = fnp.lines.reduce((s, l) => s + l.credit, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(65_000);

      // ligne 6041 = 15 000 (10×1500)
      const line6041 = fnp.lines.find((l) => l.accountCode === '6041');
      expect(line6041?.debit).toBe(15_000);
      // ligne 605 fallback = 50 000 (2×25 000)
      const line605 = fnp.lines.find((l) => l.accountCode === ACCOUNT_FALLBACK_EXPENSE);
      expect(line605?.debit).toBe(50_000);
      // ligne 408 = 65 000 en crédit
      const line408 = fnp.lines.find((l) => l.accountCode === ACCOUNT_FNP);
      expect(line408?.credit).toBe(65_000);
      expect(line408?.debit).toBe(0);
    });

    it('extourne : débit 408 / crédit charges (montants inversés) — équilibre D = C', async () => {
      await svc.runFnpAccruals(actor, periodId);
      const rev = createdEntries.find(
        (e) => e.sourceType === SOURCE_TYPE_ACCRUAL_FNP_REVERSAL,
      )!;
      const totalDebit = rev.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = rev.lines.reduce((s, l) => s + l.credit, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(65_000);

      const line408 = rev.lines.find((l) => l.accountCode === ACCOUNT_FNP);
      expect(line408?.debit).toBe(65_000);
      const lineCharges = rev.lines.filter((l) => l.accountCode !== ACCOUNT_FNP);
      const chargesCredit = lineCharges.reduce((s, l) => s + l.credit, 0);
      expect(chargesCredit).toBe(65_000);
    });

    it('idempotence : si une FNP existe déjà sur ce GR/période → skip silencieux', async () => {
      prisma.journalEntry.findFirst.mockResolvedValue({
        id: 'existing-fnp',
        reversals: [{ id: 'existing-reversal' }],
      });
      const res = await svc.runFnpAccruals(actor, periodId);
      expect(res.processed).toBe(0);
      expect(res.skipped).toBe(1);
      expect(res.lines[0].skippedReason).toBe('already_accrued');
      expect(res.lines[0].accrualEntryId).toBe('existing-fnp');
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });

    it('pas de période suivante → FNP créée SANS extourne (log warn)', async () => {
      prisma.fiscalPeriod.findFirst.mockResolvedValue(null);
      const res = await svc.runFnpAccruals(actor, periodId);
      expect(res.processed).toBe(1);
      expect(res.reversalsPeriodId).toBeNull();
      expect(res.lines[0].reversalEntryId).toBeNull();
      // Une seule entry créée (la FNP)
      expect(createdEntries).toHaveLength(1);
      expect(createdEntries[0].sourceType).toBe(SOURCE_TYPE_ACCRUAL_FNP);
    });

    it('imputation analytique recopiée : grantId/budgetLineId/projectId présents', async () => {
      await svc.runFnpAccruals(actor, periodId);
      const callsCreateMany = prisma.journalLine.createMany.mock.calls;
      // 2 appels : un pour la FNP, un pour l'extourne
      expect(callsCreateMany).toHaveLength(2);
      const firstFnpLines = (
        callsCreateMany[0][0] as { data: Array<Record<string, unknown>> }
      ).data;
      // Toutes les lignes de débit doivent porter l'imputation analytique
      const expenseLines = firstFnpLines.filter(
        (l) => l.accountCode !== ACCOUNT_FNP,
      );
      for (const l of expenseLines) {
        expect(l.grantId).toBe('gr-1-uuid');
        expect(l.projectId).toBe('proj-1');
      }
      const l6041 = firstFnpLines.find((l) => l.accountCode === '6041');
      expect(l6041?.budgetLineId).toBe('bl-1');
    });

    it('GR avec quantité 0 → skip avec reason "no_remaining"', async () => {
      const grZero = makeReceipt({ id: 'gr-zero', grNumber: 'GR-EMPTY' });
      grZero.lines = grZero.lines.map((gl) => ({
        ...gl,
        quantity: new Prisma.Decimal('0'),
      }));
      prisma.$queryRaw.mockResolvedValue([{ id: 'gr-zero' }]);
      prisma.goodsReceipt.findMany.mockResolvedValue([grZero]);

      const res = await svc.runFnpAccruals(actor, periodId);
      expect(res.processed).toBe(0);
      expect(res.skipped).toBe(1);
      expect(res.lines[0].skippedReason).toBe('no_remaining');
    });
  });

  // ----------------------------------------------------------------
  // Multi-GR — accruisalisation indépendante
  // ----------------------------------------------------------------

  it('plusieurs GR éligibles → 1 entry FNP + 1 extourne par GR', async () => {
    prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
    prisma.fiscalPeriod.findFirst.mockResolvedValue(nextOpenPeriod);
    prisma.$queryRaw.mockResolvedValue([{ id: 'gr-1' }, { id: 'gr-2' }]);
    prisma.goodsReceipt.findMany.mockResolvedValue([
      makeReceipt({ id: 'gr-1', grNumber: 'GR-1' }),
      makeReceipt({ id: 'gr-2', grNumber: 'GR-2' }),
    ]);

    const res = await svc.runFnpAccruals(actor, periodId);
    expect(res.processed).toBe(2);
    expect(res.totalAccrued).toBe(130_000); // 2 × 65 000
    expect(createdEntries).toHaveLength(4); // 2 FNP + 2 reversals
  });
});
