import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KeycloakAdminService } from '../keycloak/keycloak-admin.service';
import { ROLES, type Role } from '../../auth/types/roles';
import {
  UserAlreadyActiveException,
  UserAlreadyInactiveException,
  UserCannotDeactivateSelfException,
  UserCannotRemoveLastSuperAdminException,
  UserEmailAlreadyExistsException,
  UserKeycloakAccountNotFoundException,
  UserNotFoundException,
  UserRoleUnknownException,
} from '../../common/exceptions/business.exception';
import type {
  CreateAdminUserDto,
  ListAdminUsersQueryDto,
  SetUserRolesDto,
  UpdateAdminUserDto,
  UserApiStatus,
} from './dto/admin-user.dto';

/**
 * Forme normalisée pour le payload de réponse.
 * UserStatus.suspended (DB) ⇒ 'inactive' (API). 'locked' n'est pas pris
 * en charge côté admin (c'est un cas brute-force Keycloak — interdit de
 * "réactiver" sans passer par /auth Keycloak admin manuel).
 */
function dbStatusToApiStatus(status: 'active' | 'suspended' | 'locked'): UserApiStatus {
  return status === 'active' ? 'active' : 'inactive';
}

/** Mappe un AppUser + roles + Keycloak enabled vers le DTO de réponse. */
function toAdminUserDto(
  user: {
    id: string;
    email: string;
    fullName: string;
    department: string | null;
    employeeCode: string | null;
    status: 'active' | 'suspended' | 'locked';
    mfaEnabled: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    roles: Array<{ role: { code: string } }>;
  },
  kcEnabled: boolean,
): {
  id: string;
  email: string;
  fullName: string;
  department: string | null;
  employeeCode: string | null;
  status: UserApiStatus;
  enabled: boolean;
  roles: string[];
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
} {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    department: user.department,
    employeeCode: user.employeeCode,
    status: dbStatusToApiStatus(user.status),
    enabled: kcEnabled,
    roles: user.roles.map((r) => r.role.code),
    mfaEnabled: user.mfaEnabled,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Service métier des utilisateurs administrateurs.
 *
 * Architecture HYBRIDE (cf. brief F-ADMIN-USERS) :
 *   - Keycloak  = source de vérité des credentials + du `enabled` runtime
 *   - AppUser   = miroir du profil (e-mail, fullName, dept, employeeCode, statut)
 *   - UserRole  = miroir des realm roles (cohérence applicative + audit)
 *
 * Les rôles "qui comptent" pour le RBAC sont ceux du JWT Keycloak ; cette
 * table sert UNIQUEMENT à afficher / filtrer / auditer côté application.
 * On garde les deux strictement synchronisés.
 *
 * HOTFIX résolution KC id : pour les utilisateurs créés via l'écran on a
 * `AppUser.id == Keycloak.sub` (cf. `create()`), mais pour les 11 users
 * seedés via realm.json, l'id Keycloak est généré par l'import et ≠ de
 * l'AppUser.id (uuid Prisma). On ne peut donc PLUS passer `userId` aux
 * appels Keycloak — il faut toujours résoudre via `findUserByEmail`.
 * Cf. `resolveKcId()` ci-dessous, utilisé par update/setRoles/
 * deactivate/activate/resetPassword.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloak: KeycloakAdminService,
  ) {}

  // ------------------------------------------------------------------
  //  Read
  // ------------------------------------------------------------------

  async findMany(query: ListAdminUsersQueryDto): Promise<{
    data: ReturnType<typeof toAdminUserDto>[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  }> {
    const where: Prisma.AppUserWhereInput = {};

    if (query.q) {
      where.OR = [
        { email: { contains: query.q, mode: 'insensitive' } },
        { fullName: { contains: query.q, mode: 'insensitive' } },
        { employeeCode: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.role) {
      where.roles = { some: { role: { code: query.role } } };
    }
    // status='active' / 'inactive' (= UserStatus.suspended côté DB).
    if (query.status === 'active') {
      where.status = 'active';
    } else if (query.status === 'inactive') {
      where.status = { in: ['suspended', 'locked'] };
    } else if (!query.includeInactive) {
      // Par défaut : on filtre les inactifs comme dans suppliers.
      where.status = 'active';
    }

    const skip = (query.page - 1) * query.pageSize;
    const orderBy: Prisma.AppUserOrderByWithRelationInput = { [query.sort]: query.order };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.appUser.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize,
        include: { roles: { include: { role: true } } },
      }),
      this.prisma.appUser.count({ where }),
    ]);

    // Merge avec le `enabled` Keycloak. On accepte un best-effort : si
    // Keycloak ne répond pas pour un user spécifique, on retombe sur le
    // statut applicatif. La liste reste utilisable.
    const data = await Promise.all(
      users.map(async (u) => {
        let kcEnabled = u.status === 'active';
        try {
          const kc = await this.keycloak.findUserByEmail(u.email);
          if (kc) kcEnabled = kc.enabled;
        } catch (e) {
          this.logger.warn(
            { userId: u.id, err: e instanceof Error ? e.message : 'unknown' },
            'keycloak findUserByEmail failed in list (using AppUser.status as fallback)',
          );
        }
        return toAdminUserDto(u, kcEnabled);
      }),
    );

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + users.length < total,
    };
  }

  async findOne(userId: string): Promise<ReturnType<typeof toAdminUserDto>> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new UserNotFoundException(userId);

    let kcEnabled = user.status === 'active';
    try {
      const kc = await this.keycloak.findUserByEmail(user.email);
      if (kc) kcEnabled = kc.enabled;
    } catch (e) {
      this.logger.warn(
        { userId, err: e instanceof Error ? e.message : 'unknown' },
        'keycloak findUserByEmail failed in findOne (using AppUser.status)',
      );
    }
    return toAdminUserDto(user, kcEnabled);
  }

  // ------------------------------------------------------------------
  //  Create
  // ------------------------------------------------------------------

  /**
   * 1) Crée le user dans Keycloak (sans password).
   * 2) Crée la ligne AppUser dans une transaction (incluant UserRole pour
   *    les rôles demandés — qui doivent tous exister dans `auth.role`).
   * 3) Assigne les realm roles côté Keycloak.
   * 4) Envoie l'e-mail UPDATE_PASSWORD.
   *
   * NOTE : on aligne `AppUser.id = kcUserId` pour les comptes créés via
   * l'écran (cohérence JWT.sub ↔ AppUser.id). Les opérations ultérieures
   * NE peuvent toutefois PAS supposer cet alignement (les users seedés
   * ont des id désalignés) — toujours passer par `resolveKcId(email)`.
   *
   * Compensation : si l'étape 2 ou 3 échoue après que Keycloak ait créé
   * le user, on désactive le compte Keycloak (`enabled=false`) plutôt
   * que de tenter un delete (les delete Keycloak sont irréversibles et
   * audit-sensibles ; le DAF pourra réactiver/purger manuellement).
   */
  async create(
    dto: CreateAdminUserDto,
  ): Promise<ReturnType<typeof toAdminUserDto> & { invitationEmailSent: boolean }> {
    // Validation amont des rôles
    await this.assertRolesKnown(dto.roles);

    // Pré-check d'unicité email côté AppUser — meilleure erreur que d'attendre
    // un 409 Prisma déguisé.
    const existing = await this.prisma.appUser.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new UserEmailAlreadyExistsException(dto.email);
    }

    // 1) Keycloak (lève UserEmailAlreadyExists si conflit côté KC)
    const kcUserId = await this.keycloak.createUser({
      email: dto.email,
      fullName: dto.fullName,
    });

    // 2) + 3) AppUser + UserRole, puis assignRealmRoles. Compensation si KO.
    try {
      const roleRefs = await this.prisma.role.findMany({
        where: { code: { in: dto.roles } },
        select: { id: true, code: true },
      });

      await this.prisma.appUser.create({
        data: {
          id: kcUserId, // align AppUser.id sur Keycloak sub (cohérent JWT)
          email: dto.email,
          fullName: dto.fullName,
          department: dto.department ?? null,
          employeeCode: dto.employeeCode ?? null,
          status: 'active',
          roles: { create: roleRefs.map((r) => ({ roleId: r.id })) },
        },
      });

      // On utilise kcUserId fraîchement obtenu — pas de resolveKcId nécessaire ici.
      await this.keycloak.assignRealmRoles(kcUserId, dto.roles);
    } catch (e) {
      this.logger.error(
        { err: e instanceof Error ? e.message : 'unknown', kcUserId },
        'AppUser/UserRole/role-mapping creation failed — compensating by disabling KC user',
      );
      // Compensation : on désactive le KC user pour ne pas laisser un
      // compte "fantôme" actif. Best-effort — si ça échoue aussi on
      // remonte l'erreur originale.
      try {
        await this.keycloak.setUserEnabled(kcUserId, false);
      } catch (compErr) {
        this.logger.error(
          { compErr: compErr instanceof Error ? compErr.message : 'unknown', kcUserId },
          'Compensation setUserEnabled(false) failed',
        );
      }
      throw e;
    }

    // 4) Invitation. Best-effort : si l'e-mail échoue (SMTP en panne), on
    // ne rollback PAS — le compte est créé, le DAF pourra cliquer
    // "Réinitialiser mot de passe" depuis l'UI.
    let invitationEmailSent = true;
    try {
      await this.keycloak.sendResetPasswordEmail(kcUserId);
    } catch (e) {
      invitationEmailSent = false;
      this.logger.warn(
        { err: e instanceof Error ? e.message : 'unknown', kcUserId },
        'sendResetPasswordEmail failed — user can re-trigger from UI',
      );
    }

    const created = await this.findOne(kcUserId);
    return { ...created, invitationEmailSent };
  }

  // ------------------------------------------------------------------
  //  Update profile (sans rôles)
  // ------------------------------------------------------------------

  async update(
    userId: string,
    dto: UpdateAdminUserDto,
  ): Promise<ReturnType<typeof toAdminUserDto>> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundException(userId);

    const update: Prisma.AppUserUpdateInput = {};
    if (dto.fullName !== undefined) update.fullName = dto.fullName;
    if (dto.department !== undefined) update.department = dto.department;
    if (dto.employeeCode !== undefined) update.employeeCode = dto.employeeCode;
    update.updatedAt = new Date();

    if (Object.keys(update).length > 1 /* updatedAt */) {
      await this.prisma.appUser.update({ where: { id: userId }, data: update });
    }

    // Sync fullName côté Keycloak si modifié (best-effort) — l'id KC doit
    // être résolu via l'e-mail (les comptes seedés ont AppUser.id ≠ KC.sub).
    if (dto.fullName) {
      try {
        const kcId = await this.resolveKcId(user.id, user.email);
        await this.keycloak.updateUserProfile(kcId, { fullName: dto.fullName });
      } catch (e) {
        this.logger.warn(
          { err: e instanceof Error ? e.message : 'unknown', userId },
          'keycloak updateUserProfile failed — AppUser was updated, Keycloak profile may be stale',
        );
      }
    }
    return this.findOne(userId);
  }

  // ------------------------------------------------------------------
  //  Set roles (PUT — remplace l'ensemble)
  // ------------------------------------------------------------------

  /**
   * Remplace l'ensemble des rôles d'un user. Calcule le diff (add/remove)
   * avec l'état courant et applique des deux côtés (Keycloak + UserRole)
   * dans une opération idempotente.
   *
   * Garde-fou anti-lock-out : refuse de retirer SUPER_ADMIN du dernier
   * compte actif qui le possède.
   *
   * NB : `userId` est l'AppUser.id (FK des UserRole). Pour les role-mappings
   * Keycloak on résout au préalable l'id KC via l'e-mail.
   */
  async setRoles(userId: string, dto: SetUserRolesDto): Promise<ReturnType<typeof toAdminUserDto>> {
    await this.assertRolesKnown(dto.roles);
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new UserNotFoundException(userId);

    const currentRoles = user.roles.map((r) => r.role.code as Role).sort();
    const targetRoles = [...dto.roles].sort();

    if (
      currentRoles.includes('SUPER_ADMIN') &&
      !targetRoles.includes('SUPER_ADMIN')
    ) {
      await this.assertNotLastSuperAdmin(userId);
    }

    const toAdd = targetRoles.filter((r) => !currentRoles.includes(r));
    const toRemove = currentRoles.filter((r) => !targetRoles.includes(r));

    if (toAdd.length === 0 && toRemove.length === 0) {
      return this.findOne(userId); // no-op
    }

    // 1) Keycloak diff — résolution de l'id KC par e-mail (lève
    //    UserKeycloakAccountNotFound si absent). On résout APRÈS le
    //    check no-op pour ne pas faire un appel inutile.
    const kcId = await this.resolveKcId(user.id, user.email);
    if (toRemove.length > 0) await this.keycloak.removeRealmRoles(kcId, toRemove);
    if (toAdd.length > 0) await this.keycloak.assignRealmRoles(kcId, toAdd);

    // 2) UserRole diff (transaction pour atomicité) — FK = AppUser.id
    const roleRefs = await this.prisma.role.findMany({
      where: { code: { in: [...toAdd, ...toRemove] } },
      select: { id: true, code: true },
    });
    const idByCode = new Map(roleRefs.map((r) => [r.code, r.id]));

    await this.prisma.$transaction([
      ...toRemove.map((code) =>
        this.prisma.userRole.deleteMany({
          where: { userId, roleId: idByCode.get(code) ?? '__missing__' },
        }),
      ),
      ...toAdd.map((code) =>
        this.prisma.userRole.create({
          data: { userId, roleId: idByCode.get(code) ?? '__missing__' },
        }),
      ),
    ]);

    return this.findOne(userId);
  }

  // ------------------------------------------------------------------
  //  Activate / Deactivate
  // ------------------------------------------------------------------

  /**
   * Désactive un compte. L'anti-self-deactivate compare sur l'EMAIL et
   * non sur l'id : sub Keycloak (= actor.id depuis le JWT) peut ne pas
   * correspondre à AppUser.id pour les comptes seedés. L'e-mail est la
   * clé naturelle citext-UNIQUE qui lie les deux mondes.
   *
   * @param userId      AppUser.id de la cible (param URL).
   * @param actorEmail  E-mail de l'utilisateur authentifié (depuis le JWT).
   */
  async deactivate(
    userId: string,
    actorEmail: string,
  ): Promise<ReturnType<typeof toAdminUserDto>> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new UserNotFoundException(userId);

    // Anti-self : citext en base, donc comparaison case-insensitive.
    if (user.email.toLowerCase() === actorEmail.toLowerCase()) {
      throw new UserCannotDeactivateSelfException(userId);
    }
    if (user.status === 'suspended') {
      throw new UserAlreadyInactiveException(userId);
    }

    const hasSuperAdmin = user.roles.some((r) => r.role.code === 'SUPER_ADMIN');
    if (hasSuperAdmin) await this.assertNotLastSuperAdmin(userId);

    // 1) Keycloak — disable d'abord (l'effet anti-login est immédiat).
    //    L'id KC est résolu via l'e-mail (gère les comptes seedés).
    const kcId = await this.resolveKcId(user.id, user.email);
    await this.keycloak.setUserEnabled(kcId, false);

    // 2) AppUser.status
    await this.prisma.appUser.update({
      where: { id: userId },
      data: { status: 'suspended', updatedAt: new Date() },
    });
    return this.findOne(userId);
  }

  async activate(userId: string): Promise<ReturnType<typeof toAdminUserDto>> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundException(userId);
    if (user.status === 'active') {
      throw new UserAlreadyActiveException(userId);
    }

    const kcId = await this.resolveKcId(user.id, user.email);
    await this.keycloak.setUserEnabled(kcId, true);
    await this.prisma.appUser.update({
      where: { id: userId },
      data: { status: 'active', updatedAt: new Date() },
    });
    return this.findOne(userId);
  }

  // ------------------------------------------------------------------
  //  Reset password (e-mail UPDATE_PASSWORD via Keycloak)
  // ------------------------------------------------------------------

  async resetPassword(userId: string): Promise<void> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundException(userId);
    const kcId = await this.resolveKcId(user.id, user.email);
    await this.keycloak.sendResetPasswordEmail(kcId);
  }

  // ------------------------------------------------------------------
  //  Helpers garde-fou
  // ------------------------------------------------------------------

  /** Vérifie que tous les codes de rôles existent dans `auth.role`. */
  private async assertRolesKnown(roles: string[]): Promise<void> {
    const knownInDb = await this.prisma.role.findMany({
      where: { code: { in: roles } },
      select: { code: true },
    });
    const knownSet = new Set(knownInDb.map((r) => r.code));
    const unknown = roles.filter((r) => !knownSet.has(r));
    // Filtre aussi sur la liste TS ROLES — défense en profondeur.
    const unknownInTs = roles.filter((r) => !(ROLES as readonly string[]).includes(r));
    const all = Array.from(new Set([...unknown, ...unknownInTs]));
    if (all.length > 0) throw new UserRoleUnknownException(all);
  }

  /**
   * Lève si l'utilisateur cible est le dernier SUPER_ADMIN actif. On
   * compte les autres comptes SUPER_ADMIN encore actifs — s'il n'en
   * reste aucun, on refuse l'opération.
   */
  private async assertNotLastSuperAdmin(userIdAboutToLose: string): Promise<void> {
    const otherAdmins = await this.prisma.appUser.count({
      where: {
        id: { not: userIdAboutToLose },
        status: 'active',
        roles: { some: { role: { code: 'SUPER_ADMIN' } } },
      },
    });
    if (otherAdmins === 0) {
      throw new UserCannotRemoveLastSuperAdminException(userIdAboutToLose);
    }
  }

  /**
   * Résout l'UUID Keycloak du user depuis son e-mail. Garantit que les
   * opérations Admin Keycloak passent toujours par l'id côté KC, jamais
   * par AppUser.id (qui peut diverger pour les comptes seedés).
   *
   * @throws UserKeycloakAccountNotFoundException si aucun compte KC ne
   *   correspond à l'e-mail (drift de données — admin doit recréer ou
   *   purger). 409 explicite plutôt qu'un 502 IDP opaque.
   *
   * @param appUserId  pour traçabilité logs uniquement (pas dans le payload).
   * @param email      e-mail AppUser, transmis directement à Keycloak.
   */
  private async resolveKcId(appUserId: string, email: string): Promise<string> {
    const kc = await this.keycloak.findUserByEmail(email);
    if (!kc) {
      // Log côté serveur (pas dans le payload — PII).
      this.logger.warn(
        { appUserId },
        'No Keycloak user matches AppUser email — data drift detected',
      );
      throw new UserKeycloakAccountNotFoundException(appUserId);
    }
    return kc.id;
  }
}
