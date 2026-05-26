import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DonorReport } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/services/storage.service';
import {
  DonorReportAlreadySentException,
  DonorReportFileNotGeneratedException,
  DonorReportNotDraftException,
  DonorReportNotFoundException,
  DonorReportNotLockedException,
  DonorTemplateNotFoundException,
  EntityNotFoundException,
  ReportingPeriodInvalidException,
} from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { isBailleurOnly } from '../../auth/types/rbac-helpers';
import { ReportAggregationService } from './report-aggregation.service';
import { PdfRenderService } from './pdf-render.service';
import { ExcelRenderService } from './excel-render.service';
import type { CreateDonorReportDto, SendDonorReportDto } from '../dto/donor-report.dto';

export const REPORTING_BUCKET = 'grantflow-reports';

export interface ReportActor {
  id: string;
  email: string;
  fullName?: string;
}

@Injectable()
export class DonorReportService {
  private readonly logger = new Logger(DonorReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aggregation: ReportAggregationService,
    private readonly pdf: PdfRenderService,
    private readonly excel: ExcelRenderService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------------
  // Création / lecture
  // ------------------------------------------------------------------

  async create(actor: ReportActor, dto: CreateDonorReportDto): Promise<DonorReport> {
    if (dto.periodEnd < dto.periodStart) {
      throw new ReportingPeriodInvalidException(
        dto.periodStart.toISOString().slice(0, 10),
        dto.periodEnd.toISOString().slice(0, 10),
        'periodEnd must be >= periodStart',
      );
    }
    const template = await this.prisma.donorReportTemplate.findUnique({
      where: { id: dto.templateId },
    });
    if (!template) throw new DonorTemplateNotFoundException(dto.templateId);
    const grant = await this.prisma.grantAgreement.findUnique({ where: { id: dto.grantId } });
    if (!grant) throw new EntityNotFoundException('GrantAgreement', { id: dto.grantId });
    // Période doit être incluse dans la grant (sinon flag d'erreur — utile
    // au bailleur USAID qui refuse les rapports débordant)
    if (dto.periodStart < grant.startDate || dto.periodEnd > grant.endDate) {
      throw new ReportingPeriodInvalidException(
        dto.periodStart.toISOString().slice(0, 10),
        dto.periodEnd.toISOString().slice(0, 10),
        `Period must be within grant range ${grant.startDate
          .toISOString()
          .slice(0, 10)} → ${grant.endDate.toISOString().slice(0, 10)}`,
      );
    }

    // Agrégation
    const agg = await this.aggregation.aggregate({
      grantId: dto.grantId,
      templateId: dto.templateId,
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      targetCurrency: template.currency,
    });

    return this.prisma.$transaction(async (tx) => {
      const report = await tx.donorReport.create({
        data: {
          grantId: dto.grantId,
          templateId: dto.templateId,
          periodStart: dto.periodStart,
          periodEnd: dto.periodEnd,
          status: 'draft',
          currency: template.currency,
          fxRateUsed: new Prisma.Decimal(agg.fxRateUsed.toString()),
          totalBudget: new Prisma.Decimal(agg.totalBudget.toString()),
          totalSpent: new Prisma.Decimal(agg.totalSpent.toString()),
          totalOverhead: new Prisma.Decimal(agg.totalOverhead.toString()),
          fundsCarried: new Prisma.Decimal(agg.fundsCarried.toString()),
          generatedBy: actor.id,
          notes: dto.notes ?? null,
        },
      });
      if (agg.lines.length > 0) {
        await tx.donorReportLine.createMany({
          data: agg.lines.map((l) => ({
            reportId: report.id,
            donorCategoryId: l.donorCategoryId,
            categoryCode: l.categoryCode,
            categoryLabel: l.categoryLabel,
            budgetAmount: new Prisma.Decimal(l.budgetAmount.toString()),
            spentAmount: new Prisma.Decimal(l.spentAmount.toString()),
            variance: new Prisma.Decimal(l.variance.toString()),
            variancePct: new Prisma.Decimal(l.variancePct.toString()),
          })),
        });
      }

      this.logger.log(
        {
          reportId: report.id,
          template: template.code,
          grantId: dto.grantId,
          actor: actor.email,
          totalSpent: agg.totalSpent,
        },
        'donor report created (draft)',
      );
      return report;
    });
  }

  async findOne(actor: AuthenticatedUser, reportId: string) {
    const report = await this.loadReportOrThrow(reportId);
    // Sprint F5b-a Lot 1 : BAILLEUR pur ne voit que les rapports `sent`.
    // On lève 404 (pas 403) pour ne PAS révéler qu'un brouillon existe.
    if (isBailleurOnly(actor) && report.status !== 'sent') {
      this.logger.warn(
        { reportId, actorEmail: actor.email, reportStatus: report.status },
        'BAILLEUR-only actor blocked from non-sent donor report',
      );
      throw new DonorReportNotFoundException(reportId);
    }
    return report;
  }

  /**
   * Charge un rapport sans filtre RBAC. Utilisé en interne par lock()
   * et send() — les transitions de statut elles-mêmes sont déjà gated
   * par @Roles côté contrôleur.
   */
  private async loadReportOrThrow(reportId: string) {
    const report = await this.prisma.donorReport.findUnique({
      where: { id: reportId },
      include: {
        lines: { orderBy: { categoryCode: 'asc' } },
        template: { select: { code: true, name: true, currency: true, donor: true } },
        grant: { select: { reference: true, currency: true, amount: true } },
      },
    });
    if (!report) throw new DonorReportNotFoundException(reportId);
    return report;
  }

  async findMany(
    actor: AuthenticatedUser,
    query: { grantId?: string; status?: string; templateId?: string },
  ) {
    // Sprint F5b-a Lot 1 : pour un BAILLEUR pur, on force status=sent
    // (même si le query asked draft/locked → on ne lui montre rien d'autre).
    const effectiveStatus = isBailleurOnly(actor) ? 'sent' : query.status;
    return this.prisma.donorReport.findMany({
      where: {
        grantId: query.grantId,
        status: effectiveStatus,
        templateId: query.templateId,
      },
      orderBy: { generatedAt: 'desc' },
      take: 100,
    });
  }

  // ------------------------------------------------------------------
  // Transitions : lock → generate files → send
  // ------------------------------------------------------------------

  /**
   * Verrouille le rapport pour envoi : génère PDF + Excel, stocke dans
   * MinIO, persiste les keys, passe status='locked'. Idempotent : si
   * déjà locked, regénère les fichiers (utile pour corriger l'entête).
   */
  async lock(actor: ReportActor, reportId: string): Promise<DonorReport> {
    const report = await this.loadReportOrThrow(reportId);
    if (report.status === 'sent') throw new DonorReportAlreadySentException(reportId);
    if (report.status !== 'draft' && report.status !== 'locked') {
      throw new DonorReportNotDraftException(reportId, report.status);
    }

    // Re-aggrège pour les preview/inclusions à jour (le rapport reste
    // snapshot dans donor_report_line — l'agg sert juste à fournir les
    // données aux renderers)
    const reportNumber = `DR-${new Date(report.generatedAt).getFullYear()}-${report.id.slice(0, 8).toUpperCase()}`;
    const accountDetail = await this.buildAccountDetail(report.grantId, report.periodStart, report.periodEnd);
    const generatedBy = await this.prisma.appUser.findUnique({
      where: { id: report.generatedBy },
      select: { email: true, fullName: true },
    });

    const renderInput = {
      reportNumber,
      donorName: report.template.donor?.label ?? '(no donor)',
      templateName: report.template.name,
      grantReference: report.grant.reference,
      projectTitle: '', // résolu après
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      currency: report.currency,
      fxRateUsed: Number(report.fxRateUsed ?? 1),
      generatedAt: report.generatedAt,
      generatedBy: generatedBy?.fullName ?? generatedBy?.email ?? '(unknown)',
      notes: report.notes,
      aggregation: {
        lines: report.lines.map((l) => ({
          donorCategoryId: l.donorCategoryId,
          categoryCode: l.categoryCode,
          categoryLabel: l.categoryLabel,
          budgetAmount: Number(l.budgetAmount),
          spentAmount: Number(l.spentAmount),
          variance: Number(l.variance),
          variancePct: Number(l.variancePct),
          alert: Math.abs(Number(l.variancePct)) > 10,
        })),
        totalBudget: Number(report.totalBudget),
        totalSpent: Number(report.totalSpent),
        totalOverhead: Number(report.totalOverhead),
        fundsCarried: Number(report.fundsCarried),
        fxRateUsed: Number(report.fxRateUsed ?? 1),
      },
    };
    // Project title (séparé pour éviter une jointure dans findOne)
    const project = await this.prisma.project.findFirst({
      where: { grants: { some: { id: report.grantId } } },
      select: { title: true, code: true },
    });
    renderInput.projectTitle = project ? `${project.code} — ${project.title}` : '';

    const pdfBuffer = await this.pdf.render(renderInput);
    const excelBuffer = this.excel.render({ ...renderInput, accountDetail });

    const yearMonth = `${report.periodEnd.getUTCFullYear()}/${String(
      report.periodEnd.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
    const pdfKey = `donor-reports/${yearMonth}/${reportNumber}-${randomUUID().slice(0, 8)}.pdf`;
    const excelKey = `donor-reports/${yearMonth}/${reportNumber}-${randomUUID().slice(0, 8)}.xlsx`;

    await this.storage.putObject({
      bucket: REPORTING_BUCKET,
      objectKey: pdfKey,
      buffer: pdfBuffer,
      contentType: 'application/pdf',
      metadata: { 'x-report-id': reportId },
    });
    await this.storage.putObject({
      bucket: REPORTING_BUCKET,
      objectKey: excelKey,
      buffer: excelBuffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      metadata: { 'x-report-id': reportId },
    });

    const updated = await this.prisma.donorReport.update({
      where: { id: reportId },
      data: {
        status: 'locked',
        lockedBy: actor.id,
        lockedAt: new Date(),
        pdfObjectKey: pdfKey,
        excelObjectKey: excelKey,
      },
    });
    this.logger.log(
      { reportId, actor: actor.email, pdfKey, excelKey, reportNumber },
      'donor report locked + files generated',
    );
    return updated;
  }

  /**
   * Marque le rapport `sent` (envoyé au bailleur). Le trigger BD
   * empêchera ensuite toute mutation des colonnes business.
   */
  async send(
    actor: ReportActor,
    reportId: string,
    dto: SendDonorReportDto,
  ): Promise<DonorReport> {
    const report = await this.prisma.donorReport.findUnique({ where: { id: reportId } });
    if (!report) throw new DonorReportNotFoundException(reportId);
    if (report.status === 'sent') throw new DonorReportAlreadySentException(reportId);
    if (report.status !== 'locked') {
      throw new DonorReportNotLockedException(reportId, report.status);
    }
    const noteAddon = dto.externalReference
      ? `[sent ref=${dto.externalReference}] ${dto.notes ?? ''}`.trim()
      : dto.notes;
    const updated = await this.prisma.donorReport.update({
      where: { id: reportId },
      data: {
        status: 'sent',
        sentBy: actor.id,
        sentAt: new Date(),
        notes: noteAddon ?? report.notes,
      },
    });
    this.logger.warn(
      { reportId, actor: actor.email, externalReference: dto.externalReference },
      'donor report SENT (immutable from now on)',
    );
    return updated;
  }

  // ------------------------------------------------------------------
  // Downloads
  // ------------------------------------------------------------------

  async downloadPdf(reportId: string): Promise<{ buffer: Buffer; filename: string }> {
    const report = await this.prisma.donorReport.findUnique({
      where: { id: reportId },
      select: { id: true, pdfObjectKey: true, periodEnd: true },
    });
    if (!report) throw new DonorReportNotFoundException(reportId);
    if (!report.pdfObjectKey) {
      throw new DonorReportFileNotGeneratedException(reportId, 'pdf');
    }
    const obj = await this.storage.getObject(REPORTING_BUCKET, report.pdfObjectKey);
    const filename = `donor-report-${reportId.slice(0, 8)}.pdf`;
    return { buffer: obj.buffer, filename };
  }

  async downloadExcel(reportId: string): Promise<{ buffer: Buffer; filename: string }> {
    const report = await this.prisma.donorReport.findUnique({
      where: { id: reportId },
      select: { id: true, excelObjectKey: true },
    });
    if (!report) throw new DonorReportNotFoundException(reportId);
    if (!report.excelObjectKey) {
      throw new DonorReportFileNotGeneratedException(reportId, 'excel');
    }
    const obj = await this.storage.getObject(REPORTING_BUCKET, report.excelObjectKey);
    const filename = `donor-report-${reportId.slice(0, 8)}.xlsx`;
    return { buffer: obj.buffer, filename };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async buildAccountDetail(
    grantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<
    Array<{
      accountCode: string;
      accountLabel: string;
      totalDebit: number;
      totalCredit: number;
      netAmount: number;
    }>
  > {
    const rows = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        grantId,
        entry: {
          status: 'posted',
          entryDate: { gte: periodStart, lte: periodEnd },
        },
      },
      _sum: { debit: true, credit: true },
    });
    if (rows.length === 0) return [];
    const accounts = await this.prisma.glAccount.findMany({
      where: { code: { in: rows.map((r) => r.accountCode) } },
      select: { code: true, label: true },
    });
    const labelByCode = new Map(accounts.map((a) => [a.code, a.label]));
    return rows.map((r) => {
      const totalDebit = Number(r._sum.debit ?? 0);
      const totalCredit = Number(r._sum.credit ?? 0);
      return {
        accountCode: r.accountCode,
        accountLabel: labelByCode.get(r.accountCode) ?? '(unknown)',
        totalDebit,
        totalCredit,
        netAmount: totalDebit - totalCredit,
      };
    });
  }
}
