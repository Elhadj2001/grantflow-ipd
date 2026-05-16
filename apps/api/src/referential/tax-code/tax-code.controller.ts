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
import { TaxCodeService } from './tax-code.service';
import { CreateTaxCodeDto } from './dto/create-tax-code.dto';
import { UpdateTaxCodeDto } from './dto/update-tax-code.dto';
import { TaxCodeQueryDto } from './dto/tax-code-query.dto';
import {
  TaxCodeListResponseDto,
  TaxCodeResponseDto,
} from './dto/tax-code-response.dto';

@ApiTags('referential')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('tax-codes')
export class TaxCodeController {
  constructor(private readonly svc: TaxCodeService) {}

  @Get()
  @ApiOperation({ summary: 'Liste paginée des codes TVA' })
  @ApiOkResponse({ type: TaxCodeListResponseDto })
  list(@Query() query: TaxCodeQueryDto) {
    return this.svc.findMany(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail code TVA par UUID' })
  @ApiOkResponse({ type: TaxCodeResponseDto })
  @ApiNotFoundResponse({ description: 'Tax code not found (BUSINESS.NOT_FOUND)' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(id);
  }

  @Get('by-code/:code')
  @ApiOperation({ summary: 'Détail code TVA par code métier (TVA18, etc.)' })
  @ApiOkResponse({ type: TaxCodeResponseDto })
  @ApiNotFoundResponse({ description: 'Tax code not found (BUSINESS.NOT_FOUND)' })
  findByCode(@Param('code') code: string) {
    return this.svc.findByCode(code);
  }

  @Post()
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer un code TVA' })
  @ApiOkResponse({ type: TaxCodeResponseDto, description: '201 Created' })
  @ApiConflictResponse({ description: 'Code already in use (BUSINESS.DUPLICATE_CODE)' })
  create(@Body() dto: CreateTaxCodeDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Remplacer entièrement un code TVA (PUT)' })
  @ApiOkResponse({ type: TaxCodeResponseDto })
  @ApiNotFoundResponse({ description: 'Tax code not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Code conflict (BUSINESS.DUPLICATE_CODE)' })
  replace(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CreateTaxCodeDto) {
    return this.svc.replace(id, dto);
  }

  @Patch(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Mettre à jour un code TVA partiellement (PATCH)' })
  @ApiOkResponse({ type: TaxCodeResponseDto })
  @ApiNotFoundResponse({ description: 'Tax code not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Code conflict (BUSINESS.DUPLICATE_CODE)' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateTaxCodeDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Désactiver un code TVA (soft delete)' })
  @ApiNotFoundResponse({ description: 'Tax code not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({
    description:
      'Already inactive (BUSINESS.ALREADY_INACTIVE) or referenced by PO/Invoice lines (BUSINESS.TAX_CODE_HAS_USAGE)',
  })
  async softDelete(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.svc.softDelete(id);
  }

  @Post(':id/restore')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Réactiver un code TVA inactif' })
  @ApiOkResponse({ type: TaxCodeResponseDto })
  @ApiNotFoundResponse({ description: 'Tax code not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Already active (BUSINESS.ALREADY_ACTIVE)' })
  restore(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.restore(id);
  }
}
