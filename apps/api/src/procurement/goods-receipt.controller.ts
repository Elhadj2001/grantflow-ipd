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
import type { Response } from 'express';
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { GoodsReceiptService } from './services/goods-receipt.service';
import { GrLabelsService } from './services/gr-labels.service';
import {
  CancelGrDto,
  CreateGrFromPoDto,
  RejectGrDto,
  UpdateGrDto,
  UpdateGrLinesDto,
} from './dto/create-gr.dto';
import { GrLabelsQueryDto } from './dto/gr-labels.dto';
import { GrQueryDto } from './dto/gr-query.dto';

@ApiBearerAuth()
@ApiTags('procurement')
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller()
export class GoodsReceiptController {
  constructor(
    private readonly svc: GoodsReceiptService,
    private readonly labelsSvc: GrLabelsService,
  ) {}

  // ------------------------------------------------------------------
  // Create
  // ------------------------------------------------------------------

  @Post('goods-receipts/from-po/:poId')
  @Roles('MAGASINIER', 'ACHETEUR', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Créer un GR draft depuis un PO réceptionnable',
    description:
      'Le PO doit être en sent / acknowledged / partially_received. Les lignes sont recopiées ' +
      'avec quantity=0 ; le magasinier saisit ensuite les quantités réellement reçues.',
  })
  @ApiNotFoundResponse({ description: 'PurchaseOrder not found' })
  @ApiConflictResponse({ description: 'PO_NOT_RECEIVABLE' })
  createFromPo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('poId', new ParseUUIDPipe()) poId: string,
    @Body() dto: CreateGrFromPoDto,
  ) {
    return this.svc.createFromPo(user, poId, dto);
  }

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  @Get('goods-receipts')
  // Sprint F-RBAC-LISTES : la liste des réceptions est gated aux rôles
  // qui en ont l'usage métier. BAILLEUR / DEMANDEUR / PI / CAISSIER en
  // sont exclus côté endpoint. Le service filtre ensuite via
  // FULL_VIEW_ROLES (BAILLEUR retiré en parallèle).
  @Roles(
    'MAGASINIER',
    'ACHETEUR',
    'COMPTABLE',
    'CONTROLEUR',
    'DAF',
    'SUPER_ADMIN',
  )
  @ApiOperation({
    summary: 'Liste paginée des GR',
    description:
      'MAGASINIER / ACHETEUR / CONTROLEUR / DAF / COMPTABLE / SUPER_ADMIN voient tout. ' +
      'Les rôles externes (BAILLEUR) et non-opérationnels sont exclus.',
  })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: GrQueryDto) {
    return this.svc.findMany(user, query);
  }

  @Get('goods-receipts/:id')
  @ApiOperation({ summary: 'Détail GR (en-tête + lignes)' })
  @ApiNotFoundResponse({ description: 'GR not found (404 obscurity si non accessible)' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(user, id);
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  @Patch('goods-receipts/:id')
  @Roles('MAGASINIER', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Modifier en-tête (draft only) — date, bon de livraison, notes' })
  @ApiConflictResponse({ description: 'GR_NOT_EDITABLE si status ≠ draft' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateGrDto,
  ) {
    return this.svc.update(user, id, dto);
  }

  @Post('goods-receipts/:id/lines')
  @Roles('MAGASINIER', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Patch lignes (qté reçue, lot, péremption, n° série, chaîne froid)',
    description:
      'Le cumul reçu (incluant les GR completes précédents sur le même PO) ne peut pas dépasser ' +
      'la quantité commandée. Levée GR_QTY_EXCEEDS_ORDER avec details.lines.',
  })
  @ApiConflictResponse({ description: 'GR_NOT_EDITABLE / GR_QTY_EXCEEDS_ORDER' })
  @ApiNotFoundResponse({ description: 'GR_LINE_NOT_FOUND si un lineId ne matche pas' })
  updateLines(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateGrLinesDto,
  ) {
    return this.svc.updateLines(user, id, dto);
  }

  @Post('goods-receipts/:id/complete')
  @Roles('MAGASINIER', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Valider le GR : propage les quantités sur le PO + recalcule son statut',
    description:
      'Recalcule po.status : received si toutes les lignes sont reçues, sinon partially_received. ' +
      'Si cold_chain_required : exige batch+expiry et bloque si cold_chain_ok=false.',
  })
  @ApiConflictResponse({
    description: 'GR_EMPTY_LINES / GR_ALREADY_COMPLETE / COLD_CHAIN_BROKEN / BATCH_INFO_REQUIRED',
  })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.complete(user, id);
  }

  @Post('goods-receipts/:id/cancel')
  @Roles('MAGASINIER', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Annuler un GR draft (reason ≥ 5 chars)' })
  @ApiConflictResponse({ description: 'GR_NOT_CANCELLABLE si status ≠ draft' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelGrDto,
  ) {
    return this.svc.cancel(user, id, dto);
  }

  @Post('goods-receipts/:id/reject')
  @Roles('MAGASINIER', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Refuser une livraison (mauvais produit, qualité KO)',
    description: 'Le PO reste en sent/acknowledged ; un nouveau GR peut être créé.',
  })
  @ApiConflictResponse({ description: 'GR_NOT_REJECTABLE si status ≠ draft' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectGrDto,
  ) {
    return this.svc.reject(user, id, dto);
  }

  // ------------------------------------------------------------------
  // PO-scoped views
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // Labels QR (sprint F-MAG)
  // ------------------------------------------------------------------

  @Get('goods-receipts/:id/labels.pdf')
  @Roles('MAGASINIER', 'ACHETEUR', 'SUPER_ADMIN')
  @ApiProduces('application/pdf')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({
    summary: 'Générer des étiquettes QR (PDF) pour les lignes du GR',
    description:
      'Format `grid-4x4` (16 étiquettes / page A4) ou `individual` (1 / page). ' +
      'Paramètre `count` = nombre de cartons par ligne (1-64). Chaque QR encode ' +
      '`GRF://<grId>/<lineId>/<carton>` réutilisable plus tard par /inventaire-scan.',
  })
  @ApiNotFoundResponse({ description: 'GR not found' })
  async labelsPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: GrLabelsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.svc.buildLabelsPdf(user, id, query.format, query.count, this.labelsSvc);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="labels-${id.slice(0, 8)}.pdf"`,
    );
    res.setHeader('Content-Length', buffer.length.toString());
    res.end(buffer);
  }

  @Get('purchase-orders/:poId/receipts')
  @ApiOperation({ summary: 'Historique des GR pour un PO' })
  @ApiOkResponse({ description: 'Liste chronologique (createdAt desc)' })
  listForPo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('poId', new ParseUUIDPipe()) poId: string,
  ) {
    return this.svc.listForPo(user, poId);
  }

  @Get('purchase-orders/:poId/remaining')
  @ApiOperation({
    summary: 'Quantités restantes à recevoir, ligne par ligne',
    description: 'ordered, received, remaining par po_line. Source : purchase_order_line.quantity_received.',
  })
  remaining(
    @CurrentUser() user: AuthenticatedUser,
    @Param('poId', new ParseUUIDPipe()) poId: string,
  ) {
    return this.svc.remainingForPo(user, poId);
  }
}
