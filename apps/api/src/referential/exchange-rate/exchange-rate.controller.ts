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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { ExchangeRateService } from './exchange-rate.service';
import { CreateExchangeRateDto } from './dto/create-exchange-rate.dto';
import { UpdateExchangeRateDto } from './dto/update-exchange-rate.dto';
import {
  ExchangeRateLookupDto,
  ExchangeRateQueryDto,
} from './dto/exchange-rate-query.dto';
import {
  ExchangeRateListResponseDto,
  ExchangeRateLookupResponseDto,
  ExchangeRateResponseDto,
} from './dto/exchange-rate-response.dto';

@ApiTags('referential')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('exchange-rates')
export class ExchangeRateController {
  constructor(private readonly svc: ExchangeRateService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  @Get()
  @ApiOperation({ summary: 'Liste paginée des taux de change (filtres from/to/dates/isFixed)' })
  @ApiOkResponse({ type: ExchangeRateListResponseDto })
  list(@Query() query: ExchangeRateQueryDto) {
    return this.svc.findMany(query);
  }

  @Get('lookup')
  @ApiOperation({
    summary: 'Lookup du taux applicable (utilisé par les conversions métiers)',
    description: `
**Règle UEMOA**

Le couple EUR↔XOF est lié par la parité fixe BCEAO **1 EUR = 655,957 XOF**
(décret du 04/01/1999). L'endpoint retourne directement la ligne \`isFixed=true\`
quelle que soit la date passée.

Pour les autres devises (USD, GBP, CHF…), on cherche le taux le plus récent
\`rateDate ≤ date\` (date par défaut = aujourd'hui). Le champ \`isFallback\` indique
si on a dû remonter dans le temps.

**Exemples**
\`\`\`bash
# Parité fixe — date ignorée
curl "/api/v1/exchange-rates/lookup?from=EUR&to=XOF"
# → { "rate": "655.95700000", "isFixed": true, "isFallback": false, ... }

# Taux variable USD→XOF au 14 mai 2026
curl "/api/v1/exchange-rates/lookup?from=USD&to=XOF&date=2026-05-14"
# → { "rate": "598.10000000", "rateDate": "2026-05-14", "isFixed": false, "isFallback": false }
\`\`\`
    `.trim(),
  })
  @ApiOkResponse({ type: ExchangeRateLookupResponseDto })
  @ApiNotFoundResponse({ description: 'No exchange rate available (BUSINESS.EXCHANGE_RATE_NOT_FOUND)' })
  lookup(@Query() query: ExchangeRateLookupDto) {
    return this.svc.lookup(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail taux de change par UUID' })
  @ApiOkResponse({ type: ExchangeRateResponseDto })
  @ApiNotFoundResponse({ description: 'Exchange rate not found (BUSINESS.NOT_FOUND)' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(id);
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  @Post()
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Insérer un nouveau taux du jour',
    description:
      "Pour les couples ayant une parité fixe (EUR↔XOF), l'ajout d'un taux variable est refusé " +
      "(BUSINESS.FIXED_RATE_EXISTS). L'ajout d'une nouvelle parité fixe (isFixed=true) est réservé " +
      'au rôle SUPER_ADMIN.',
  })
  @ApiOkResponse({ type: ExchangeRateResponseDto, description: '201 Created' })
  @ApiConflictResponse({
    description: 'Fixed parity exists (BUSINESS.FIXED_RATE_EXISTS) or duplicate (P2002)',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExchangeRateDto) {
    return this.svc.create(user, dto);
  }

  @Patch(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Corriger un taux existant (rate, source)',
    description:
      "Les lignes `isFixed=true` ne sont modifiables que par SUPER_ADMIN " +
      '(BUSINESS.IMMUTABLE_FIXED_RATE).',
  })
  @ApiOkResponse({ type: ExchangeRateResponseDto })
  @ApiNotFoundResponse({ description: 'Exchange rate not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Cannot modify fixed rate (BUSINESS.IMMUTABLE_FIXED_RATE)' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateExchangeRateDto,
  ) {
    return this.svc.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Supprimer un taux (hard delete car ligne historique)',
    description:
      "Les lignes `isFixed=true` ne sont supprimables que par SUPER_ADMIN " +
      '(BUSINESS.IMMUTABLE_FIXED_RATE).',
  })
  @ApiNotFoundResponse({ description: 'Exchange rate not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Cannot delete fixed rate (BUSINESS.IMMUTABLE_FIXED_RATE)' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.svc.remove(user, id);
  }
}
