import { Prisma } from '@prisma/client';
import { DonorReportService } from '../donor-report.service';
import { ReportAggregationService } from '../report-aggregation.service';
import { PdfRenderService } from '../pdf-render.service';
import { ExcelRenderService } from '../excel-render.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../../common/services/storage.service';
import {
  DonorReportAlreadySentException,
  DonorReportFileNotGeneratedException,
  DonorReportNotDraftException,
  DonorReportNotFoundException,
  DonorReportNotLockedException,
  DonorTemplateNotFoundException,
  ReportingPeriodInvalidException,
} from '../../../common/exceptions/business.exception';

describe('DonorReportService', () => {
  let prisma: {
    donorReport: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    donorReportTemplate: { findUnique: jest.Mock };
    donorReportLine: { createMany: jest.Mock };
    grantAgreement: { findUnique: jest.Mock };
    project: { findFirst: jest.Mock };
    appUser: { findUnique: jest.Mock };
    journalLine: { groupBy: jest.Mock };
    glAccount: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let aggregation: { aggregate: jest.Mock };
  let pdf: { render: jest.Mock };
  let excel: { render: jest.Mock };
  let storage: { putObject: jest.Mock; getObject: jest.Mock };
  let svc: DonorReportService;

  const actor = { id: 'u-1', email: 'cg@x', fullName: 'CG' };
  const grantId = 'g-1';
  const templateId = 't-1';
  const reportId = 'r-1';

  function makeReport(overrides: Record<string, unknown> = {}) {
    return {
      id: reportId,
      grantId,
      templateId,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-03-31'),
      status: 'draft',
      currency: 'USD',
      fxRateUsed: new Prisma.Decimal('0.001524'),
      totalBudget: new Prisma.Decimal('100'),
      totalSpent: new Prisma.Decimal('80'),
      totalOverhead: new Prisma.Decimal('5'),
      fundsCarried: new Prisma.Decimal('20'),
      generatedBy: actor.id,
      generatedAt: new Date('2026-05-17T12:00:00Z'),
      pdfObjectKey: null,
      excelObjectKey: null,
      lockedBy: null,
      lockedAt: null,
      sentBy: null,
      sentAt: null,
      notes: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = {
      donorReport: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      donorReportTemplate: { findUnique: jest.fn() },
      donorReportLine: { createMany: jest.fn() },
      grantAgreement: { findUnique: jest.fn() },
      project: { findFirst: jest.fn() },
      appUser: { findUnique: jest.fn() },
      journalLine: { groupBy: jest.fn().mockResolvedValue([]) },
      glAccount: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };
    aggregation = {
      aggregate: jest.fn().mockResolvedValue({
        lines: [],
        totalBudget: 100,
        totalSpent: 80,
        totalOverhead: 5,
        fundsCarried: 20,
        fxRateUsed: 0.001524,
      }),
    };
    pdf = { render: jest.fn().mockResolvedValue(Buffer.from('PDFCONTENT')) };
    excel = { render: jest.fn().mockReturnValue(Buffer.from('XLSXCONTENT')) };
    storage = {
      putObject: jest.fn().mockResolvedValue({ bucket: 'b', objectKey: 'k' }),
      getObject: jest.fn(),
    };
    svc = new DonorReportService(
      prisma as unknown as PrismaService,
      aggregation as unknown as ReportAggregationService,
      pdf as unknown as PdfRenderService,
      excel as unknown as ExcelRenderService,
      storage as unknown as StorageService,
    );
  });

  describe('create', () => {
    it('throws ReportingPeriodInvalidException when periodEnd < periodStart', async () => {
      await expect(
        svc.create(actor, {
          grantId,
          templateId,
          periodStart: new Date('2026-03-31'),
          periodEnd: new Date('2026-01-01'),
        } as never),
      ).rejects.toBeInstanceOf(ReportingPeriodInvalidException);
    });

    it('throws DonorTemplateNotFoundException when template missing', async () => {
      prisma.donorReportTemplate.findUnique.mockResolvedValue(null);
      await expect(
        svc.create(actor, {
          grantId,
          templateId,
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-03-31'),
        } as never),
      ).rejects.toBeInstanceOf(DonorTemplateNotFoundException);
    });

    it('throws ReportingPeriodInvalidException when period outside grant range', async () => {
      prisma.donorReportTemplate.findUnique.mockResolvedValue({ id: templateId, currency: 'USD' });
      prisma.grantAgreement.findUnique.mockResolvedValue({
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-12-31'),
      });
      await expect(
        svc.create(actor, {
          grantId,
          templateId,
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-03-31'),
        } as never),
      ).rejects.toBeInstanceOf(ReportingPeriodInvalidException);
    });

    it('creates draft report + lines, persists snapshot of aggregation', async () => {
      prisma.donorReportTemplate.findUnique.mockResolvedValue({ id: templateId, currency: 'USD' });
      prisma.grantAgreement.findUnique.mockResolvedValue({
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      });
      aggregation.aggregate.mockResolvedValue({
        lines: [
          {
            donorCategoryId: 'cat-1',
            categoryCode: 'X',
            categoryLabel: 'X',
            budgetAmount: 100,
            spentAmount: 80,
            variance: -20,
            variancePct: -20,
            alert: true,
          },
        ],
        totalBudget: 100,
        totalSpent: 80,
        totalOverhead: 5,
        fundsCarried: 20,
        fxRateUsed: 0.001524,
      });
      prisma.donorReport.create.mockResolvedValue(makeReport());
      const r = await svc.create(actor, {
        grantId,
        templateId,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
      } as never);
      expect(r.id).toBe(reportId);
      expect(prisma.donorReportLine.createMany).toHaveBeenCalled();
      const linesArg = prisma.donorReportLine.createMany.mock.calls[0][0].data;
      expect(linesArg[0].categoryCode).toBe('X');
    });
  });

  describe('lock', () => {
    it('generates PDF + Excel + persists keys + sets status=locked', async () => {
      prisma.donorReport.findUnique.mockResolvedValue({
        ...makeReport(),
        lines: [],
        template: { code: 'TPL', name: 'TPL', currency: 'USD', donor: { label: 'USAID' } },
        grant: { reference: 'G-1', currency: 'USD', amount: new Prisma.Decimal('1000') },
      });
      prisma.project.findFirst.mockResolvedValue({ title: 'Project', code: 'P-1' });
      prisma.appUser.findUnique.mockResolvedValue({ email: 'cg@x', fullName: 'CG' });
      prisma.donorReport.update.mockResolvedValue({
        ...makeReport({ status: 'locked', pdfObjectKey: 'k1', excelObjectKey: 'k2' }),
      });
      const r = await svc.lock(actor, reportId);
      expect(pdf.render).toHaveBeenCalled();
      expect(excel.render).toHaveBeenCalled();
      expect(storage.putObject).toHaveBeenCalledTimes(2);
      expect(r.status).toBe('locked');
    });

    it('throws DonorReportAlreadySentException when status=sent', async () => {
      prisma.donorReport.findUnique.mockResolvedValue({
        ...makeReport({ status: 'sent' }),
        lines: [],
        template: { donor: null, code: 'X', name: 'X' },
        grant: { reference: 'G' },
      });
      await expect(svc.lock(actor, reportId)).rejects.toBeInstanceOf(
        DonorReportAlreadySentException,
      );
    });

    it('throws DonorReportNotDraftException for unsupported status', async () => {
      prisma.donorReport.findUnique.mockResolvedValue({
        ...makeReport({ status: 'unknown' }),
        lines: [],
        template: { donor: null, code: 'X', name: 'X' },
        grant: { reference: 'G' },
      });
      await expect(svc.lock(actor, reportId)).rejects.toBeInstanceOf(
        DonorReportNotDraftException,
      );
    });

    it('re-locks a locked report idempotently (regenerates files)', async () => {
      prisma.donorReport.findUnique.mockResolvedValue({
        ...makeReport({ status: 'locked' }),
        lines: [],
        template: { donor: null, code: 'X', name: 'X' },
        grant: { reference: 'G' },
      });
      prisma.project.findFirst.mockResolvedValue(null);
      prisma.appUser.findUnique.mockResolvedValue(null);
      prisma.donorReport.update.mockResolvedValue(makeReport({ status: 'locked' }));
      await svc.lock(actor, reportId);
      expect(storage.putObject).toHaveBeenCalledTimes(2);
    });
  });

  describe('send', () => {
    it('throws DonorReportNotFoundException when missing', async () => {
      prisma.donorReport.findUnique.mockResolvedValue(null);
      await expect(svc.send(actor, reportId, {} as never)).rejects.toBeInstanceOf(
        DonorReportNotFoundException,
      );
    });

    it('throws DonorReportAlreadySentException when already sent', async () => {
      prisma.donorReport.findUnique.mockResolvedValue(makeReport({ status: 'sent' }));
      await expect(svc.send(actor, reportId, {} as never)).rejects.toBeInstanceOf(
        DonorReportAlreadySentException,
      );
    });

    it('throws DonorReportNotLockedException when not in locked', async () => {
      prisma.donorReport.findUnique.mockResolvedValue(makeReport({ status: 'draft' }));
      await expect(svc.send(actor, reportId, {} as never)).rejects.toBeInstanceOf(
        DonorReportNotLockedException,
      );
    });

    it('marks status=sent + sentBy + sentAt + appends externalReference to notes', async () => {
      prisma.donorReport.findUnique.mockResolvedValue(makeReport({ status: 'locked' }));
      prisma.donorReport.update.mockResolvedValue(makeReport({ status: 'sent', sentBy: actor.id }));
      await svc.send(actor, reportId, { externalReference: 'REF-001', notes: 'all good' } as never);
      const updateArgs = prisma.donorReport.update.mock.calls[0][0];
      expect(updateArgs.data.status).toBe('sent');
      expect(updateArgs.data.sentBy).toBe(actor.id);
      expect(updateArgs.data.notes).toContain('[sent ref=REF-001]');
    });
  });

  describe('downloadPdf / downloadExcel', () => {
    it('downloadPdf throws DonorReportNotFoundException when missing', async () => {
      prisma.donorReport.findUnique.mockResolvedValue(null);
      await expect(svc.downloadPdf(reportId)).rejects.toBeInstanceOf(
        DonorReportNotFoundException,
      );
    });

    it('downloadPdf throws DonorReportFileNotGeneratedException when pdfObjectKey null', async () => {
      prisma.donorReport.findUnique.mockResolvedValue({
        id: reportId,
        pdfObjectKey: null,
        periodEnd: new Date(),
      });
      await expect(svc.downloadPdf(reportId)).rejects.toBeInstanceOf(
        DonorReportFileNotGeneratedException,
      );
    });

    it('downloadExcel throws DonorReportFileNotGeneratedException when excelObjectKey null', async () => {
      prisma.donorReport.findUnique.mockResolvedValue({
        id: reportId,
        excelObjectKey: null,
      });
      await expect(svc.downloadExcel(reportId)).rejects.toBeInstanceOf(
        DonorReportFileNotGeneratedException,
      );
    });

    it('downloadPdf returns buffer + filename when key exists', async () => {
      prisma.donorReport.findUnique.mockResolvedValue({
        id: reportId,
        pdfObjectKey: 'k1',
        periodEnd: new Date(),
      });
      storage.getObject.mockResolvedValue({
        buffer: Buffer.from('PDFCONTENT'),
        contentType: 'application/pdf',
        size: 10,
      });
      const r = await svc.downloadPdf(reportId);
      expect(r.buffer.toString()).toBe('PDFCONTENT');
      expect(r.filename).toMatch(/\.pdf$/);
    });
  });

  // ----------------------------------------------------------------
  // Sprint F5b-a Lot 1 — RBAC BAILLEUR sur findOne / findMany
  // ----------------------------------------------------------------
  describe('RBAC BAILLEUR (sprint F5b-a Lot 1)', () => {
    const cgUser = {
      id: 'cg-id',
      email: 'cg@pasteur.sn',
      fullName: 'CG',
      roles: ['CONTROLEUR' as const],
    };
    const bailleurUser = {
      id: 'b-id',
      email: 'audit@usaid.gov',
      fullName: 'Audit',
      roles: ['BAILLEUR' as const],
    };

    it('findOne : CG voit un rapport draft', async () => {
      prisma.donorReport.findUnique.mockResolvedValue(makeReport({ status: 'draft' }));
      const r = await svc.findOne(cgUser, reportId);
      expect(r.status).toBe('draft');
    });

    it('findOne : BAILLEUR pur sur draft → DonorReportNotFoundException', async () => {
      prisma.donorReport.findUnique.mockResolvedValue(makeReport({ status: 'draft' }));
      await expect(svc.findOne(bailleurUser, reportId)).rejects.toBeInstanceOf(
        DonorReportNotFoundException,
      );
    });

    it('findOne : BAILLEUR pur sur locked → DonorReportNotFoundException', async () => {
      prisma.donorReport.findUnique.mockResolvedValue(makeReport({ status: 'locked' }));
      await expect(svc.findOne(bailleurUser, reportId)).rejects.toBeInstanceOf(
        DonorReportNotFoundException,
      );
    });

    it('findOne : BAILLEUR pur sur sent → autorisé', async () => {
      prisma.donorReport.findUnique.mockResolvedValue(makeReport({ status: 'sent' }));
      const r = await svc.findOne(bailleurUser, reportId);
      expect(r.status).toBe('sent');
    });

    it('findMany : BAILLEUR pur → status forcé à "sent" même si query.status=draft', async () => {
      prisma.donorReport.findMany.mockResolvedValue([]);
      await svc.findMany(bailleurUser, { status: 'draft' });
      expect(prisma.donorReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'sent' }),
        }),
      );
    });

    it('findMany : CG → status pass-through (draft autorisé)', async () => {
      prisma.donorReport.findMany.mockResolvedValue([]);
      await svc.findMany(cgUser, { status: 'draft' });
      expect(prisma.donorReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'draft' }),
        }),
      );
    });

    it('BAILLEUR + DAF (cumul) : pas de restriction', async () => {
      const dual = { ...bailleurUser, roles: ['BAILLEUR' as const, 'DAF' as const] };
      prisma.donorReport.findUnique.mockResolvedValue(makeReport({ status: 'draft' }));
      const r = await svc.findOne(dual, reportId);
      expect(r.status).toBe('draft');
    });
  });
});
