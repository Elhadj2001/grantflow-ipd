import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ExpenseNatureService } from './expense-nature.service';

/**
 * GET-only : catalogue des natures de dépense (géré par seed, US-032).
 * RBAC : rôles « Grant Office » au sens fonctionnel. Une rôle dédié `GO`
 * sera ajouté en Sprint S5 (réalm Keycloak + ROLES + packages/shared) ;
 * en attendant, CONTROLEUR (contrôle de gestion) porte cette fonction.
 */
@ApiTags('Grant Office — Expense Natures')
@ApiBearerAuth()
@Controller('expense-natures')
@Roles('CONTROLEUR', 'DAF', 'COMPTABLE', 'SUPER_ADMIN')
export class ExpenseNatureController {
  constructor(private readonly service: ExpenseNatureService) {}

  @Get()
  @ApiOperation({ summary: 'Liste le catalogue des natures de dépense (read-only).' })
  list() {
    return this.service.list();
  }

  @Get(':code')
  @ApiOperation({ summary: 'Détail d’une nature de dépense par code.' })
  findByCode(@Param('code') code: string) {
    return this.service.findByCode(code);
  }
}
