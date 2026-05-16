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
import { GlAccountService } from './gl-account.service';
import { CreateGlAccountDto } from './dto/create-gl-account.dto';
import { UpdateGlAccountDto } from './dto/update-gl-account.dto';
import { GlAccountQueryDto } from './dto/gl-account-query.dto';
import {
  GlAccountListResponseDto,
  GlAccountResponseDto,
  GlAccountTreeNodeDto,
} from './dto/gl-account-response.dto';

@ApiTags('referential')
@ApiBearerAuth()
@ApiExtraModels(GlAccountTreeNodeDto, GlAccountListResponseDto)
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('gl-accounts')
export class GlAccountController {
  constructor(private readonly svc: GlAccountService) {}

  @Get()
  @ApiOperation({
    summary:
      "Liste paginée OU arbre hiérarchique (asTree=true) des comptes SYSCEBNL/OHADA",
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(GlAccountListResponseDto) },
        { type: 'array', items: { $ref: getSchemaPath(GlAccountTreeNodeDto) } },
      ],
    },
  })
  list(@Query() query: GlAccountQueryDto) {
    return this.svc.findMany(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail compte par UUID' })
  @ApiOkResponse({ type: GlAccountResponseDto })
  @ApiNotFoundResponse({ description: 'Account not found (BUSINESS.NOT_FOUND)' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(id);
  }

  @Get('by-code/:code')
  @ApiOperation({ summary: 'Détail compte par code SYSCEBNL (601, 6011, 4456, etc.)' })
  @ApiOkResponse({ type: GlAccountResponseDto })
  @ApiNotFoundResponse({ description: 'Account not found (BUSINESS.NOT_FOUND)' })
  findByCode(@Param('code') code: string) {
    return this.svc.findByCode(code);
  }

  @Post()
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer un compte général' })
  @ApiOkResponse({ type: GlAccountResponseDto, description: '201 Created' })
  @ApiConflictResponse({
    description:
      'Duplicate code (BUSINESS.DUPLICATE_CODE) or invalid class prefix (BUSINESS.INVALID_CLASS_PREFIX)',
  })
  create(@Body() dto: CreateGlAccountDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Modifier un compte (label, class, parent, drapeaux). Code immuable.',
  })
  @ApiOkResponse({ type: GlAccountResponseDto })
  @ApiNotFoundResponse({ description: 'Account not found (BUSINESS.NOT_FOUND)' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateGlAccountDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Désactiver un compte (soft delete via isActive=false)' })
  @ApiNotFoundResponse({ description: 'Account not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({
    description:
      'Already inactive (BUSINESS.ALREADY_INACTIVE), has children (BUSINESS.GL_ACCOUNT_HAS_CHILDREN) or has journal entries (BUSINESS.GL_ACCOUNT_HAS_ENTRIES)',
  })
  async softDelete(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.svc.softDelete(id);
  }

  @Post(':id/restore')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Réactiver un compte inactif' })
  @ApiOkResponse({ type: GlAccountResponseDto })
  @ApiNotFoundResponse({ description: 'Account not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Already active (BUSINESS.ALREADY_ACTIVE)' })
  restore(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.restore(id);
  }
}
