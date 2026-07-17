import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PilotageService } from './pilotage.service';
import {
  BREAKDOWN_DIMENSIONS,
  BreakdownDimension,
  BreakdownQuerySchema,
  BreakdownResponseDto,
  DedicatedFundsResponseDto,
  MyProjectsResponseDto,
  OverheadResponseDto,
  TRANSACTION_TYPES,
  TransactionsQuerySchema,
  TransactionsResponseDto,
} from './dto/pilotage.dto';

/**
 * Endpoints lecture seule pour les écrans de pilotage CG / PI.
 *
 * Volontairement séparé de `GrantController` :
 *   - évite les conflits de routes (`/grants/my-projects` vs `/grants/:id`)
 *   - garde un bounded context dédié pour les tableaux de bord
 *   - permet d'évoluer (RBAC, caching) indépendamment de la CRUD grant.
 *
 * Préfixe `/pilotage` côté Nest, l'API client web utilise donc :
 *   - GET /api/v1/pilotage/grants/my-projects
 *   - GET /api/v1/pilotage/grants/:id/transactions
 *   - GET /api/v1/pilotage/grants/:id/analytical-breakdown
 *   - GET /api/v1/pilotage/grants/:id/dedicated-funds
 *   - GET /api/v1/pilotage/grants/:id/overhead-calculation
 */
@ApiTags('pilotage')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('pilotage')
export class PilotageController {
  constructor(private readonly svc: PilotageService) {}

  // ------------------------------------------------------------------
  // Mes projets — PI uniquement (cross-PI safe via piUserId)
  // ------------------------------------------------------------------

  @Get('grants/my-projects')
  @Roles('PI', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Projets dont je suis Principal Investigator (+ leurs grants actifs)',
    description:
      'Filtre strict : project.pi_user_id = caller. Retourne 0 projets si non-PI sans flag SUPER_ADMIN.',
  })
  @ApiOkResponse({ type: MyProjectsResponseDto })
  myProjects(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.myProjects(user);
  }

  // ------------------------------------------------------------------
  // Transactions liées à un grant
  // ------------------------------------------------------------------

  @Get('grants/:id/transactions')
  @Roles('GO', 'CONTROLEUR', 'DAF', 'PI', 'COMPTABLE', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Timeline chronologique PR/PO/Invoice/Payment/OD imputés au grant',
  })
  @ApiQuery({ name: 'type', required: false, enum: TRANSACTION_TYPES })
  @ApiQuery({ name: 'fromDate', required: false, type: String })
  @ApiQuery({ name: 'toDate', required: false, type: String })
  @ApiQuery({ name: 'accountCode', required: false, type: String })
  @ApiOkResponse({ type: TransactionsResponseDto })
  @ApiNotFoundResponse({ description: 'Grant not found (BUSINESS.NOT_FOUND)' })
  async transactions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() rawQuery: Record<string, string>,
  ) {
    await this.svc.assertCanViewGrant(user, id);
    const parsed = TransactionsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.svc.transactions(id, parsed.data);
  }

  // ------------------------------------------------------------------
  // Ventilation analytique
  // ------------------------------------------------------------------

  @Get('grants/:id/analytical-breakdown')
  @Roles('GO', 'CONTROLEUR', 'DAF', 'PI', 'COMPTABLE', 'SUPER_ADMIN')
  @ApiOperation({
    summary:
      'Ventilation des charges (classe 6) imputées au grant selon une dimension analytique',
  })
  @ApiQuery({ name: 'by', required: false, enum: BREAKDOWN_DIMENSIONS })
  @ApiQuery({ name: 'fromDate', required: false, type: String })
  @ApiQuery({ name: 'toDate', required: false, type: String })
  @ApiOkResponse({ type: BreakdownResponseDto })
  @ApiNotFoundResponse({ description: 'Grant not found (BUSINESS.NOT_FOUND)' })
  async analyticalBreakdown(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() rawQuery: Record<string, string>,
  ) {
    await this.svc.assertCanViewGrant(user, id);
    const parsed = BreakdownQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.svc.analyticalBreakdown(
      id,
      parsed.data.by as BreakdownDimension,
      parsed.data.fromDate,
      parsed.data.toDate,
    );
  }

  // ------------------------------------------------------------------
  // Fonds dédiés SYSCEBNL (compte 19 + mouvements 689/789)
  // ------------------------------------------------------------------

  @Get('grants/:id/dedicated-funds')
  @Roles('GO', 'CONTROLEUR', 'DAF', 'PI', 'COMPTABLE', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Solde fonds dédiés (compte 19) + mouvements 689/789' })
  @ApiOkResponse({ type: DedicatedFundsResponseDto })
  @ApiNotFoundResponse({ description: 'Grant not found (BUSINESS.NOT_FOUND)' })
  async dedicatedFunds(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.svc.assertCanViewGrant(user, id);
    return this.svc.dedicatedFunds(id);
  }

  // ------------------------------------------------------------------
  // Overhead — facturable vs reversé
  // ------------------------------------------------------------------

  @Get('grants/:id/overhead-calculation')
  @Roles('GO', 'CONTROLEUR', 'DAF', 'PI', 'COMPTABLE', 'SUPER_ADMIN')
  @ApiOperation({
    summary:
      'Overhead facturable (somme co.overhead_calculation) vs reversé (crédits compte 754x) + variance',
  })
  @ApiOkResponse({ type: OverheadResponseDto })
  @ApiNotFoundResponse({ description: 'Grant not found (BUSINESS.NOT_FOUND)' })
  async overheadCalculation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.svc.assertCanViewGrant(user, id);
    return this.svc.overheadCalculation(id);
  }
}
