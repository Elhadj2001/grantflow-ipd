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
import { CashBoxService } from './cash-box.service';
import { CreateCashBoxDto } from './dto/create-cash-box.dto';
import { UpdateCashBoxDto } from './dto/update-cash-box.dto';
import { CashBoxQueryDto } from './dto/cash-box-query.dto';
import {
  CashBoxBalanceResponseDto,
  CashBoxDetailResponseDto,
  CashBoxListResponseDto,
  CashBoxResponseDto,
} from './dto/cash-box-response.dto';

@ApiTags('referential')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('cash-boxes')
export class CashBoxController {
  constructor(private readonly svc: CashBoxService) {}

  // Read — tout utilisateur authentifié peut consulter (visibilité opérationnelle).

  @Get()
  @ApiOperation({ summary: 'Liste paginée des caisses (filtres + tri)' })
  @ApiOkResponse({ type: CashBoxListResponseDto })
  list(@Query() query: CashBoxQueryDto) {
    return this.svc.findMany(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail caisse par UUID (+ count DA rattachées)' })
  @ApiOkResponse({ type: CashBoxDetailResponseDto })
  @ApiNotFoundResponse({ description: 'CashBox not found (BUSINESS.NOT_FOUND)' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(id);
  }

  @Get(':id/balance')
  @ApiOperation({
    summary: 'Solde et plafonds temps réel — pour l\'UI du caissier',
    description:
      'Retourne le solde actuel + plafonds + consommation du jour ' +
      '(DA cash actives = draft/pending/approved). Lecture seule.',
  })
  @ApiOkResponse({ type: CashBoxBalanceResponseDto })
  @ApiNotFoundResponse({ description: 'CashBox not found' })
  getBalance(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.getBalance(id);
  }

  // Write — paramétrage réservé au CG/DAF.

  @Post()
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer une caisse' })
  @ApiOkResponse({ type: CashBoxResponseDto, description: '201 Created' })
  @ApiConflictResponse({ description: 'Code already in use (BUSINESS.DUPLICATE_CODE)' })
  create(@Body() dto: CreateCashBoxDto) {
    return this.svc.create(dto);
  }

  @Put(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Remplacer entièrement une caisse (PUT)' })
  @ApiOkResponse({ type: CashBoxResponseDto })
  @ApiNotFoundResponse({ description: 'CashBox not found' })
  @ApiConflictResponse({ description: 'Code conflict (BUSINESS.DUPLICATE_CODE)' })
  replace(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CreateCashBoxDto) {
    return this.svc.replace(id, dto);
  }

  @Patch(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Mettre à jour partiellement une caisse (PATCH)' })
  @ApiOkResponse({ type: CashBoxResponseDto })
  @ApiNotFoundResponse({ description: 'CashBox not found' })
  @ApiConflictResponse({ description: 'Code conflict (BUSINESS.DUPLICATE_CODE)' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateCashBoxDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Désactiver une caisse (soft delete)' })
  @ApiNotFoundResponse({ description: 'CashBox not found' })
  @ApiConflictResponse({ description: 'Already inactive (BUSINESS.ALREADY_INACTIVE)' })
  async softDelete(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.svc.softDelete(id);
  }

  @Post(':id/restore')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Réactiver une caisse inactive' })
  @ApiOkResponse({ type: CashBoxResponseDto })
  @ApiNotFoundResponse({ description: 'CashBox not found' })
  @ApiConflictResponse({ description: 'Already active (BUSINESS.ALREADY_ACTIVE)' })
  restore(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.restore(id);
  }
}
