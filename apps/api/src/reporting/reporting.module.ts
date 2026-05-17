import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ReportingController } from './reporting.controller';
import { DonorTemplateService } from './services/donor-template.service';
import { DonorReportService } from './services/donor-report.service';
import { ReportAggregationService } from './services/report-aggregation.service';
import { PdfRenderService } from './services/pdf-render.service';
import { ExcelRenderService } from './services/excel-render.service';
import { StorageService } from '../common/services/storage.service';

/**
 * Module Reporting (sprint 6.1) — rapports financiers bailleur.
 *
 *  - DonorTemplateService : CRUD templates + mappings comptes → catégories
 *  - DonorReportService   : génération, lock, send, downloads PDF/Excel
 *  - ReportAggregationService : SUM journal_lines + overhead + FX conversion
 *  - PdfRenderService     : pdfkit (entête IPD, tableau catégories, signature DAF)
 *  - ExcelRenderService   : xlsx 3 onglets (Summary, Categories, Accounts)
 *
 *  Stockage MinIO bucket `grantflow-reports`. Trigger BD interdit
 *  toute modification d'un rapport status='sent'.
 */
@Module({
  imports: [ConfigModule],
  controllers: [ReportingController],
  providers: [
    DonorTemplateService,
    DonorReportService,
    ReportAggregationService,
    PdfRenderService,
    ExcelRenderService,
    StorageService,
  ],
  exports: [DonorTemplateService, DonorReportService, ReportAggregationService],
})
export class ReportingModule {}
