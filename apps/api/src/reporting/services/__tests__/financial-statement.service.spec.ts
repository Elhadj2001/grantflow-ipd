import { FinancialStatementService } from '../financial-statement.service';
import {
  FinancialStatementGeneratorService,
  type StatementResult,
} from '../financial-statement-generator.service';
import { StatementRenderService } from '../statement-render.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../../common/services/storage.service';
import {
  FinancialStatementFileNotGeneratedException,
  FinancialStatementLockedException,
  FinancialStatementNotBalancedException,
  FinancialStatementNotFoundException,
  PeriodNotFoundException,
} from '../../../common/exceptions/business.exception';

describe('FinancialStatementService', () => {
  const periodId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const statementId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const actor = { id: 'uuu', email: 'daf@pasteur.sn', fullName: 'DAF Test' };
  const openPeriod = {
    id: periodId,
    code: '2026-01',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-01-31'),
    isClosed: false,
  };

  type PrismaMock = {
    fiscalPeriod: { findUnique: jest.Mock };
    financialStatement: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    financialStatementLine: { deleteMany: jest.Mock; createMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const balancedResult: StatementResult = {
    type: 'TER',
    periodId,
    periodCode: '2026-01',
    lines: [
      { section: 'EMPLOIS', label: '661 — X', accountCode: '661', debit: 100, credit: 0, balance: 100, sortOrder: 0 },
      { section: 'RESSOURCES', label: '754 — Y', accountCode: '754', debit: 0, credit: 100, balance: 100, sortOrder: 1 },
    ],
    totals: { leftTotal: 100, rightTotal: 100, balanced: true },
  };

  let prisma: PrismaMock;
  let generator: jest.Mocked<FinancialStatementGeneratorService>;
  let renderer: jest.Mocked<StatementRenderService>;
  let storage: jest.Mocked<StorageService>;
  let svc: FinancialStatementService;

  beforeEach(() => {
    prisma = {
      fiscalPeriod: { findUnique: jest.fn() },
      financialStatement: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      financialStatementLine: { deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    generator = {
      generate: jest.fn().mockResolvedValue(balancedResult),
      assertBalanced: jest.fn(),
    } as unknown as jest.Mocked<FinancialStatementGeneratorService>;
    renderer = {
      renderPdf: jest.fn().mockResolvedValue(Buffer.from('PDF')),
      renderExcel: jest.fn().mockReturnValue(Buffer.from('XLS')),
    } as unknown as jest.Mocked<StatementRenderService>;
    storage = {
      putObject: jest.fn().mockResolvedValue({ objectKey: 'k', bucket: 'b' }),
      getObject: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;
    svc = new FinancialStatementService(
      prisma as unknown as PrismaService,
      generator,
      renderer,
      storage,
    );
  });

  describe('generate', () => {
    it('throws PeriodNotFoundException when period missing', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(null);
      await expect(svc.generate(actor, periodId, 'TER')).rejects.toBeInstanceOf(
        PeriodNotFoundException,
      );
    });

    it('throws FinancialStatementLockedException when existing+locked', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.financialStatement.findUnique.mockResolvedValue({
        id: statementId,
        locked: true,
      });
      await expect(svc.generate(actor, periodId, 'TER')).rejects.toBeInstanceOf(
        FinancialStatementLockedException,
      );
    });

    it('creates new statement when none exists', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.financialStatement.findUnique.mockResolvedValue(null);
      prisma.financialStatement.create.mockResolvedValue({ id: statementId, type: 'TER' });
      const r = await svc.generate(actor, periodId, 'TER');
      expect(r).toMatchObject({ id: statementId });
      expect(generator.assertBalanced).toHaveBeenCalled();
      expect(prisma.financialStatement.create).toHaveBeenCalled();
      expect(storage.putObject).toHaveBeenCalledTimes(2);
    });

    it('updates existing statement (overwrite) when not locked', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.financialStatement.findUnique.mockResolvedValue({
        id: statementId,
        locked: false,
      });
      prisma.financialStatement.update.mockResolvedValue({ id: statementId, type: 'TER' });
      const r = await svc.generate(actor, periodId, 'TER');
      expect(prisma.financialStatement.update).toHaveBeenCalled();
      expect(prisma.financialStatementLine.deleteMany).toHaveBeenCalledWith({
        where: { statementId },
      });
      expect(r.id).toBe(statementId);
    });

    it('propagates FinancialStatementNotBalancedException from generator', async () => {
      prisma.fiscalPeriod.findUnique.mockResolvedValue(openPeriod);
      prisma.financialStatement.findUnique.mockResolvedValue(null);
      generator.assertBalanced.mockImplementation(() => {
        throw new FinancialStatementNotBalancedException('TER', 100, 90);
      });
      await expect(svc.generate(actor, periodId, 'TER')).rejects.toBeInstanceOf(
        FinancialStatementNotBalancedException,
      );
      expect(prisma.financialStatement.create).not.toHaveBeenCalled();
    });
  });

  describe('lock', () => {
    it('throws FinancialStatementNotFoundException when missing', async () => {
      prisma.financialStatement.findUnique.mockResolvedValue(null);
      await expect(svc.lock(actor, statementId)).rejects.toBeInstanceOf(
        FinancialStatementNotFoundException,
      );
    });

    it('returns the same statement if already locked (idempotent)', async () => {
      const existing = { id: statementId, locked: true, type: 'TER' };
      prisma.financialStatement.findUnique.mockResolvedValue(existing);
      const r = await svc.lock(actor, statementId);
      expect(r).toBe(existing);
      expect(prisma.financialStatement.update).not.toHaveBeenCalled();
    });

    it('locks when not already locked', async () => {
      prisma.financialStatement.findUnique.mockResolvedValue({ id: statementId, locked: false, type: 'TER' });
      prisma.financialStatement.update.mockResolvedValue({ id: statementId, locked: true });
      await svc.lock(actor, statementId);
      expect(prisma.financialStatement.update).toHaveBeenCalledWith({
        where: { id: statementId },
        data: expect.objectContaining({ locked: true, lockedBy: actor.id }),
      });
    });
  });

  describe('findOne / list', () => {
    it('throws FinancialStatementNotFoundException when missing', async () => {
      prisma.financialStatement.findUnique.mockResolvedValue(null);
      await expect(svc.findOne(statementId)).rejects.toBeInstanceOf(
        FinancialStatementNotFoundException,
      );
    });

    it('returns lines + period when found', async () => {
      const expected = { id: statementId, lines: [], period: openPeriod };
      prisma.financialStatement.findUnique.mockResolvedValue(expected);
      const r = await svc.findOne(statementId);
      expect(r).toBe(expected);
    });

    it('list filters by periodId + type', async () => {
      prisma.financialStatement.findMany.mockResolvedValue([]);
      await svc.list(periodId, 'TER');
      expect(prisma.financialStatement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { periodId, type: 'TER' } }),
      );
    });
  });

  describe('downloads', () => {
    it('throws FinancialStatementFileNotGeneratedException when no pdfObjectKey', async () => {
      prisma.financialStatement.findUnique.mockResolvedValue({
        id: statementId,
        pdfObjectKey: null,
        xlsxObjectKey: null,
        period: openPeriod,
      });
      await expect(svc.downloadPdf(statementId)).rejects.toBeInstanceOf(
        FinancialStatementFileNotGeneratedException,
      );
      await expect(svc.downloadExcel(statementId)).rejects.toBeInstanceOf(
        FinancialStatementFileNotGeneratedException,
      );
    });

    it('downloads pdf when key is set', async () => {
      prisma.financialStatement.findUnique.mockResolvedValue({
        id: statementId,
        type: 'TER',
        pdfObjectKey: 'statements/2026/01/TER-x.pdf',
        period: openPeriod,
      });
      storage.getObject.mockResolvedValue({ buffer: Buffer.from('PDF'), contentType: 'application/pdf', size: 3 });
      const r = await svc.downloadPdf(statementId);
      expect(r.filename).toContain('TER');
    });
  });
});
