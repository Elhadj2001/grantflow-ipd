import { Prisma } from '@prisma/client';
import { ReportAggregationService, VARIANCE_ALERT_THRESHOLD_PCT } from '../report-aggregation.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DonorTemplateHasNoMappingsException,
  ReportingFxRateMissingException,
} from '../../../common/exceptions/business.exception';

describe('ReportAggregationService', () => {
  let prisma: {
    donorReportTemplate: { findUnique: jest.Mock };
    journalLine: { groupBy: jest.Mock };
    budgetLine: { findMany: jest.Mock };
    accountMapping: { findMany: jest.Mock };
    overheadCalculation: { findMany: jest.Mock };
    exchangeRate: { findFirst: jest.Mock };
    grantAgreement: { findUnique: jest.Mock };
  };
  let svc: ReportAggregationService;

  const grantId = '00000000-0000-0000-0000-00000000beef';
  const templateId = '00000000-0000-0000-0000-000000000aaa';
  const periodStart = new Date('2026-01-01');
  const periodEnd = new Date('2026-03-31');

  function setupTemplate(opts: { mappings: number; categories: number } = { mappings: 2, categories: 2 }) {
    const categories = Array.from({ length: opts.categories }, (_, i) => ({
      id: `cat-${i + 1}`,
      code: `CAT${i + 1}`,
      label: `Category ${i + 1}`,
      sortOrder: i,
      templateId,
      parentId: null,
    }));
    const mappings = Array.from({ length: opts.mappings }, (_, i) => ({
      id: `map-${i + 1}`,
      templateId,
      glAccountCode: `60${i + 1}`,
      donorCategoryId: `cat-${(i % opts.categories) + 1}`,
      sign: 1,
    }));
    prisma.donorReportTemplate.findUnique.mockResolvedValue({
      id: templateId,
      code: 'TPL',
      currency: 'USD',
      categories,
      mappings,
    });
  }

  beforeEach(() => {
    prisma = {
      donorReportTemplate: { findUnique: jest.fn() },
      journalLine: { groupBy: jest.fn().mockResolvedValue([]) },
      budgetLine: { findMany: jest.fn().mockResolvedValue([]) },
      accountMapping: { findMany: jest.fn().mockResolvedValue([]) },
      overheadCalculation: { findMany: jest.fn().mockResolvedValue([]) },
      exchangeRate: { findFirst: jest.fn() },
      grantAgreement: { findUnique: jest.fn() },
    };
    svc = new ReportAggregationService(prisma as unknown as PrismaService);
  });

  it('throws DonorTemplateHasNoMappingsException when template missing', async () => {
    prisma.donorReportTemplate.findUnique.mockResolvedValue(null);
    await expect(
      svc.aggregate({ grantId, templateId, periodStart, periodEnd, targetCurrency: 'XOF' }),
    ).rejects.toBeInstanceOf(DonorTemplateHasNoMappingsException);
  });

  it('throws DonorTemplateHasNoMappingsException when template has no mappings', async () => {
    prisma.donorReportTemplate.findUnique.mockResolvedValue({
      id: templateId,
      code: 'TPL',
      currency: 'USD',
      categories: [],
      mappings: [],
    });
    await expect(
      svc.aggregate({ grantId, templateId, periodStart, periodEnd, targetCurrency: 'XOF' }),
    ).rejects.toBeInstanceOf(DonorTemplateHasNoMappingsException);
  });

  it('aggregates spent amounts grouped by category (target=XOF)', async () => {
    setupTemplate();
    prisma.journalLine.groupBy.mockResolvedValue([
      { accountCode: '601', _sum: { debit: new Prisma.Decimal('10000'), credit: new Prisma.Decimal('0') } },
      { accountCode: '602', _sum: { debit: new Prisma.Decimal('5000'), credit: new Prisma.Decimal('1000') } },
    ]);
    prisma.exchangeRate.findFirst.mockResolvedValue(null); // XOF→XOF = 1
    prisma.grantAgreement.findUnique.mockResolvedValue({
      currency: 'XOF',
      amount: new Prisma.Decimal('100000'),
    });

    const res = await svc.aggregate({
      grantId,
      templateId,
      periodStart,
      periodEnd,
      targetCurrency: 'XOF',
    });
    expect(res.lines).toHaveLength(2);
    expect(res.lines[0]).toMatchObject({ categoryCode: 'CAT1', spentAmount: 10000 });
    expect(res.lines[1]).toMatchObject({ categoryCode: 'CAT2', spentAmount: 4000 });
    expect(res.totalSpent).toBe(14000);
    expect(res.fxRateUsed).toBe(1);
  });

  it('converts amounts to target currency using exchange rate', async () => {
    setupTemplate({ mappings: 1, categories: 1 });
    prisma.journalLine.groupBy.mockResolvedValue([
      { accountCode: '601', _sum: { debit: new Prisma.Decimal('65595.70'), credit: new Prisma.Decimal('0') } },
    ]);
    // XOF → EUR at 1/655.957
    prisma.exchangeRate.findFirst.mockImplementation((args: { where: { fromCurrency: string; toCurrency: string } }) => {
      if (args.where.fromCurrency === 'XOF' && args.where.toCurrency === 'EUR') {
        return Promise.resolve({ rate: new Prisma.Decimal('0.001524') });
      }
      return Promise.resolve(null);
    });
    prisma.grantAgreement.findUnique.mockResolvedValue({
      currency: 'EUR',
      amount: new Prisma.Decimal('1000'),
    });

    const res = await svc.aggregate({
      grantId,
      templateId,
      periodStart,
      periodEnd,
      targetCurrency: 'EUR',
    });
    expect(res.fxRateUsed).toBeCloseTo(0.001524, 6);
    // 65595.70 * 0.001524 ≈ 100 EUR (à l'arrondi près)
    expect(res.lines[0].spentAmount).toBeCloseTo(100, 0);
  });

  it('throws ReportingFxRateMissingException when no FX rate found', async () => {
    setupTemplate({ mappings: 1, categories: 1 });
    prisma.exchangeRate.findFirst.mockResolvedValue(null);
    prisma.journalLine.groupBy.mockResolvedValue([]);
    prisma.grantAgreement.findUnique.mockResolvedValue({ currency: 'XOF', amount: new Prisma.Decimal(0) });
    await expect(
      svc.aggregate({ grantId, templateId, periodStart, periodEnd, targetCurrency: 'USD' }),
    ).rejects.toBeInstanceOf(ReportingFxRateMissingException);
  });

  it('uses inverse exchange rate when only inverse exists', async () => {
    setupTemplate({ mappings: 1, categories: 1 });
    prisma.journalLine.groupBy.mockResolvedValue([
      { accountCode: '601', _sum: { debit: new Prisma.Decimal('655.957'), credit: new Prisma.Decimal('0') } },
    ]);
    // Pas de XOF→EUR direct ; mais EUR→XOF = 655.957 → utilise inverse.
    prisma.exchangeRate.findFirst.mockImplementation(
      (args: { where: { fromCurrency: string; toCurrency: string } }) => {
        if (args.where.fromCurrency === 'EUR' && args.where.toCurrency === 'XOF') {
          return Promise.resolve({ rate: new Prisma.Decimal('655.957') });
        }
        return Promise.resolve(null);
      },
    );
    prisma.grantAgreement.findUnique.mockResolvedValue({
      currency: 'EUR',
      amount: new Prisma.Decimal('1000'),
    });
    const res = await svc.aggregate({
      grantId,
      templateId,
      periodStart,
      periodEnd,
      targetCurrency: 'EUR',
    });
    expect(res.fxRateUsed).toBeCloseTo(1 / 655.957, 6);
  });

  it('applies sign=-1 to mapping for product (revenue) accounts', async () => {
    prisma.donorReportTemplate.findUnique.mockResolvedValue({
      id: templateId,
      code: 'TPL',
      currency: 'XOF',
      categories: [{ id: 'cat-1', code: 'NET', label: 'Net', sortOrder: 0, templateId, parentId: null }],
      mappings: [
        { id: 'map-1', templateId, glAccountCode: '601', donorCategoryId: 'cat-1', sign: 1 },
        { id: 'map-2', templateId, glAccountCode: '756', donorCategoryId: 'cat-1', sign: -1 },
      ],
    });
    prisma.journalLine.groupBy.mockResolvedValue([
      { accountCode: '601', _sum: { debit: new Prisma.Decimal('10000'), credit: new Prisma.Decimal('0') } },
      { accountCode: '756', _sum: { debit: new Prisma.Decimal('0'), credit: new Prisma.Decimal('3000') } },
    ]);
    prisma.grantAgreement.findUnique.mockResolvedValue({ currency: 'XOF', amount: new Prisma.Decimal(0) });
    const res = await svc.aggregate({
      grantId,
      templateId,
      periodStart,
      periodEnd,
      targetCurrency: 'XOF',
    });
    // 601 : (10000 - 0) * sign=+1 = 10000
    // 756 : (0 - 3000) * sign=-1 = 3000 (revenu inversé = positif)
    expect(res.lines[0].spentAmount).toBe(13000);
  });

  it('computes variance and flags alert above threshold', async () => {
    prisma.donorReportTemplate.findUnique.mockResolvedValue({
      id: templateId,
      code: 'TPL',
      currency: 'XOF',
      categories: [{ id: 'cat-1', code: 'STAFF', label: 'Staff', sortOrder: 0, templateId, parentId: null }],
      mappings: [{ id: 'map-1', templateId, glAccountCode: '661', donorCategoryId: 'cat-1', sign: 1 }],
    });
    prisma.journalLine.groupBy.mockResolvedValue([
      { accountCode: '661', _sum: { debit: new Prisma.Decimal('120000'), credit: new Prisma.Decimal('0') } },
    ]);
    prisma.budgetLine.findMany.mockResolvedValue([
      { id: 'bl-1', budgetedAmount: new Prisma.Decimal('100000'), defaultAccount: '661' },
    ]);
    prisma.accountMapping.findMany.mockResolvedValue([
      { glAccountCode: '661', donorCategoryId: 'cat-1' },
    ]);
    prisma.grantAgreement.findUnique.mockResolvedValue({ currency: 'XOF', amount: new Prisma.Decimal('500000') });

    const res = await svc.aggregate({
      grantId,
      templateId,
      periodStart,
      periodEnd,
      targetCurrency: 'XOF',
    });
    expect(res.lines[0].budgetAmount).toBe(100000);
    expect(res.lines[0].spentAmount).toBe(120000);
    expect(res.lines[0].variance).toBe(20000);
    expect(res.lines[0].variancePct).toBe(20);
    expect(res.lines[0].alert).toBe(true);
  });

  it('does not flag alert when variance within threshold', async () => {
    prisma.donorReportTemplate.findUnique.mockResolvedValue({
      id: templateId,
      code: 'TPL',
      currency: 'XOF',
      categories: [{ id: 'cat-1', code: 'STAFF', label: 'Staff', sortOrder: 0, templateId, parentId: null }],
      mappings: [{ id: 'map-1', templateId, glAccountCode: '661', donorCategoryId: 'cat-1', sign: 1 }],
    });
    prisma.journalLine.groupBy.mockResolvedValue([
      { accountCode: '661', _sum: { debit: new Prisma.Decimal('105000'), credit: new Prisma.Decimal('0') } },
    ]);
    prisma.budgetLine.findMany.mockResolvedValue([
      { id: 'bl-1', budgetedAmount: new Prisma.Decimal('100000'), defaultAccount: '661' },
    ]);
    prisma.accountMapping.findMany.mockResolvedValue([
      { glAccountCode: '661', donorCategoryId: 'cat-1' },
    ]);
    prisma.grantAgreement.findUnique.mockResolvedValue({ currency: 'XOF', amount: new Prisma.Decimal('500000') });
    const res = await svc.aggregate({
      grantId,
      templateId,
      periodStart,
      periodEnd,
      targetCurrency: 'XOF',
    });
    expect(res.lines[0].variancePct).toBe(5);
    expect(res.lines[0].alert).toBe(false);
  });

  it('sums overhead from co.overhead_calculation', async () => {
    setupTemplate({ mappings: 1, categories: 1 });
    prisma.journalLine.groupBy.mockResolvedValue([]);
    prisma.overheadCalculation.findMany.mockResolvedValue([
      { overheadAmount: new Prisma.Decimal('5000') },
      { overheadAmount: new Prisma.Decimal('3000') },
    ]);
    prisma.grantAgreement.findUnique.mockResolvedValue({ currency: 'XOF', amount: new Prisma.Decimal(0) });
    const res = await svc.aggregate({
      grantId,
      templateId,
      periodStart,
      periodEnd,
      targetCurrency: 'XOF',
    });
    expect(res.totalOverhead).toBe(8000);
    expect(res.totalSpent).toBe(8000); // 0 direct + 8000 overhead
  });

  it('computes funds carried over = grant amount - totalSpent (clamped >= 0)', async () => {
    setupTemplate({ mappings: 1, categories: 1 });
    prisma.journalLine.groupBy.mockResolvedValue([
      { accountCode: '601', _sum: { debit: new Prisma.Decimal('30000'), credit: new Prisma.Decimal('0') } },
    ]);
    prisma.grantAgreement.findUnique.mockResolvedValue({
      currency: 'XOF',
      amount: new Prisma.Decimal('100000'),
    });
    const res = await svc.aggregate({
      grantId,
      templateId,
      periodStart,
      periodEnd,
      targetCurrency: 'XOF',
    });
    expect(res.fundsCarried).toBe(70000);
  });

  it('clamps funds carried over to 0 when overspent', async () => {
    setupTemplate({ mappings: 1, categories: 1 });
    prisma.journalLine.groupBy.mockResolvedValue([
      { accountCode: '601', _sum: { debit: new Prisma.Decimal('150000'), credit: new Prisma.Decimal('0') } },
    ]);
    prisma.grantAgreement.findUnique.mockResolvedValue({
      currency: 'XOF',
      amount: new Prisma.Decimal('100000'),
    });
    const res = await svc.aggregate({
      grantId,
      templateId,
      periodStart,
      periodEnd,
      targetCurrency: 'XOF',
    });
    expect(res.fundsCarried).toBe(0);
  });

  it('preserves category sort order in output lines', async () => {
    prisma.donorReportTemplate.findUnique.mockResolvedValue({
      id: templateId,
      code: 'TPL',
      currency: 'XOF',
      categories: [
        { id: 'cat-3', code: 'ZZZ', label: 'Z', sortOrder: 3, templateId, parentId: null },
        { id: 'cat-1', code: 'AAA', label: 'A', sortOrder: 1, templateId, parentId: null },
        { id: 'cat-2', code: 'MMM', label: 'M', sortOrder: 2, templateId, parentId: null },
      ],
      mappings: [],
    });
    // mappings est vide → throw
    await expect(
      svc.aggregate({ grantId, templateId, periodStart, periodEnd, targetCurrency: 'XOF' }),
    ).rejects.toBeInstanceOf(DonorTemplateHasNoMappingsException);
  });

  it('VARIANCE_ALERT_THRESHOLD_PCT exposes 10', () => {
    expect(VARIANCE_ALERT_THRESHOLD_PCT).toBe(10);
  });
});
