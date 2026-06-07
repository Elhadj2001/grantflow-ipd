import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { NoteTechniqueService } from './note-technique.service';
import { CreateNoteTechniqueDto } from './dto/create-note-technique.dto';
import { UpdateNoteTechniqueDto } from './dto/update-note-technique.dto';
import { NoteTechniqueQueryDto } from './dto/note-technique-query.dto';

/**
 * CRUD basique Note Technique (scaffolding US-033 — pas de workflow).
 * RBAC : CONTROLEUR (fonction Grant Office, rôle GO dédié = Sprint S5)
 * crée/édite ; DAF/COMPTABLE/SUPER_ADMIN consultent.
 */
@ApiTags('Grant Office — Notes Techniques')
@ApiBearerAuth()
@Controller('note-techniques')
export class NoteTechniqueController {
  constructor(private readonly service: NoteTechniqueService) {}

  @Get()
  @Roles('CONTROLEUR', 'DAF', 'COMPTABLE', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Liste les Notes Techniques (filtres grantId / status).' })
  list(@Query() query: NoteTechniqueQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Roles('CONTROLEUR', 'DAF', 'COMPTABLE', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Détail d’une Note Technique (overheadRule + budgetLines).' })
  findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Crée une Note Technique en statut draft.' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNoteTechniqueDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Met à jour une Note Technique (draft uniquement).' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateNoteTechniqueDto,
  ) {
    return this.service.update(user, id, dto);
  }
}
