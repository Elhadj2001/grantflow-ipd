import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { GoodsReceiptService } from './services/goods-receipt.service';
import {
  CancelGrDto,
  CreateGrFromPoDto,
  RejectGrDto,
  UpdateGrDto,
  UpdateGrLinesDto,
} from './dto/create-gr.dto';
import { GrQueryDto } from './dto/gr-query.dto';

@ApiBearerAuth()
@ApiTags('procurement')
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller()
export class GoodsReceiptController {
  constructor(private readonly svc: GoodsReceiptService) {}

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
  @ApiOperation({
    summary: 'Liste paginée des GR',
    description:
      'MAGASINIER / ACHETEUR / CONTROLEUR / DAF / COMPTABLE / TRESORIER / BAILLEUR / SUPER_ADMIN voient ' +
      'tout. DEMANDEUR / PI : seulement les GR liés à leurs DAs.',
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
