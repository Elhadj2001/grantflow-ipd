import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { ROLES } from '../../../auth/types/roles';

/**
 * Format wire des rôles autorisés. On utilise directement la source de
 * vérité ROLES — rien ne peut diverger.
 */
const RoleSchema = z.enum(ROLES);

/**
 * Statut renvoyé côté API. On mappe `UserStatus.suspended` (Prisma) à
 * `inactive` côté UI/API : c'est le vocabulaire métier ("désactiver un
 * compte"), `locked` est un cas Keycloak séparé (brute-force).
 */
export const USER_API_STATUSES = ['active', 'inactive'] as const;
export type UserApiStatus = (typeof USER_API_STATUSES)[number];

// =====================================================================
//  Query — GET /admin/users
// =====================================================================

const coerceBool = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

export const ListAdminUsersQuerySchema = z
  .object({
    q: z.string().min(1).max(128).optional(),
    role: RoleSchema.optional(),
    status: z.enum(USER_API_STATUSES).optional(),
    includeInactive: coerceBool.optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 100, 20),
    sort: z.enum(['email', 'fullName', 'createdAt']).default('email'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export class ListAdminUsersQueryDto extends createZodDto(ListAdminUsersQuerySchema) {}

// =====================================================================
//  Create — POST /admin/users
// =====================================================================

export const CreateAdminUserSchema = z
  .object({
    email: z.string().email().min(3).max(255),
    fullName: z.string().min(2).max(255),
    department: z.string().max(128).optional(),
    employeeCode: z.string().max(64).optional(),
    /**
     * Au moins un rôle obligatoire à la création — créer un user "sans
     * rôle" reviendrait à un compte fantôme inutilisable.
     */
    roles: z.array(RoleSchema).min(1).max(ROLES.length),
  })
  .strict();

export class CreateAdminUserDto extends createZodDto(CreateAdminUserSchema) {}

// =====================================================================
//  Patch profile — PATCH /admin/users/:id
// =====================================================================

export const UpdateAdminUserSchema = z
  .object({
    fullName: z.string().min(2).max(255).optional(),
    department: z.string().max(128).nullable().optional(),
    employeeCode: z.string().max(64).nullable().optional(),
  })
  .strict();

export class UpdateAdminUserDto extends createZodDto(UpdateAdminUserSchema) {}

// =====================================================================
//  Set roles — PUT /admin/users/:id/roles
// =====================================================================

export const SetUserRolesSchema = z
  .object({
    /**
     * Liste cible. Le service calcule add/remove par diff avec l'état
     * courant ET garantit qu'on ne retire pas le dernier SUPER_ADMIN.
     */
    roles: z.array(RoleSchema).min(1).max(ROLES.length),
  })
  .strict();

export class SetUserRolesDto extends createZodDto(SetUserRolesSchema) {}

// =====================================================================
//  Response DTOs — Swagger
// =====================================================================

export class AdminUserResponseDto {
  @ApiProperty({ format: 'uuid', description: 'UUID AppUser (= Keycloak sub côté JWT).' })
  id!: string;

  @ApiProperty({ example: 'demandeur@pasteur.sn' })
  email!: string;

  @ApiProperty({ example: 'Aïssatou DIALLO' })
  fullName!: string;

  @ApiProperty({ required: false, nullable: true })
  department!: string | null;

  @ApiProperty({ required: false, nullable: true })
  employeeCode!: string | null;

  @ApiProperty({ enum: USER_API_STATUSES, example: 'active' })
  status!: UserApiStatus;

  @ApiProperty({ description: 'Le compte est-il enabled côté Keycloak ?' })
  enabled!: boolean;

  @ApiProperty({ type: [String], example: ['DAF'] })
  roles!: string[];

  @ApiProperty()
  mfaEnabled!: boolean;

  @ApiProperty({ format: 'date-time', required: false, nullable: true })
  lastLoginAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminUserListResponseDto {
  @ApiProperty({ type: [AdminUserResponseDto] })
  data!: AdminUserResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  hasMore!: boolean;
}

export class CreateAdminUserResponseDto extends AdminUserResponseDto {
  @ApiProperty({
    description:
      "Un e-mail d'invitation a été envoyé (UPDATE_PASSWORD via Keycloak). Champ informatif.",
  })
  invitationEmailSent!: boolean;
}
