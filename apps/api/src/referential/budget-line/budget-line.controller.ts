import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BudgetLineService } from './budget-line.service';
import { CreateBudgetLineDto } from './dto/create-budget-line.dto';
import { UpdateBudgetLineDto } from './dto/update-budget-line.dto';
import {
  BudgetLineListResponseDto,
  BudgetLineResponseDto,
  BulkImportResponseDto,
} from './dto/budget-line-response.dto';

/** Limite raisonnable pour un import budgétaire (15 Mo). */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

@ApiTags('referential')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('grants/:grantId/budget-lines')
export class BudgetLineController {
  constructor(private readonly svc: BudgetLineService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les lignes budgétaires actives d\'un grant' })
  @ApiOkResponse({ type: BudgetLineListResponseDto })
  @ApiNotFoundResponse({ description: 'Grant not found (BUSINESS.NOT_FOUND)' })
  list(@Param('grantId', new ParseUUIDPipe()) grantId: string) {
    return this.svc.listByGrant(grantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d\'une ligne budgétaire' })
  @ApiOkResponse({ type: BudgetLineResponseDto })
  @ApiNotFoundResponse({ description: 'Budget line not found (BUSINESS.NOT_FOUND)' })
  findOne(
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.findOne(grantId, id);
  }

  @Post()
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer une ligne budgétaire (unitaire)' })
  @ApiOkResponse({ type: BudgetLineResponseDto, description: '201 Created' })
  @ApiConflictResponse({
    description:
      'Duplicate code (BUSINESS.DUPLICATE_CODE) or sum > grant amount (BUSINESS.BUDGET_LINES_EXCEED_GRANT)',
  })
  create(
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Body() dto: CreateBudgetLineDto,
  ) {
    return this.svc.create(grantId, dto);
  }

  @Post('bulk')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({
    summary: 'Import en masse via fichier xlsx (atomique — rollback si une ligne échoue)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiOkResponse({ type: BulkImportResponseDto })
  @ApiConflictResponse({ description: 'BUSINESS.BUDGET_LINES_EXCEED_GRANT' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  bulk(
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart field "file")');
    return this.svc.bulkImportFromBuffer(grantId, file.buffer);
  }

  @Put(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Remplacer une ligne budgétaire (PUT)' })
  @ApiOkResponse({ type: BudgetLineResponseDto })
  @ApiNotFoundResponse({ description: 'Budget line not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Code conflict or budget overflow' })
  replace(
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateBudgetLineDto,
  ) {
    return this.svc.replace(grantId, id, dto);
  }

  @Patch(':id')
  @Roles('CONTROLEUR', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Mettre à jour une ligne budgétaire partiellement (PATCH)' })
  @ApiOkResponse({ type: BudgetLineResponseDto })
  @ApiNotFoundResponse({ description: 'Budget line not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Code conflict or budget overflow' })
  update(
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBudgetLineDto,
  ) {
    return this.svc.update(grantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Désactiver une ligne budgétaire (soft delete)' })
  @ApiNotFoundResponse({ description: 'Budget line not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({
    description:
      'Already inactive (BUSINESS.ALREADY_INACTIVE) or referenced by PR/PO/JL (BUSINESS.BUDGET_LINE_HAS_USAGE)',
  })
  async softDelete(
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.svc.softDelete(grantId, id);
  }

  @Post(':id/restore')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Réactiver une ligne budgétaire inactive' })
  @ApiOkResponse({ type: BudgetLineResponseDto })
  @ApiNotFoundResponse({ description: 'Budget line not found (BUSINESS.NOT_FOUND)' })
  @ApiConflictResponse({ description: 'Already active (BUSINESS.ALREADY_ACTIVE)' })
  restore(
    @Param('grantId', new ParseUUIDPipe()) grantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.restore(grantId, id);
  }
}
