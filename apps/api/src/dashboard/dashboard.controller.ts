import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { DashboardService } from './dashboard.service';

/**
 * US-066 — compteurs dashboard en UNE requête (remplace le fan-out front
 * de 5 listes DA mono-statut + 3 listes à pageSize=1).
 *
 * Pas de @Roles : tout utilisateur authentifié a un dashboard ; le service
 * adapte les sections au rôle (scoping DA, sections comptables à null).
 */
@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Compteurs agrégés du dashboard (DA par statut, factures, conventions, paiements).',
    description:
      'DA en attente scopées par rôle (FULL_VIEW voit tout, sinon ses propres DA). ' +
      'Factures à matcher et paiements du mois : null pour les rôles sans vue comptable.',
  })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.service.summary(user);
  }
}
