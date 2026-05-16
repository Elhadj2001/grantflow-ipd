import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PostingService } from '../accounting/services/posting.service';
import {
  AcknowledgePoDto,
  CancelPoDto,
  CreatePoFromMultiplePrsDto,
  CreatePoFromPrDto,
  UpdatePoDto,
} from './dto/create-po.dto';
import { PoQueryDto } from './dto/po-query.dto';
import {
  PurchaseOrderDetailResponseDto,
  PurchaseOrderListResponseDto,
  PurchaseOrderResponseDto,
  SendPoResponseDto,
} from './dto/po-response.dto';

@ApiBearerAuth()
@ApiTags('procurement')
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(
    private readonly svc: PurchaseOrderService,
    private readonly posting: PostingService,
  ) {}

  // ------------------------------------------------------------------
  // Create
  // ------------------------------------------------------------------

  @Post('from-pr/:prId')
  @Roles('ACHETEUR', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer un BC depuis UNE DA approuvée' })
  @ApiOkResponse({ type: PurchaseOrderDetailResponseDto, description: '201 Created' })
  @ApiNotFoundResponse({ description: 'PR or Supplier not found' })
  @ApiConflictResponse({
    description:
      'PR_NOT_APPROVED / PR_ALREADY_HAS_PO / PR_TYPE_PETTY_CASH_NO_PO / SUPPLIER_INACTIVE',
  })
  createFromPr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('prId', new ParseUUIDPipe()) prId: string,
    @Body() dto: CreatePoFromPrDto,
  ) {
    return this.svc.createFromPr(user, prId, dto);
  }

  @Post('from-prs')
  @Roles('ACHETEUR', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Consolider plusieurs DAs approuvées dans un seul BC',
    description:
      'Lignes consolidées par (description, budgetLineId, unitPrice). Toutes les DAs doivent être ' +
      'en status approved, de type standard, dans la même devise.',
  })
  @ApiOkResponse({ type: PurchaseOrderDetailResponseDto, description: '201 Created' })
  @ApiConflictResponse({
    description: 'PR_NOT_APPROVED / PR_ALREADY_HAS_PO / PO_CURRENCY_MISMATCH / SUPPLIER_INACTIVE',
  })
  createFromMultiplePrs(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePoFromMultiplePrsDto,
  ) {
    return this.svc.createFromMultiplePrs(user, dto);
  }

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary: 'Liste paginée des BCs',
    description:
      "Les rôles ACHETEUR/CONTROLEUR/DAF/COMPTABLE/TRESORIER/BAILLEUR/SUPER_ADMIN voient tous les BCs. " +
      'Les autres ne voient que les BCs liés à leurs DAs.',
  })
  @ApiOkResponse({ type: PurchaseOrderListResponseDto })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PoQueryDto) {
    return this.svc.findMany(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail BC (lignes + DA(s) liées)' })
  @ApiOkResponse({ type: PurchaseOrderDetailResponseDto })
  @ApiNotFoundResponse({ description: 'PO not found (404 obscurity si non accessible)' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(user, id);
  }

  @Get(':id/pdf')
  @ApiProduces('application/pdf')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Télécharger le PDF du BC (depuis MinIO)' })
  @ApiNotFoundResponse({ description: 'PO_NO_PDF si le BC n\'a pas encore été envoyé' })
  async downloadPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, contentType, filename } = await this.svc.downloadPdf(user, id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.end(buffer);
  }

  @Get(':id/journal-entries')
  @ApiOperation({ summary: 'Écritures comptables liées au BC (engagement classe 8 + extournes)' })
  async journalEntries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    // findOne valide l'accès en lecture (404 obscurity).
    await this.svc.findOne(user, id);
    return this.posting.listEntriesForPo(id);
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  @Patch(':id')
  @Roles('ACHETEUR', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Modifier un BC en draft (incoterm, expectedDate, deliveryAddress)' })
  @ApiOkResponse({ type: PurchaseOrderDetailResponseDto })
  @ApiConflictResponse({ description: 'PO_NOT_EDITABLE si status ≠ draft' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePoDto,
  ) {
    return this.svc.update(user, id, dto);
  }

  @Post(':id/send')
  @Roles('ACHETEUR', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Émettre le BC : PDF + MinIO + écriture classe 8 + email',
    description:
      "Le PDF et l'écriture comptable sont CRÉÉS de manière fiable. L'email peut échouer " +
      "sans bloquer (retry via POST /:id/resend).",
  })
  @ApiOkResponse({ type: SendPoResponseDto })
  @ApiConflictResponse({ description: 'PO_NOT_SENDABLE / SUPPLIER_INACTIVE' })
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SendPoResponseDto> {
    const res = await this.svc.send(user, id);
    return {
      poId: res.po.id,
      status: res.po.status,
      pdfObjectKey: res.pdfObjectKey,
      emailDelivered: res.emailDelivered,
      emailMessageId: res.emailMessageId,
      emailError: res.emailError,
      commitmentEntryId: res.commitmentEntryId,
      commitmentEntryNumber: res.commitmentEntryNumber,
    };
  }

  @Post(':id/resend')
  @Roles('ACHETEUR', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Re-envoyer l\'email avec le PDF stocké (pas de nouvelle écriture)' })
  resend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.resend(user, id);
  }

  @Post(':id/acknowledge')
  @Roles('ACHETEUR', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Enregistrer l\'accusé de réception fournisseur (status sent → acknowledged)' })
  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  @ApiConflictResponse({ description: 'PO_NOT_ACKNOWLEDGEABLE si status ≠ sent' })
  acknowledge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AcknowledgePoDto,
  ) {
    return this.svc.acknowledge(user, id, dto);
  }

  @Post(':id/cancel')
  @Roles('ACHETEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Annuler un BC (extournement classe 8 si déjà engagé)',
    description: 'reason obligatoire (≥ 5 chars). Si le BC était déjà sent/acknowledged, une écriture inverse est créée.',
  })
  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  @ApiConflictResponse({ description: 'PO_NOT_CANCELLABLE si déjà reçu/facturé/clos' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelPoDto,
  ) {
    return this.svc.cancel(user, id, dto);
  }
}
