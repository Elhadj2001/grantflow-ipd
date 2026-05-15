import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEmail, IsIn, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ROLES, type Role } from '../types/roles';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

/**
 * Représentation publique d'un user authentifié — telle qu'exposée
 * par GET /api/v1/auth/me et consommée par le front.
 *
 * Découple la couche transport (Swagger / class-validator) de la
 * couche métier (`AuthenticatedUser`). N'expose JAMAIS de champs
 * internes Keycloak (`exp`, `iat`, `azp`, `realm_access`, …).
 */
export class AuthenticatedUserDto {
  @ApiProperty({ format: 'uuid', description: 'Identifiant stable (Keycloak sub)' })
  @IsUUID()
  id!: string;

  @ApiProperty({ format: 'email' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @ApiProperty({ enum: ROLES, isArray: true, description: 'Rôles RBAC validés' })
  @IsArray()
  @ArrayUnique()
  @IsIn(ROLES, { each: true })
  roles!: Role[];

  static from(user: AuthenticatedUser): AuthenticatedUserDto {
    const dto = new AuthenticatedUserDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.fullName = user.fullName;
    dto.roles = user.roles;
    return dto;
  }
}
