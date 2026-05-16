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
  Put,
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
import { Roles } from '../../auth/decorators/roles.decorator';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectQueryDto } from './dto/project-query.dto';
import {
  ProjectDetailResponseDto,
  ProjectListResponseDto,
  ProjectResponseDto,
} from './dto/project-response.dto';

@ApiTags('referential')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('projects')
export class ProjectController {
  constructor(private readonly svc: ProjectService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  @Get()
  @ApiOperation({ summary: 'Liste paginée des projets' })
  @ApiOkResponse({ type: ProjectListResponseDto })
  list(@Query() query: ProjectQueryDto) {
    return this.svc.findMany(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail projet par UUID' })
  @ApiOkResponse({ type: ProjectDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Project not found (BUSINESS.NOT_FOUND)' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(id);
  }

  @Get('by-code/:code')
  @ApiOperation({ summary: 'Détail projet par code (MADIBA-VAC-2024, etc.)' })
  @ApiOkResponse({ type: ProjectDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Project not found (BUSINESS.NOT_FOUND)' })
  findByCode(@Param('code') code: string) {
    return this.svc.findByCode(code);
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  @Post()
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer un projet' })
  @ApiOkResponse({ type: ProjectResponseDto, description: '201 Created' })
  @ApiConflictResponse({ description: 'Code already in use (BUSINESS.DUPLICATE_CODE)' })
  create(@Body() dto: CreateProjectDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Remplacer entièrement un projet (PUT)' })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiNotFoundResponse({ description: 'Project not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Code conflict (BUSINESS.DUPLICATE_CODE)' })
  replace(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CreateProjectDto) {
    return this.svc.replace(id, dto);
  }

  @Patch(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Mettre à jour un projet partiellement (PATCH)' })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiNotFoundResponse({ description: 'Project not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Code conflict (BUSINESS.DUPLICATE_CODE)' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateProjectDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Fermer un projet (soft delete via status=closed)' })
  @ApiNotFoundResponse({ description: 'Project not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({
    description:
      'Already closed (BUSINESS.ALREADY_INACTIVE) or has active grants (BUSINESS.PROJECT_HAS_ACTIVE_GRANTS)',
  })
  async softDelete(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.svc.softDelete(id);
  }

  @Post(':id/restore')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Réouvrir un projet clos' })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiNotFoundResponse({ description: 'Project not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Already active (BUSINESS.ALREADY_ACTIVE)' })
  restore(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.restore(id);
  }
}
