import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { PeriodCloseService } from './services/period-close.service';
import { DedicatedFundsService } from './services/dedicated-funds.service';
import { AccrualService } from './services/accrual.service';
import { PrepaymentService } from './services/prepayment.service';
import { ClosePeriodDto, ReopenPeriodDto } from './dto/period-close.dto';
import { RunPrepaymentsDto } from './dto/prepayment.dto';

@ApiTags('accounting')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly periodClose: PeriodCloseService,
    private readonly dedicatedFunds: DedicatedFundsService,
    private readonly accruals: AccrualService,
    private readonly prepayments: PrepaymentService,
    private readonly prisma: PrismaService,
  ) {}

  // ------------------------------------------------------------------
  // Périodes — lecture
  // ------------------------------------------------------------------

  @Get('periods')
  @Roles('COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Liste les périodes fiscales (ouvertes et closes)',
    description:
      'Sécurité : réservé aux rôles finance internes. Mêmes rôles que les ' +
      'actions de clôture — le BAILLEUR et les rôles métier (DEMANDEUR, PI, ' +
      'ACHETEUR, MAGASINIER) n\'ont pas à connaître l\'état des périodes.',
  })
  listPeriods() {
    return this.periodClose.listPeriods();
  }

  @Get('periods/:id/events')
  @Roles('COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Audit trail des opérations de clôture pour une période',
    description:
      'Sécurité : réservé aux rôles finance internes (cf. /periods). ' +
      'L\'audit trail peut contenir des motifs de ré-ouverture sensibles.',
  })
  @ApiNotFoundResponse({ description: 'BUSINESS.PERIOD_NOT_FOUND' })
  listEvents(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.periodClose.listEvents(id);
  }

  @Get('periods/:id/checks')
  @Roles('COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Findings du dernier precheck pour la période',
    description:
      'Sécurité : réservé aux rôles finance internes — les findings exposent ' +
      'des montants FNP attendus, des écritures déséquilibrées, et d\'autres ' +
      'données comptables non destinées au bailleur ou aux rôles métier.',
  })
  @ApiNotFoundResponse({ description: 'BUSINESS.PERIOD_NOT_FOUND' })
  listChecks(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.periodClose.listChecks(id);
  }

  // ------------------------------------------------------------------
  // Précheck (COMPTABLE / DAF / SUPER_ADMIN)
  // ------------------------------------------------------------------

  @Post('periods/:id/precheck')
  @Roles('COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Lance tous les checks de pré-clôture (réécrit les findings)',
    description:
      'Findings BLOCKING (C001..C006) empêchent close sauf override DAF. WARNING (W001..W003) signalés non bloquants.',
  })
  async precheck(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const actor = await this.resolveActor(user);
    return this.periodClose.precheck(actor, id);
  }

  // ------------------------------------------------------------------
  // Fonds dédiés (DAF / CONTROLEUR / SUPER_ADMIN)
  // ------------------------------------------------------------------

  @Post('periods/:id/dedicated-funds')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Calcule + comptabilise les fonds dédiés (689/789) sur la période',
    description:
      'Pour chaque grant actif : dotation 689/19 si ressources > dépenses, reprise 19/789 sinon. Idempotent.',
  })
  @ApiConflictResponse({ description: 'BUSINESS.PERIOD_ALREADY_CLOSED' })
  async runDedicatedFunds(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const actor = await this.resolveActor(user);
    return this.dedicatedFunds.run(actor, id);
  }

  // ------------------------------------------------------------------
  // Abonnements FNP — sprint F5b-a Lot 2 (COMPTABLE / CONTROLEUR / DAF / SUPER_ADMIN)
  // ------------------------------------------------------------------

  @Post('periods/:id/accruals')
  @Roles('COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary:
      'Génère les abonnements FNP (Factures Non Parvenues) pour les réceptions complètes non facturées',
    description:
      "Pour chaque GR complete dans la période sans facture posted : écriture OD débit charge / crédit 408 " +
      "+ extourne automatique au 1er jour de la période suivante. Idempotent : un re-run skip les GR déjà accruisés. " +
      'Imputation analytique (grant + budget_line) conservée. Aucune écriture posted sur une période close (trigger DB).',
  })
  @ApiConflictResponse({
    description: 'BUSINESS.PERIOD_ALREADY_CLOSED — la période doit être ouverte pour générer les FNP',
  })
  async runAccruals(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const actor = await this.resolveActor(user);
    return this.accruals.runFnpAccruals(actor, id);
  }

  // ------------------------------------------------------------------
  // Régularisations CCA/PCA — sprint F5b-a Lot 3
  // (COMPTABLE / CONTROLEUR / DAF / SUPER_ADMIN)
  // ------------------------------------------------------------------

  @Post('periods/:id/prepayments')
  @Roles('COMPTABLE', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Constate des régularisations CCA / PCA à la clôture (saisie explicite)',
    description:
      "Contrairement aux FNP qui se détectent automatiquement, les CCA/PCA exigent une saisie. " +
      "Body : { entries: [{ direction: 'CCA'|'PCA', accountCode, amount, label, ... }] }. " +
      "Chaque entry produit une OD (Débit 476/charge / Crédit 477/produit) + extourne à l'ouverture suivante. " +
      "Lève INVALID_CLASS_PREFIX si accountCode ne matche pas la direction (CCA→6x, PCA→7x).",
  })
  @ApiConflictResponse({
    description: 'BUSINESS.PERIOD_ALREADY_CLOSED / BUSINESS.GL_ACCOUNT_NOT_FOUND / BUSINESS.INVALID_CLASS_PREFIX',
  })
  async runPrepayments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RunPrepaymentsDto,
  ) {
    const actor = await this.resolveActor(user);
    return this.prepayments.runPrepayments(actor, id, dto.entries);
  }

  // ------------------------------------------------------------------
  // Close / reopen
  // ------------------------------------------------------------------

  @Post('periods/:id/close')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Clôture la période — DAF/CONTROLEUR',
    description:
      'Si findings BLOCKING : require acknowledgeWarnings=true + reason ≥ 5 chars (override DAF).',
  })
  @ApiConflictResponse({
    description: 'BUSINESS.PERIOD_ALREADY_CLOSED / PERIOD_CLOSE_BLOCKED',
  })
  async close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ClosePeriodDto,
  ) {
    const actor = await this.resolveActor(user);
    return this.periodClose.close(actor, id, dto);
  }

  @Post('periods/:id/reopen')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Ré-ouvre une période close — DAF uniquement',
    description: 'Reason obligatoire (audit trail). Journalisée dans period_close_event.',
  })
  @ApiConflictResponse({ description: 'BUSINESS.PERIOD_ALREADY_OPEN' })
  async reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReopenPeriodDto,
  ) {
    const actor = await this.resolveActor(user);
    return this.periodClose.reopen(actor, id, dto);
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
      return {
        id: existing.id,
        email: user.email,
        fullName: existing.fullName ?? user.fullName,
      };
    }
    const created = await this.prisma.appUser.create({
      data: { email: user.email, fullName: user.fullName || user.email },
      select: { id: true, fullName: true },
    });
    return {
      id: created.id,
      email: user.email,
      fullName: created.fullName ?? user.fullName,
    };
  }
}
