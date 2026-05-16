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
import { GrantService } from './grant.service';
import { CreateGrantDto } from './dto/create-grant.dto';
import { UpdateGrantDto } from './dto/update-grant.dto';
import { GrantQueryDto } from './dto/grant-query.dto';
import {
  GrantDashboardResponseDto,
  GrantListResponseDto,
  GrantResponseDto,
} from './dto/grant-response.dto';

@ApiTags('referential')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('grants')
export class GrantController {
  constructor(private readonly svc: GrantService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  @Get()
  @ApiOperation({ summary: 'Liste paginée des conventions' })
  @ApiOkResponse({ type: GrantListResponseDto })
  list(@Query() query: GrantQueryDto) {
    return this.svc.findMany(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail convention par UUID' })
  @ApiOkResponse({ type: GrantResponseDto })
  @ApiNotFoundResponse({ description: 'Grant not found (BUSINESS.NOT_FOUND)' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(id);
  }

  @Get('by-reference/:reference')
  @ApiOperation({ summary: 'Détail convention par référence (BMGF-2023-117, etc.)' })
  @ApiOkResponse({ type: GrantResponseDto })
  @ApiNotFoundResponse({ description: 'Grant not found (BUSINESS.NOT_FOUND)' })
  findByReference(@Param('reference') reference: string) {
    return this.svc.findByReference(reference);
  }

  // ------------------------------------------------------------------
  // Dashboard
  // ------------------------------------------------------------------

  @Get(':id/dashboard')
  @ApiOperation({
    summary: 'Tableau de bord budgétaire temps réel (engagé / consommé / disponible)',
  })
  @ApiOkResponse({ type: GrantDashboardResponseDto })
  @ApiNotFoundResponse({ description: 'Grant not found (BUSINESS.NOT_FOUND)' })
  dashboard(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.dashboard(id);
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  @Post()
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer une convention' })
  @ApiOkResponse({ type: GrantResponseDto, description: '201 Created' })
  @ApiConflictResponse({
    description:
      'Reference duplicate (BUSINESS.DUPLICATE_CODE), inactive donor (BUSINESS.INACTIVE_DONOR) or inactive project (BUSINESS.INACTIVE_PROJECT)',
  })
  create(@Body() dto: CreateGrantDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Remplacer entièrement une convention (PUT)' })
  @ApiOkResponse({ type: GrantResponseDto })
  @ApiNotFoundResponse({ description: 'Grant not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Reference conflict / inactive FK' })
  replace(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CreateGrantDto) {
    return this.svc.replace(id, dto);
  }

  @Patch(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Mettre à jour une convention partiellement (PATCH)' })
  @ApiOkResponse({ type: GrantResponseDto })
  @ApiNotFoundResponse({ description: 'Grant not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Reference conflict / inactive FK' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateGrantDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Clôturer une convention (soft delete via status=closed)' })
  @ApiNotFoundResponse({ description: 'Grant not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({
    description:
      'Already closed (BUSINESS.ALREADY_INACTIVE) or has accounting transactions (BUSINESS.GRANT_HAS_TRANSACTIONS)',
  })
  async softDelete(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.svc.softDelete(id);
  }

  @Post(':id/suspend')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Suspendre une convention (status=suspended)' })
  @ApiOkResponse({ type: GrantResponseDto })
  @ApiNotFoundResponse({ description: 'Grant not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Already suspended or closed' })
  suspend(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.suspend(id);
  }

  @Post(':id/reactivate')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Réactiver une convention suspendue ou close (status=active)' })
  @ApiOkResponse({ type: GrantResponseDto })
  @ApiNotFoundResponse({ description: 'Grant not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Already active (BUSINESS.ALREADY_ACTIVE)' })
  reactivate(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.reactivate(id);
  }
}
