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
import { Roles } from '../auth/decorators/roles.decorator';
import { BankAccountService } from './services/bank-account.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-account.dto';

@ApiTags('treasury')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('bank-accounts')
export class BankAccountController {
  constructor(private readonly svc: BankAccountService) {}

  @Get()
  @ApiOperation({ summary: 'Liste des comptes bancaires IPD (actifs et inactifs)' })
  list() {
    return this.svc.findMany();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail compte bancaire' })
  @ApiNotFoundResponse({ description: 'BANK_ACCOUNT_NOT_FOUND' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  @Roles('TRESORIER', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer un compte bancaire (gl_account doit être en classe 5)' })
  @ApiConflictResponse({
    description: 'DUPLICATE_CODE / BANK_ACCOUNT_WRONG_CLASS',
  })
  create(@Body() dto: CreateBankAccountDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @Roles('TRESORIER', 'DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Mettre à jour un compte bancaire (partiel)' })
  @ApiConflictResponse({ description: 'DUPLICATE_CODE / BANK_ACCOUNT_WRONG_CLASS' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Désactiver un compte bancaire (soft delete)' })
  async softDelete(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.svc.softDelete(id);
  }

  @Post(':id/restore')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Réactiver un compte bancaire inactif' })
  @ApiOkResponse({ description: 'BankAccount' })
  restore(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.restore(id);
  }
}
