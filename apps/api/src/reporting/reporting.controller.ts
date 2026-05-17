import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { DonorReportService } from './services/donor-report.service';
import { DonorTemplateService } from './services/donor-template.service';
import { FinancialStatementService } from './services/financial-statement.service';
import {
  AddMappingsDto,
  CreateDonorTemplateDto,
} from './dto/donor-template.dto';
import {
  CreateDonorReportDto,
  SendDonorReportDto,
} from './dto/donor-report.dto';
import { CreateFinancialStatementDto } from './dto/financial-statement.dto';
import type { StatementType } from './services/financial-statement-generator.service';

@ApiTags('reporting')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('reporting')
export class ReportingController {
  constructor(
    private readonly templates: DonorTemplateService,
    private readonly reports: DonorReportService,
    private readonly statements: FinancialStatementService,
    private readonly prisma: PrismaService,
  ) {}

  // ------------------------------------------------------------------
  // Templates
  // ------------------------------------------------------------------

  @Get('templates')
  @ApiOperation({ summary: 'Liste des templates de rapport bailleur' })
  listTemplates() {
    return this.templates.findMany();
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'Détail d\'un template + catégories + mappings' })
  @ApiNotFoundResponse({ description: 'DONOR_TEMPLATE_NOT_FOUND' })
  findTemplate(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.templates.findOne(id);
  }

  @Post('templates')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Créer un template de rapport bailleur (+ catégories en option)',
  })
  @ApiConflictResponse({ description: 'BUSINESS.DUPLICATE_CODE' })
  createTemplate(@Body() dto: CreateDonorTemplateDto) {
    return this.templates.create(dto);
  }

  @Post('templates/:id/mappings')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Ajouter / mettre à jour des mappings (compte SYSCEBNL → catégorie)',
  })
  @ApiNotFoundResponse({ description: 'DONOR_TEMPLATE_NOT_FOUND / BUSINESS.NOT_FOUND' })
  addMappings(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddMappingsDto,
  ) {
    return this.templates.addMappings(id, dto);
  }

  // ------------------------------------------------------------------
  // Donor reports
  // ------------------------------------------------------------------

  @Get('donor-reports')
  @ApiOperation({ summary: 'Liste paginée des rapports bailleur' })
  listReports(
    @Query('grantId') grantId?: string,
    @Query('status') status?: string,
    @Query('templateId') templateId?: string,
  ) {
    return this.reports.findMany({ grantId, status, templateId });
  }

  @Get('donor-reports/:id')
  @ApiOperation({ summary: 'Détail rapport bailleur + lignes par catégorie' })
  @ApiNotFoundResponse({ description: 'DONOR_REPORT_NOT_FOUND' })
  findReport(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.reports.findOne(id);
  }

  @Post('donor-reports')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Générer un rapport bailleur (status=draft) pour grant × période',
    description:
      'Agrège journal_lines + overhead via ReportAggregationService. Conversion en devise du template au taux fin de période.',
  })
  @ApiConflictResponse({
    description:
      'DONOR_TEMPLATE_NOT_FOUND / REPORTING_PERIOD_INVALID / REPORTING_FX_RATE_MISSING / DONOR_TEMPLATE_HAS_NO_MAPPINGS',
  })
  async createReport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDonorReportDto,
  ) {
    const actor = await this.resolveActor(user);
    return this.reports.create(actor, dto);
  }

  @Post('donor-reports/:id/lock')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Verrouiller un rapport draft → locked (génère PDF + Excel)',
  })
  @ApiConflictResponse({ description: 'DONOR_REPORT_NOT_DRAFT / DONOR_REPORT_ALREADY_SENT' })
  async lockReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const actor = await this.resolveActor(user);
    return this.reports.lock(actor, id);
  }

  @Post('donor-reports/:id/send')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Marquer un rapport `sent` (immutable après — trigger DB) — DAF',
  })
  @ApiConflictResponse({ description: 'DONOR_REPORT_NOT_LOCKED / DONOR_REPORT_ALREADY_SENT' })
  async sendReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SendDonorReportDto,
  ) {
    const actor = await this.resolveActor(user);
    return this.reports.send(actor, id, dto);
  }

  @Get('donor-reports/:id/pdf')
  @ApiProduces('application/pdf')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Télécharger le PDF du rapport (généré au lock)' })
  @ApiNotFoundResponse({ description: 'DONOR_REPORT_FILE_NOT_GENERATED' })
  async downloadPdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.reports.downloadPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.end(buffer);
  }

  @Get('donor-reports/:id/excel')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({ summary: 'Télécharger le Excel du rapport (3 onglets)' })
  @ApiNotFoundResponse({ description: 'DONOR_REPORT_FILE_NOT_GENERATED' })
  async downloadExcel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.reports.downloadExcel(id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.end(buffer);
  }

  // ------------------------------------------------------------------
  // Financial statements (sprint 6.2) — TER / BILAN / RESULTAT
  // ------------------------------------------------------------------

  @Get('statements')
  @ApiOperation({ summary: 'Liste des états financiers (filtre periodId / type)' })
  listStatements(
    @Query('periodId') periodId?: string,
    @Query('type') type?: StatementType,
  ) {
    return this.statements.list(periodId, type);
  }

  @Get('statements/:id')
  @ApiOperation({ summary: 'Détail d\'un état financier (lignes par section)' })
  @ApiNotFoundResponse({ description: 'BUSINESS.FINANCIAL_STATEMENT_NOT_FOUND' })
  findStatement(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.statements.findOne(id);
  }

  @Post('statements')
  @Roles('COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Génère un état financier (TER, BILAN ou RESULTAT) sur une période',
    description:
      'Idempotent : régénère si pas locked. Lève FINANCIAL_STATEMENT_LOCKED si déjà verrouillé.',
  })
  @ApiConflictResponse({
    description: 'BUSINESS.FINANCIAL_STATEMENT_LOCKED / FINANCIAL_STATEMENT_NOT_BALANCED',
  })
  async createStatement(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFinancialStatementDto,
  ) {
    const actor = await this.resolveActor(user);
    return this.statements.generate(actor, dto.periodId, dto.type);
  }

  @Post('statements/:id/lock')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Verrouille un état financier — DAF only (immuable après lock + close)',
  })
  async lockStatement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const actor = await this.resolveActor(user);
    return this.statements.lock(actor, id);
  }

  @Get('statements/:id/pdf')
  @ApiProduces('application/pdf')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Télécharger le PDF d\'un état financier' })
  async downloadStatementPdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.statements.downloadPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.end(buffer);
  }

  @Get('statements/:id/excel')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({ summary: 'Télécharger le Excel d\'un état financier (2 onglets)' })
  async downloadStatementExcel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.statements.downloadExcel(id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.end(buffer);
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async resolveActor(user: AuthenticatedUser) {
    const existing = await this.prisma.appUser.findUnique({
      where: { email: user.email },
      select: { id: true, fullName: true },
    });
    if (existing) {
      return { id: existing.id, email: user.email, fullName: existing.fullName ?? user.fullName };
    }
    const created = await this.prisma.appUser.create({
      data: { email: user.email, fullName: user.fullName || user.email },
      select: { id: true, fullName: true },
    });
    return { id: created.id, email: user.email, fullName: created.fullName ?? user.fullName };
  }
}
