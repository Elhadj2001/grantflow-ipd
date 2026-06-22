import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { ApprovalWorkflowService } from './services/approval-workflow.service';
import { CreatePurchaseRequestDto } from './dto/create-pr.dto';
import { UpdatePurchaseRequestDto } from './dto/update-pr.dto';
import { PurchaseRequestQueryDto } from './dto/pr-query.dto';
import { PendingApprovalQueryDto } from './dto/pending-approval-query.dto';
import { CheckBudgetResponseDto } from './dto/check-budget.dto';
import {
  ApprovalDecisionResponseDto,
  ApprovalStepResponseDto,
  ApproveDecisionDto,
  RejectDecisionDto,
  ReturnForChangesDto,
} from './dto/approval-decision.dto';
import {
  SettleCashAdvanceDto,
  SettleCashAdvanceResponseDto,
} from './dto/cash-settle.dto';
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
  constructor(
    private readonly svc: PurchaseRequestService,
    private readonly workflow: ApprovalWorkflowService,
  ) {}

  // ------------------------------------------------------------------
  // Workflow — pending approvals (route AVANT /:id pour ne pas être capturée)
  // ------------------------------------------------------------------

  @Get('pending-my-approval')
  @Roles('PI', 'CONTROLEUR', 'DAF', 'CAISSIER', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Liste des DA en attente de MA décision (filtrée par rôle de l\'acteur)',
    description:
      "PI : DA pending_pi des projets dont je suis le PI. " +
      "CG : toutes pending_cg. DAF : toutes pending_daf. SUPER_ADMIN : toutes en cours.",
  })
  @ApiOkResponse()
  pendingMyApproval(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PendingApprovalQueryDto,
  ) {
    return this.workflow.getMyPendingApprovals(user, query);
  }

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
    summary:
      'Soumettre la DA (contrôle budgétaire + éligibilité bloquants, création approval_step)',
    description:
      "US-049 : la réponse est l'enveloppe { pr, warnings } — `warnings` porte les " +
      "verdicts d'éligibilité non bloquants (ADR-007) à surfacer côté UI.",
  })
  @ApiOkResponse({ type: PurchaseRequestResponseDto })
  @ApiNotFoundResponse({ description: 'PR not found' })
  @ApiConflictResponse({
    description:
      'PR_NOT_EDITABLE (≠draft) / GRANT_NOT_ACTIVE / INSUFFICIENT_BUDGET avec détail des lignes',
  })
  @ApiBadRequestResponse({
    description: 'ELIGIBILITY_VALIDATION_FAILED — la DA viole ≥ 1 règle bloquante (ADR-007)',
  })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.submit(user, id);
  }

  // ------------------------------------------------------------------
  // Workflow — decisions
  // ------------------------------------------------------------------

  @Post(':id/approve')
  @Roles('PI', 'CONTROLEUR', 'DAF', 'CAISSIER', 'SUPER_ADMIN')
  @ApiOperation({
    summary: "Approuver l'étape pending de la DA — fait avancer vers la suivante",
    description:
      "Routage par seuil : <500 000 XOF → APPROVED après PI ; <5 000 000 → CG ; ≥ 5 000 000 → DAF.",
  })
  @ApiOkResponse({ type: ApprovalDecisionResponseDto })
  @ApiNotFoundResponse({ description: 'PR not found' })
  @ApiConflictResponse({
    description:
      'PR_NOT_IN_APPROVAL / PR_ALREADY_DECIDED / PR_NOT_AWAITING_YOU / PI_NOT_OWNER_OF_PROJECT / 501 CASH_WORKFLOW_NOT_YET_IMPLEMENTED',
  })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveDecisionDto,
    @Headers('x-bypass-sod-reason') bypassReason?: string,
  ): Promise<ApprovalDecisionResponseDto> {
    const res = await this.workflow.approveCurrentStep(user, id, dto.comment, bypassReason);
    return {
      prId: res.pr.id,
      status: res.pr.status,
      nextStepRole: res.nextStepRole,
      splittingWarning: res.splittingWarning,
    };
  }

  @Post(':id/reject')
  @Roles('PI', 'CONTROLEUR', 'DAF', 'CAISSIER', 'SUPER_ADMIN')
  @ApiOperation({ summary: "Refuser l'étape pending (motif obligatoire, min 5 chars)" })
  @ApiOkResponse({ type: PurchaseRequestResponseDto })
  @ApiNotFoundResponse({ description: 'PR not found' })
  @ApiConflictResponse({ description: 'PR_NOT_IN_APPROVAL / PR_NOT_AWAITING_YOU' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectDecisionDto,
  ) {
    return this.workflow.rejectCurrentStep(user, id, dto.reason);
  }

  @Post(':id/return-for-changes')
  @Roles('PI', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Renvoyer la DA en draft (le demandeur peut éditer, soumission repart à PI)',
  })
  @ApiOkResponse({ type: PurchaseRequestResponseDto })
  @ApiNotFoundResponse({ description: 'PR not found' })
  @ApiConflictResponse({ description: 'PR_NOT_IN_APPROVAL / PR_NOT_AWAITING_YOU' })
  returnForChanges(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReturnForChangesDto,
  ) {
    return this.workflow.returnForChanges(user, id, dto.comment);
  }

  @Get(':id/approval-history')
  @Roles('DEMANDEUR', 'PI', 'ACHETEUR', 'CONTROLEUR', 'DAF', 'COMPTABLE', 'TRESORIER', 'SUPER_ADMIN')
  @ApiOperation({ summary: "Historique d'approbation (étapes ordonnées)" })
  @ApiOkResponse({ type: [ApprovalStepResponseDto] })
  async approvalHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApprovalStepResponseDto[]> {
    // On passe d'abord par findOne pour valider l'ownership/visibilité.
    await this.svc.findOne(user, id);
    const steps = await this.workflow.getApprovalHistory(id);
    return steps.map((s) => ({
      id: s.id,
      stepOrder: s.stepOrder,
      approverRole: s.approverRole,
      approverId: s.approverId,
      status: s.status,
      decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null,
      decisionNotes: s.decisionNotes,
    }));
  }

  // ------------------------------------------------------------------
  // Cash settlement (cash_advance régularisation)
  // ------------------------------------------------------------------

  @Post(':id/settle')
  @Roles('CAISSIER', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Régulariser une avance de mission (cash_advance APPROVED)',
    description:
      "Calcule la variance entre actualSpent et l'engagement initial. " +
      'Si variance < 0 : reliquat retourné en caisse. ' +
      'Si variance > 0 : delta à rembourser au demandeur (hors flux caisse). ' +
      'La DA passe en statut `settled` (terminal).',
  })
  @ApiOkResponse({ type: SettleCashAdvanceResponseDto })
  @ApiNotFoundResponse({ description: 'PR not found' })
  @ApiConflictResponse({
    description:
      'PR_TYPE_MISMATCH (≠cash_advance) / PR_NOT_APPROVED_FOR_SETTLE / PR_ALREADY_SETTLED',
  })
  async settle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SettleCashAdvanceDto,
  ): Promise<SettleCashAdvanceResponseDto> {
    const { pr, settlement } = await this.workflow.settleCashAdvance(user, id, {
      actualSpent: dto.actualSpent,
      justifications: dto.justifications,
    });
    return {
      prId: pr.id,
      status: pr.status,
      settlement: {
        id: settlement.id,
        purchaseRequestId: settlement.purchaseRequestId,
        actualSpent: Number(settlement.actualSpent),
        variance: Number(settlement.variance),
        justifications: settlement.justifications,
        settledBy: settlement.settledBy,
        settledAt: settlement.settledAt.toISOString(),
      },
    };
  }
}
