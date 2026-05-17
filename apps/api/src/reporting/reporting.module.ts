import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ReportingController } from './reporting.controller';
import { DonorTemplateService } from './services/donor-template.service';
import { DonorReportService } from './services/donor-report.service';
import { ReportAggregationService } from './services/report-aggregation.service';
import { PdfRenderService } from './services/pdf-render.service';
import { ExcelRenderService } from './services/excel-render.service';
import { FinancialStatementService } from './services/financial-statement.service';
import { FinancialStatementGeneratorService } from './services/financial-statement-generator.service';
import { StatementRenderService } from './services/statement-render.service';
import { StorageService } from '../common/services/storage.service';

/**
 * Module Reporting :
 *  - sprint 6.1 : rapports financiers bailleur (donor templates + reports)
 *  - sprint 6.2 : états financiers SYSCEBNL (TER, BILAN, RESULTAT)
 *
 * Services :
 *  - DonorTemplateService               : CRUD templates + mappings comptes → catégories
 *  - DonorReportService                 : génération/lock/send/downloads rapport bailleur
 *  - ReportAggregationService           : SUM journal_lines + overhead + FX conversion
 *  - PdfRenderService / ExcelRenderService : rendu rapports bailleur
 *  - FinancialStatementGeneratorService : agrège balances → TER/BILAN/RESULTAT
 *  - FinancialStatementService          : persiste + lock + downloads états
 *  - StatementRenderService             : PDF (A4 paysage 2 colonnes) + Excel 2 onglets
 *
 * Stockage MinIO bucket `grantflow-reports`. Trigger DB interdit la
 * suppression d'un statement locked d'une période close.
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
    FinancialStatementService,
    FinancialStatementGeneratorService,
    StatementRenderService,
    StorageService,
  ],
  exports: [
    DonorTemplateService,
    DonorReportService,
    ReportAggregationService,
    FinancialStatementService,
    FinancialStatementGeneratorService,
  ],
})
export class ReportingModule {}
