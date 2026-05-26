import {
  Body,
  Controller,
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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { AdminUsersService } from './admin-users.service';
import {
  AdminUserListResponseDto,
  AdminUserResponseDto,
  CreateAdminUserDto,
  CreateAdminUserResponseDto,
  ListAdminUsersQueryDto,
  SetUserRolesDto,
  UpdateAdminUserDto,
} from './dto/admin-user.dto';

/**
 * Endpoints d'administration des utilisateurs (hybride Keycloak + AppUser).
 *
 * RBAC : SUPER_ADMIN ou DAF uniquement — toute autre tentative remonte 403
 * (AUTH.FORBIDDEN_ROLE) via le RolesGuard global.
 */
@ApiTags('admin-users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required (AUTH.UNAUTHENTICATED)' })
@ApiForbiddenResponse({ description: 'Insufficient role (AUTH.FORBIDDEN_ROLE)' })
@Controller('admin/users')
@Roles('SUPER_ADMIN', 'DAF')
export class AdminUsersController {
  constructor(private readonly svc: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'Liste paginée des utilisateurs (merge AppUser + Keycloak.enabled)' })
  @ApiOkResponse({ type: AdminUserListResponseDto })
  list(@Query() query: ListAdminUsersQueryDto) {
    return this.svc.findMany(query);
  }

  @Get(':id')
  @ApiOperation({ summary: "Détail d'un utilisateur (profil + rôles + statut Keycloak)" })
  @ApiOkResponse({ type: AdminUserResponseDto })
  @ApiNotFoundResponse({ description: 'User not found (BUSINESS.USER_NOT_FOUND)' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary:
      "Créer un utilisateur : 1) Keycloak (sans password) → 2) AppUser+UserRole → 3) e-mail invitation",
  })
  @ApiOkResponse({ type: CreateAdminUserResponseDto, description: '201 Created' })
  @ApiConflictResponse({
    description: 'Email already exists (BUSINESS.USER_EMAIL_ALREADY_EXISTS)',
  })
  create(@Body() dto: CreateAdminUserDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Mettre à jour le profil (fullName, department, employeeCode)' })
  @ApiOkResponse({ type: AdminUserResponseDto })
  @ApiNotFoundResponse({ description: 'User not found (BUSINESS.USER_NOT_FOUND)' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateAdminUserDto) {
    return this.svc.update(id, dto);
  }

  @Put(':id/roles')
  @ApiOperation({
    summary:
      "Remplacer l'ensemble des rôles (Keycloak realm-roles + UserRole synchronisés)",
  })
  @ApiOkResponse({ type: AdminUserResponseDto })
  @ApiConflictResponse({
    description: 'Last SUPER_ADMIN protection (BUSINESS.USER_CANNOT_REMOVE_LAST_SUPER_ADMIN)',
  })
  setRoles(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SetUserRolesDto) {
    return this.svc.setRoles(id, dto);
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Désactiver un compte (Keycloak enabled=false + AppUser suspended)' })
  @ApiOkResponse({ type: AdminUserResponseDto })
  @ApiConflictResponse({
    description:
      'Self-deactivation (BUSINESS.USER_CANNOT_DEACTIVATE_SELF) or last SUPER_ADMIN ' +
      '(BUSINESS.USER_CANNOT_REMOVE_LAST_SUPER_ADMIN) or already inactive',
  })
  deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.deactivate(id, actor.id);
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Réactiver un compte (Keycloak enabled=true + AppUser active)' })
  @ApiOkResponse({ type: AdminUserResponseDto })
  @ApiConflictResponse({ description: 'Already active (BUSINESS.USER_ALREADY_ACTIVE)' })
  activate(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.activate(id);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      "Déclencher l'envoi d'un e-mail UPDATE_PASSWORD via Keycloak (SMTP requis)",
  })
  @ApiNotFoundResponse({ description: 'User not found (BUSINESS.USER_NOT_FOUND)' })
  async resetPassword(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.svc.resetPassword(id);
  }
}
