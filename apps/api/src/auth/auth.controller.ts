import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUserDto } from './dto/authenticated-user.dto';
import type { AuthenticatedUser } from './types/authenticated-user.type';

/**
 * Endpoints d'authentification consommables par le front.
 *
 *  - L'auth proprement dite (login / refresh / logout) est gérée par
 *    Keycloak ; cette API n'expose que des endpoints de "post-login"
 *    pour récupérer le profil utilisateur tel que vu par le backend.
 */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  /**
   * Retourne le profil de l'utilisateur authentifié.
   *
   * Pas de `@Roles(...)` : tout utilisateur authentifié peut lire
   * son propre profil (équivaut à `/userinfo` côté OIDC, mais filtré
   * pour ne renvoyer que ce dont le front a besoin).
   */
  @Get('me')
  @ApiOperation({ summary: "Profil de l'utilisateur authentifié" })
  @ApiOkResponse({ type: AuthenticatedUserDto })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUserDto {
    return AuthenticatedUserDto.from(user);
  }
}
