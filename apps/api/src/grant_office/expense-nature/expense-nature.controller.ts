import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ExpenseNatureService } from './expense-nature.service';

/**
 * GET-only : catalogue des natures de dépense (géré par seed, US-032).
 * RBAC : élargi US-064 aux rôles qui SAISISSENT une DA (DEMANDEUR, PI,
 * ACHETEUR) — le formulaire DA alimente son select de natures ici. Le
 * catalogue est read-only et non sensible ; le rôle dédié `GO` arrive
 * en US-065.
 */
@ApiTags('Grant Office — Expense Natures')
@ApiBearerAuth()
@Controller('expense-natures')
@Roles('CONTROLEUR', 'DAF', 'COMPTABLE', 'SUPER_ADMIN', 'DEMANDEUR', 'PI', 'ACHETEUR')
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
