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
import { SupplierService } from './supplier.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
import {
  SupplierDetailResponseDto,
  SupplierListResponseDto,
  SupplierResponseDto,
} from './dto/supplier-response.dto';

@ApiTags('referential')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('suppliers')
export class SupplierController {
  constructor(private readonly svc: SupplierService) {}

  @Get()
  @ApiOperation({ summary: 'Liste paginée des fournisseurs (recherche pg_trgm si q présent)' })
  @ApiOkResponse({ type: SupplierListResponseDto })
  list(@Query() query: SupplierQueryDto) {
    return this.svc.findMany(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail fournisseur par UUID (+ count des BC associés)' })
  @ApiOkResponse({ type: SupplierDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Supplier not found (BUSINESS.NOT_FOUND)' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(id);
  }

  @Get('by-code/:code')
  @ApiOperation({ summary: 'Détail fournisseur par code métier (THERMO_FISHER, etc.)' })
  @ApiOkResponse({ type: SupplierDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Supplier not found (BUSINESS.NOT_FOUND)' })
  findByCode(@Param('code') code: string) {
    return this.svc.findByCode(code);
  }

  @Post()
  @Roles('ACHETEUR', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer un fournisseur' })
  @ApiOkResponse({ type: SupplierResponseDto, description: '201 Created' })
  @ApiConflictResponse({ description: 'Code already in use (BUSINESS.DUPLICATE_CODE)' })
  create(@Body() dto: CreateSupplierDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  @Roles('ACHETEUR', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Remplacer entièrement un fournisseur (PUT)' })
  @ApiOkResponse({ type: SupplierResponseDto })
  @ApiNotFoundResponse({ description: 'Supplier not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Code conflict (BUSINESS.DUPLICATE_CODE)' })
  replace(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CreateSupplierDto) {
    return this.svc.replace(id, dto);
  }

  @Patch(':id')
  @Roles('ACHETEUR', 'CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Mettre à jour un fournisseur partiellement (PATCH)' })
  @ApiOkResponse({ type: SupplierResponseDto })
  @ApiNotFoundResponse({ description: 'Supplier not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Code conflict (BUSINESS.DUPLICATE_CODE)' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateSupplierDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Désactiver un fournisseur (soft delete)' })
  @ApiNotFoundResponse({ description: 'Supplier not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({
    description:
      'Already inactive (BUSINESS.ALREADY_INACTIVE) or has active POs (BUSINESS.SUPPLIER_HAS_ACTIVE_POS)',
  })
  async softDelete(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.svc.softDelete(id);
  }

  @Post(':id/restore')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Réactiver un fournisseur inactif' })
  @ApiOkResponse({ type: SupplierResponseDto })
  @ApiNotFoundResponse({ description: 'Supplier not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Already active (BUSINESS.ALREADY_ACTIVE)' })
  restore(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.restore(id);
  }
}
