import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { NoteTechniqueService } from './note-technique.service';
import { CreateNoteTechniqueDto } from './dto/create-note-technique.dto';
import { UpdateNoteTechniqueDto } from './dto/update-note-technique.dto';
import { NoteTechniqueQueryDto } from './dto/note-technique-query.dto';
import { RejectNoteTechniqueDto } from './dto/reject-note-technique.dto';

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

  // ------------------------------------------------------------------
  // Transitions de workflow (US-052, ADR-006) — exposition REST des
  // transitions service livrées en US-051. RBAC par rôle existant :
  // GO = CONTROLEUR tant que le rôle GO dédié n'existe pas (US-058).
  // La SoD enforced par identité (drafted_by ≠ validated_by) = US-053.
  // ------------------------------------------------------------------

  @Post(':id/submit')
  @HttpCode(200)
  @Roles('CONTROLEUR', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Soumettre la Note Technique au DAF (draft → pending_daf).' })
  @ApiResponse({ status: 200, description: 'NT en attente de validation DAF.' })
  @ApiResponse({ status: 409, description: 'Transition impossible depuis le statut actuel.' })
  submitToDaf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.submitToDaf(id, user);
  }

  @Post(':id/validate')
  @HttpCode(200)
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Valider la Note Technique (pending_daf → validated_daf).' })
  @ApiResponse({ status: 200, description: 'NT validée par le DAF.' })
  @ApiResponse({ status: 409, description: 'Transition impossible depuis le statut actuel.' })
  validateAsDaf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.validateAsDaf(id, user);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Rejeter la Note Technique avec motif (pending_daf → draft).' })
  @ApiResponse({ status: 200, description: 'NT retournée en draft pour corrections.' })
  @ApiResponse({ status: 400, description: 'Motif manquant ou < 20 caractères (validation Zod).' })
  @ApiResponse({ status: 409, description: 'Transition impossible depuis le statut actuel.' })
  rejectAsDaf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectNoteTechniqueDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.rejectAsDaf(id, user, dto.reason);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @Roles('CONTROLEUR', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Activer la Note Technique (validated_daf → active, supersede l’ancienne).',
  })
  @ApiResponse({ status: 200, description: 'NT active ; ancienne active du grant superseded.' })
  @ApiResponse({ status: 409, description: 'Transition impossible depuis le statut actuel.' })
  activate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.activate(id, user);
  }
}
