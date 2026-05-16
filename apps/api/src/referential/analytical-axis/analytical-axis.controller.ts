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
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AnalyticalAxisService } from './analytical-axis.service';
import { CreateAnalyticalAxisDto } from './dto/create-analytical-axis.dto';
import { UpdateAnalyticalAxisDto } from './dto/update-analytical-axis.dto';
import { AnalyticalAxisQueryDto } from './dto/analytical-axis-query.dto';
import {
  AnalyticalAxisDetailResponseDto,
  AnalyticalAxisListResponseDto,
  AnalyticalAxisResponseDto,
  AnalyticalAxisTreeNodeDto,
} from './dto/analytical-axis-response.dto';

@ApiTags('referential')
@ApiBearerAuth()
@ApiExtraModels(AnalyticalAxisTreeNodeDto, AnalyticalAxisListResponseDto)
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('analytical-axes')
export class AnalyticalAxisController {
  constructor(private readonly svc: AnalyticalAxisService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary:
      'Liste paginée OU arbre hiérarchique (asTree=true) des axes analytiques',
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AnalyticalAxisListResponseDto) },
        { type: 'array', items: { $ref: getSchemaPath(AnalyticalAxisTreeNodeDto) } },
      ],
    },
  })
  list(@Query() query: AnalyticalAxisQueryDto) {
    return this.svc.findMany(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail axe par UUID (+ childCount + path complet)' })
  @ApiOkResponse({ type: AnalyticalAxisDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Axis not found (BUSINESS.NOT_FOUND)' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(id);
  }

  @Get('by-code/:type/:code')
  @ApiOperation({ summary: 'Détail axe par (type, code)' })
  @ApiOkResponse({ type: AnalyticalAxisDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Axis not found (BUSINESS.NOT_FOUND)' })
  findByCode(@Param('type') type: string, @Param('code') code: string) {
    return this.svc.findByCode(type, code);
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  @Post()
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer un axe analytique' })
  @ApiOkResponse({ type: AnalyticalAxisResponseDto, description: '201 Created' })
  @ApiConflictResponse({
    description:
      'Duplicate code (BUSINESS.DUPLICATE_CODE), cycle (BUSINESS.AXIS_CYCLE) or parent type mismatch (BUSINESS.AXIS_PARENT_WRONG_TYPE)',
  })
  create(@Body() dto: CreateAnalyticalAxisDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Remplacer entièrement un axe (PUT)' })
  @ApiOkResponse({ type: AnalyticalAxisResponseDto })
  @ApiNotFoundResponse({ description: 'Axis not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Code conflict / cycle / parent type' })
  replace(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateAnalyticalAxisDto,
  ) {
    return this.svc.replace(id, dto);
  }

  @Patch(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Mettre à jour un axe partiellement (PATCH)' })
  @ApiOkResponse({ type: AnalyticalAxisResponseDto })
  @ApiNotFoundResponse({ description: 'Axis not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Code conflict / cycle / parent type' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAnalyticalAxisDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Désactiver un axe (soft delete)' })
  @ApiNotFoundResponse({ description: 'Axis not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({
    description:
      'Already inactive (BUSINESS.ALREADY_INACTIVE), has children (BUSINESS.AXIS_HAS_CHILDREN) or has usage (BUSINESS.AXIS_HAS_USAGE)',
  })
  async softDelete(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.svc.softDelete(id);
  }

  @Post(':id/restore')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Réactiver un axe inactif' })
  @ApiOkResponse({ type: AnalyticalAxisResponseDto })
  @ApiNotFoundResponse({ description: 'Axis not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Already active (BUSINESS.ALREADY_ACTIVE)' })
  restore(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.restore(id);
  }
}
