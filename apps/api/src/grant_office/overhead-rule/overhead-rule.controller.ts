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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { OverheadRuleService } from './overhead-rule.service';
import { CreateOverheadRuleDto } from './dto/create-overhead-rule.dto';
import { UpdateOverheadRuleDto } from './dto/update-overhead-rule.dto';

@ApiTags('Grant Office — Overhead Rules')
@ApiBearerAuth()
@Controller('overhead-rules')
export class OverheadRuleController {
  constructor(private readonly service: OverheadRuleService) {}

  @Get()
  @Roles('GO', 'CONTROLEUR', 'DAF', 'COMPTABLE', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Liste les règles d’overhead actives.' })
  list() {
    return this.service.list();
  }

  @Get(':id')
  @Roles('GO', 'CONTROLEUR', 'DAF', 'COMPTABLE', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Détail d’une règle d’overhead.' })
  findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Crée une règle d’overhead.' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOverheadRuleDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles('DAF', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Met à jour une règle d’overhead.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOverheadRuleDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('DAF', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Désactive (soft delete) une règle d’overhead.' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.softDelete(user, id);
  }
}
