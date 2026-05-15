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
import { DonorService } from './donor.service';
import { CreateDonorDto } from './dto/create-donor.dto';
import { UpdateDonorDto } from './dto/update-donor.dto';
import { DonorQueryDto } from './dto/donor-query.dto';
import {
  DonorDetailResponseDto,
  DonorListResponseDto,
  DonorResponseDto,
} from './dto/donor-response.dto';

// Le service renvoie des `Donor` Prisma (dates en `Date`). Nest sérialise
// automatiquement vers ISO 8601 dans la réponse JSON. Les `DonorResponseDto`
// servent UNIQUEMENT la documentation OpenAPI (Swagger), pas le typage
// strict du return — d'où l'absence d'annotation de type retour sur les
// handlers ci-dessous.

@ApiTags('referential')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('donors')
export class DonorController {
  constructor(private readonly svc: DonorService) {}

  // ------------------------------------------------------------------
  // Read — open to any authenticated user
  // ------------------------------------------------------------------

  @Get()
  @ApiOperation({ summary: 'Liste paginée des bailleurs (filtres + tri)' })
  @ApiOkResponse({ type: DonorListResponseDto })
  list(@Query() query: DonorQueryDto) {
    return this.svc.findMany(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail bailleur par UUID (+ count des grants liés)' })
  @ApiOkResponse({ type: DonorDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Donor not found (BUSINESS.NOT_FOUND)' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(id);
  }

  @Get('by-code/:code')
  @ApiOperation({ summary: 'Détail bailleur par code métier (BMGF, EDCTP, etc.)' })
  @ApiOkResponse({ type: DonorDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Donor not found (BUSINESS.NOT_FOUND)' })
  findByCode(@Param('code') code: string) {
    return this.svc.findByCode(code);
  }

  // ------------------------------------------------------------------
  // Write — restricted
  // ------------------------------------------------------------------

  @Post()
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer un bailleur' })
  @ApiOkResponse({ type: DonorResponseDto, description: '201 Created' })
  @ApiConflictResponse({ description: 'Code already in use (BUSINESS.DUPLICATE_CODE)' })
  create(@Body() dto: CreateDonorDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Remplacer entièrement un bailleur (PUT)' })
  @ApiOkResponse({ type: DonorResponseDto })
  @ApiNotFoundResponse({ description: 'Donor not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Code conflict (BUSINESS.DUPLICATE_CODE)' })
  replace(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CreateDonorDto) {
    return this.svc.replace(id, dto);
  }

  @Patch(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Mettre à jour un bailleur partiellement (PATCH)' })
  @ApiOkResponse({ type: DonorResponseDto })
  @ApiNotFoundResponse({ description: 'Donor not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Code conflict (BUSINESS.DUPLICATE_CODE)' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateDonorDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Désactiver un bailleur (soft delete)' })
  @ApiNotFoundResponse({ description: 'Donor not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Already inactive (BUSINESS.ALREADY_INACTIVE)' })
  async softDelete(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.svc.softDelete(id);
  }

  @Post(':id/restore')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Réactiver un bailleur inactif' })
  @ApiOkResponse({ type: DonorResponseDto })
  @ApiNotFoundResponse({ description: 'Donor not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Already active (BUSINESS.ALREADY_ACTIVE)' })
  restore(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.restore(id);
  }
}
