import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { PurchaseRequestService } from './purchase-request.service';
import { CreatePurchaseRequestDto } from './dto/create-pr.dto';
import { UpdatePurchaseRequestDto } from './dto/update-pr.dto';
import { PurchaseRequestQueryDto } from './dto/pr-query.dto';
import { CheckBudgetResponseDto } from './dto/check-budget.dto';
import {
  PurchaseRequestDetailResponseDto,
  PurchaseRequestListResponseDto,
  PurchaseRequestResponseDto,
} from './dto/pr-response.dto';

@ApiBearerAuth()
@ApiTags('procurement')
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('purchase-requests')
export class PurchaseRequestController {
  constructor(private readonly svc: PurchaseRequestService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  @Get()
  @Roles('DEMANDEUR', 'PI', 'ACHETEUR', 'CONTROLEUR', 'DAF', 'COMPTABLE', 'TRESORIER', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Liste paginée des DA — limitée aux DA du DEMANDEUR connecté',
    description:
      "Les rôles CONTROLEUR/DAF/COMPTABLE/TRESORIER/SUPER_ADMIN voient toutes les DA. " +
      'Les autres rôles ne voient que leurs propres DA (requestedBy = caller).',
  })
  @ApiOkResponse({ type: PurchaseRequestListResponseDto })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PurchaseRequestQueryDto) {
    return this.svc.findMany(user, query);
  }

  @Get(':id')
  @Roles('DEMANDEUR', 'PI', 'ACHETEUR', 'CONTROLEUR', 'DAF', 'COMPTABLE', 'TRESORIER', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Détail DA (lignes + imputation) — 404 si pas owner et DEMANDEUR' })
  @ApiOkResponse({ type: PurchaseRequestDetailResponseDto })
  @ApiNotFoundResponse({ description: 'PR not found (BUSINESS.NOT_FOUND / BUSINESS.PR_NOT_OWNED)' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(user, id);
  }

  @Get(':id/check-budget')
  @Roles('DEMANDEUR', 'PI', 'ACHETEUR', 'CONTROLEUR', 'DAF', 'COMPTABLE', 'TRESORIER', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Pré-vérification budgétaire (lecture seule) — à appeler AVANT submit',
    description:
      "Retourne {available, currentTotal, willConsume, wouldExceed} et un détail par budgetLine. " +
      "Cette ressource ne MODIFIE PAS la DA — c'est un voyant pour le front, " +
      "la décision finale est faite à l'appel de POST /:id/submit.",
  })
  @ApiOkResponse({ type: CheckBudgetResponseDto })
  @ApiNotFoundResponse({ description: 'PR not found (BUSINESS.NOT_FOUND)' })
  checkBudget(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.checkBudget(user, id);
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  @Post()
  @Roles('DEMANDEUR', 'PI', 'SUPER_ADMIN')
  @ApiOperation({ summary: "Créer une demande d'achat (statut DRAFT)" })
  @ApiOkResponse({ type: PurchaseRequestDetailResponseDto, description: '201 Created' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePurchaseRequestDto,
  ) {
    return this.svc.create(user, dto);
  }

  @Patch(':id')
  @Roles('DEMANDEUR', 'PI', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Modifier une DA (statut draft uniquement, owner ou SUPER_ADMIN)',
  })
  @ApiOkResponse({ type: PurchaseRequestDetailResponseDto })
  @ApiNotFoundResponse({ description: 'PR not found' })
  @ApiConflictResponse({ description: 'PR_NOT_EDITABLE if status ≠ draft' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePurchaseRequestDto,
  ) {
    return this.svc.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('DEMANDEUR', 'PI', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Annuler une DA en brouillon (status → cancelled)' })
  @ApiNotFoundResponse({ description: 'PR not found' })
  @ApiConflictResponse({ description: 'PR_NOT_DELETABLE if status ≠ draft' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.svc.cancel(user, id);
  }

  @Post(':id/submit')
  @Roles('DEMANDEUR', 'PI', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Soumettre la DA (contrôle budgétaire bloquant + création approval_step)',
  })
  @ApiOkResponse({ type: PurchaseRequestResponseDto })
  @ApiNotFoundResponse({ description: 'PR not found' })
  @ApiConflictResponse({
    description:
      'PR_NOT_EDITABLE (≠draft) / GRANT_NOT_ACTIVE / INSUFFICIENT_BUDGET avec détail des lignes',
  })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.submit(user, id);
  }
}
