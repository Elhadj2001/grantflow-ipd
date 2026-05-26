/**
 * Sprint F-ADMIN-USERS Lot B — tests intégration AdminUsersService.
 *
 * On mock PrismaService + KeycloakAdminService pour vérifier la logique
 * métier (orchestration KC↔DB, garde anti-lock-out, garde anti-self-deactivate,
 * sync rôles diff add/remove). Pas de vraie DB ni de vrai Keycloak.
 *
 * HOTFIX résolution KC id : les comptes seedés ont AppUser.id ≠ Keycloak.sub.
 * On doit donc TOUJOURS résoudre l'id KC via findUserByEmail avant tout appel
 * Keycloak (sauf create). Les tests vérifient explicitement ce mapping.
 */

import { AdminUsersService } from '../admin-users.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { KeycloakAdminService } from '../../keycloak/keycloak-admin.service';
import {
  UserAlreadyActiveException,
  UserAlreadyInactiveException,
  UserCannotDeactivateSelfException,
  UserCannotRemoveLastSuperAdminException,
  UserEmailAlreadyExistsException,
  UserKeycloakAccountNotFoundException,
  UserNotFoundException,
  UserRoleUnknownException,
} from '../../../common/exceptions/business.exception';

type PrismaMock = {
  appUser: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  role: { findMany: jest.Mock };
  userRole: { deleteMany: jest.Mock; create: jest.Mock };
  $transaction: jest.Mock;
};

type KeycloakMock = {
  createUser: jest.Mock;
  setUserEnabled: jest.Mock;
  assignRealmRoles: jest.Mock;
  removeRealmRoles: jest.Mock;
  findUserByEmail: jest.Mock;
  sendResetPasswordEmail: jest.Mock;
  updateUserProfile: jest.Mock;
  getRealmRolesOfUser: jest.Mock;
  getUserById: jest.Mock;
};

/** Helper : réponse Keycloak findUserByEmail typée. */
function kcUser(overrides: Partial<{ id: string; email: string; enabled: boolean }> = {}) {
  return {
    id: overrides.id ?? 'kc-uuid-default',
    email: overrides.email ?? 'jane@pasteur.sn',
    username: overrides.email ?? 'jane@pasteur.sn',
    enabled: overrides.enabled ?? true,
  };
}

function makeMocks(): { prisma: PrismaMock; keycloak: KeycloakMock } {
  const prisma: PrismaMock = {
    appUser: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    role: { findMany: jest.fn() },
    userRole: { deleteMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  // Default transaction passthrough — accepte tableau ou callback
  prisma.$transaction.mockImplementation((arg) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
  );
  const keycloak: KeycloakMock = {
    createUser: jest.fn(),
    setUserEnabled: jest.fn().mockResolvedValue(undefined),
    assignRealmRoles: jest.fn().mockResolvedValue(undefined),
    removeRealmRoles: jest.fn().mockResolvedValue(undefined),
    // Par défaut renvoie null (= aucun KC trouvé) — chaque test qui a besoin
    // d'une résolution KC doit surcharger via mockResolvedValueOnce.
    findUserByEmail: jest.fn().mockResolvedValue(null),
    sendResetPasswordEmail: jest.fn().mockResolvedValue(undefined),
    updateUserProfile: jest.fn().mockResolvedValue(undefined),
    getRealmRolesOfUser: jest.fn().mockResolvedValue([]),
    getUserById: jest.fn(),
  };
  return { prisma, keycloak };
}

function fakeUserRow(overrides: Partial<{
  id: string;
  email: string;
  fullName: string;
  status: 'active' | 'suspended' | 'locked';
  roles: string[];
}> = {}) {
  const id = overrides.id ?? 'user-uuid-1';
  const roles = overrides.roles ?? ['DAF'];
  return {
    id,
    email: overrides.email ?? 'jane@pasteur.sn',
    fullName: overrides.fullName ?? 'Jane DIOP',
    department: null,
    employeeCode: null,
    status: overrides.status ?? 'active',
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    roles: roles.map((code) => ({ role: { code } })),
  };
}

describe('AdminUsersService', () => {
  let svc: AdminUsersService;
  let prisma: PrismaMock;
  let keycloak: KeycloakMock;

  beforeEach(() => {
    const m = makeMocks();
    prisma = m.prisma;
    keycloak = m.keycloak;
    svc = new AdminUsersService(
      prisma as unknown as PrismaService,
      keycloak as unknown as KeycloakAdminService,
    );
  });

  // -----------------------------------------------------------------
  //  create
  // -----------------------------------------------------------------

  describe('create', () => {
    it('orchestre KC → AppUser → assignRoles → reset-email et renvoie invitationEmailSent=true', async () => {
      prisma.role.findMany.mockResolvedValueOnce([
        { id: 'role-daf', code: 'DAF' },
      ]); // assertRolesKnown
      prisma.appUser.findUnique.mockResolvedValueOnce(null); // pré-check unicité
      keycloak.createUser.mockResolvedValueOnce('kc-uuid-new');
      prisma.role.findMany.mockResolvedValueOnce([
        { id: 'role-daf', code: 'DAF' },
      ]); // resolve role IDs avant insert AppUser
      prisma.appUser.create.mockResolvedValueOnce({});
      // findOne final
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ id: 'kc-uuid-new', email: 'new@pasteur.sn', roles: ['DAF'] }),
      );

      const out = await svc.create({
        email: 'new@pasteur.sn',
        fullName: 'New User',
        roles: ['DAF'],
      });

      expect(keycloak.createUser).toHaveBeenCalledWith({
        email: 'new@pasteur.sn',
        fullName: 'New User',
      });
      expect(prisma.appUser.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: 'kc-uuid-new',
            email: 'new@pasteur.sn',
            status: 'active',
          }),
        }),
      );
      // En create, l'id KC est connu directement (vient de createUser) — pas
      // de resolveKcId nécessaire.
      expect(keycloak.assignRealmRoles).toHaveBeenCalledWith('kc-uuid-new', ['DAF']);
      expect(keycloak.sendResetPasswordEmail).toHaveBeenCalledWith('kc-uuid-new');
      expect(out.invitationEmailSent).toBe(true);
      expect(out.email).toBe('new@pasteur.sn');
    });

    it('UserEmailAlreadyExists si AppUser existe déjà (pré-check)', async () => {
      prisma.role.findMany.mockResolvedValueOnce([{ id: 'role-daf', code: 'DAF' }]);
      prisma.appUser.findUnique.mockResolvedValueOnce({ id: 'x' }); // existe
      await expect(
        svc.create({ email: 'dup@pasteur.sn', fullName: 'Dup', roles: ['DAF'] }),
      ).rejects.toBeInstanceOf(UserEmailAlreadyExistsException);
      expect(keycloak.createUser).not.toHaveBeenCalled();
    });

    it('UserRoleUnknown si un rôle inconnu est demandé', async () => {
      prisma.role.findMany.mockResolvedValueOnce([{ id: 'role-daf', code: 'DAF' }]);
      await expect(
        svc.create({
          email: 'x@y.z',
          fullName: 'X',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          roles: ['DAF', 'NOT_A_ROLE' as any],
        }),
      ).rejects.toBeInstanceOf(UserRoleUnknownException);
    });

    it("compensation : si AppUser.create échoue après createUser, on désactive le KC user", async () => {
      prisma.role.findMany.mockResolvedValueOnce([{ id: 'role-daf', code: 'DAF' }]);
      prisma.appUser.findUnique.mockResolvedValueOnce(null);
      keycloak.createUser.mockResolvedValueOnce('kc-uuid-rollback');
      prisma.role.findMany.mockResolvedValueOnce([{ id: 'role-daf', code: 'DAF' }]);
      prisma.appUser.create.mockRejectedValueOnce(new Error('DB exploded'));

      await expect(
        svc.create({ email: 'x@y.z', fullName: 'X Y', roles: ['DAF'] }),
      ).rejects.toThrow('DB exploded');
      expect(keycloak.setUserEnabled).toHaveBeenCalledWith('kc-uuid-rollback', false);
    });

    it("invitationEmailSent=false si Keycloak n'envoie pas l'email (SMTP KO)", async () => {
      prisma.role.findMany.mockResolvedValueOnce([{ id: 'role-daf', code: 'DAF' }]);
      prisma.appUser.findUnique.mockResolvedValueOnce(null);
      keycloak.createUser.mockResolvedValueOnce('kc-uuid');
      prisma.role.findMany.mockResolvedValueOnce([{ id: 'role-daf', code: 'DAF' }]);
      prisma.appUser.create.mockResolvedValueOnce({});
      keycloak.sendResetPasswordEmail.mockRejectedValueOnce(new Error('SMTP down'));
      prisma.appUser.findUnique.mockResolvedValueOnce(fakeUserRow({ id: 'kc-uuid' }));

      const out = await svc.create({ email: 'x@y.z', fullName: 'X Y', roles: ['DAF'] });
      expect(out.invitationEmailSent).toBe(false);
    });
  });

  // -----------------------------------------------------------------
  //  setRoles
  // -----------------------------------------------------------------

  describe('setRoles', () => {
    it('calcule add/remove correctement (cur=[DAF,COMPTABLE], target=[DAF,CONTROLEUR])', async () => {
      prisma.role.findMany.mockResolvedValueOnce([
        { id: 'r-daf', code: 'DAF' },
        { id: 'r-cg', code: 'CONTROLEUR' },
      ]); // assertRolesKnown
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ id: 'app-1', email: 'jane@pasteur.sn', roles: ['DAF', 'COMPTABLE'] }),
      );
      // resolveKcId(jane@pasteur.sn) → kc-jane
      keycloak.findUserByEmail.mockResolvedValueOnce(
        kcUser({ id: 'kc-jane', email: 'jane@pasteur.sn' }),
      );
      prisma.role.findMany.mockResolvedValueOnce([
        { id: 'r-cg', code: 'CONTROLEUR' },
        { id: 'r-compta', code: 'COMPTABLE' },
      ]); // resolve IDs add+remove
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ id: 'app-1', email: 'jane@pasteur.sn', roles: ['DAF', 'CONTROLEUR'] }),
      ); // findOne final

      await svc.setRoles('app-1', { roles: ['DAF', 'CONTROLEUR'] });

      // toRemove=[COMPTABLE], toAdd=[CONTROLEUR] — passés avec l'id KC, pas l'AppUser.id
      expect(keycloak.removeRealmRoles).toHaveBeenCalledWith('kc-jane', ['COMPTABLE']);
      expect(keycloak.assignRealmRoles).toHaveBeenCalledWith('kc-jane', ['CONTROLEUR']);
      // L'AppUser.id NE doit PAS être passé directement à Keycloak
      expect(keycloak.removeRealmRoles).not.toHaveBeenCalledWith('app-1', expect.anything());
      expect(keycloak.assignRealmRoles).not.toHaveBeenCalledWith('app-1', expect.anything());
    });

    it('no-op si l\'ensemble est identique (aucune mutation Keycloak)', async () => {
      prisma.role.findMany.mockResolvedValueOnce([
        { id: 'r-daf', code: 'DAF' },
      ]);
      prisma.appUser.findUnique.mockResolvedValueOnce(fakeUserRow({ roles: ['DAF'] }));
      prisma.appUser.findUnique.mockResolvedValueOnce(fakeUserRow({ roles: ['DAF'] })); // findOne final
      await svc.setRoles('user-uuid-1', { roles: ['DAF'] });
      // L'essentiel : pas de mutation Keycloak. (findUserByEmail PEUT être
      // appelé par findOne final pour le merge enabled — best-effort.)
      expect(keycloak.assignRealmRoles).not.toHaveBeenCalled();
      expect(keycloak.removeRealmRoles).not.toHaveBeenCalled();
    });

    it('refuse de retirer le dernier SUPER_ADMIN', async () => {
      prisma.role.findMany.mockResolvedValueOnce([
        { id: 'r-daf', code: 'DAF' },
      ]);
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ roles: ['SUPER_ADMIN'] }),
      );
      // assertNotLastSuperAdmin → count autres SUPER_ADMIN actifs = 0
      prisma.appUser.count.mockResolvedValueOnce(0);
      await expect(
        svc.setRoles('user-uuid-1', { roles: ['DAF'] }),
      ).rejects.toBeInstanceOf(UserCannotRemoveLastSuperAdminException);
      expect(keycloak.removeRealmRoles).not.toHaveBeenCalled();
    });

    it("autorise le retrait de SUPER_ADMIN si d'autres SUPER_ADMIN actifs existent", async () => {
      prisma.role.findMany.mockResolvedValueOnce([
        { id: 'r-daf', code: 'DAF' },
      ]);
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ id: 'app-1', email: 'jane@pasteur.sn', roles: ['SUPER_ADMIN'] }),
      );
      prisma.appUser.count.mockResolvedValueOnce(2); // 2 autres SA
      keycloak.findUserByEmail.mockResolvedValueOnce(
        kcUser({ id: 'kc-jane', email: 'jane@pasteur.sn' }),
      );
      prisma.role.findMany.mockResolvedValueOnce([
        { id: 'r-daf', code: 'DAF' },
        { id: 'r-sa', code: 'SUPER_ADMIN' },
      ]);
      prisma.appUser.findUnique.mockResolvedValueOnce(fakeUserRow({ roles: ['DAF'] }));
      await svc.setRoles('app-1', { roles: ['DAF'] });
      expect(keycloak.removeRealmRoles).toHaveBeenCalledWith('kc-jane', ['SUPER_ADMIN']);
    });

    it("UserKeycloakAccountNotFound si findUserByEmail renvoie null (drift de données)", async () => {
      prisma.role.findMany.mockResolvedValueOnce([{ id: 'r-daf', code: 'DAF' }]);
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ id: 'app-orphan', email: 'orphan@pasteur.sn', roles: ['COMPTABLE'] }),
      );
      // findUserByEmail renvoie null par défaut (= compte AppUser orphelin)
      await expect(
        svc.setRoles('app-orphan', { roles: ['DAF'] }),
      ).rejects.toBeInstanceOf(UserKeycloakAccountNotFoundException);
      expect(keycloak.assignRealmRoles).not.toHaveBeenCalled();
      expect(keycloak.removeRealmRoles).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  //  deactivate / activate
  // -----------------------------------------------------------------

  describe('deactivate', () => {
    it("refuse de se désactiver soi-même (comparaison sur l'e-mail, case-insensitive)", async () => {
      // Cas seedé : AppUser.id ≠ Keycloak.sub. Seul l'e-mail prouve l'identité.
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({
          id: 'app-uuid-prisma',
          email: 'DAF@pasteur.sn', // citext insensitive
          roles: ['DAF'],
        }),
      );
      await expect(
        svc.deactivate('app-uuid-prisma', 'daf@PASTEUR.SN'),
      ).rejects.toBeInstanceOf(UserCannotDeactivateSelfException);
      expect(keycloak.setUserEnabled).not.toHaveBeenCalled();
    });

    it('UserNotFound si AppUser inexistant', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce(null);
      await expect(
        svc.deactivate('ghost', 'admin@pasteur.sn'),
      ).rejects.toBeInstanceOf(UserNotFoundException);
    });

    it('UserAlreadyInactive si statut suspended', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({
          id: 'app-1',
          email: 'jane@pasteur.sn',
          status: 'suspended',
          roles: ['DAF'],
        }),
      );
      await expect(
        svc.deactivate('app-1', 'admin@pasteur.sn'),
      ).rejects.toBeInstanceOf(UserAlreadyInactiveException);
    });

    it('refuse si la cible est le dernier SUPER_ADMIN actif', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({
          id: 'app-1',
          email: 'jane@pasteur.sn',
          roles: ['SUPER_ADMIN'],
        }),
      );
      prisma.appUser.count.mockResolvedValueOnce(0); // pas d'autre SA
      await expect(
        svc.deactivate('app-1', 'admin@pasteur.sn'),
      ).rejects.toBeInstanceOf(UserCannotRemoveLastSuperAdminException);
    });

    it("happy path : setUserEnabled(kcId, false) avec l'id KC résolu par e-mail", async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ id: 'app-1', email: 'jane@pasteur.sn', roles: ['DAF'] }),
      );
      // resolveKcId
      keycloak.findUserByEmail.mockResolvedValueOnce(
        kcUser({ id: 'kc-jane', email: 'jane@pasteur.sn' }),
      );
      prisma.appUser.update.mockResolvedValueOnce({});
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({
          id: 'app-1',
          email: 'jane@pasteur.sn',
          status: 'suspended',
          roles: ['DAF'],
        }),
      );

      const out = await svc.deactivate('app-1', 'admin@pasteur.sn');

      expect(keycloak.setUserEnabled).toHaveBeenCalledWith('kc-jane', false);
      // L'AppUser.id NE doit PAS être passé à Keycloak
      expect(keycloak.setUserEnabled).not.toHaveBeenCalledWith('app-1', expect.anything());
      expect(prisma.appUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'app-1' },
          data: expect.objectContaining({ status: 'suspended' }),
        }),
      );
      expect(out.status).toBe('inactive');
    });

    it("UserKeycloakAccountNotFound si AppUser présent mais pas de compte KC pour l'e-mail", async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ id: 'app-1', email: 'orphan@pasteur.sn', roles: ['DAF'] }),
      );
      // findUserByEmail → null (compte KC purgé manuellement)
      await expect(
        svc.deactivate('app-1', 'admin@pasteur.sn'),
      ).rejects.toBeInstanceOf(UserKeycloakAccountNotFoundException);
      expect(keycloak.setUserEnabled).not.toHaveBeenCalled();
      expect(prisma.appUser.update).not.toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    it('UserAlreadyActive si déjà actif', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce({
        id: 'u',
        email: 'j@pasteur.sn',
        status: 'active',
      });
      await expect(svc.activate('u')).rejects.toBeInstanceOf(UserAlreadyActiveException);
    });

    it("happy path : setUserEnabled(kcId, true) avec l'id KC résolu", async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce({
        id: 'app-1',
        email: 'jane@pasteur.sn',
        status: 'suspended',
      });
      keycloak.findUserByEmail.mockResolvedValueOnce(
        kcUser({ id: 'kc-jane', email: 'jane@pasteur.sn' }),
      );
      prisma.appUser.update.mockResolvedValueOnce({});
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ id: 'app-1', email: 'jane@pasteur.sn', roles: ['DAF'] }),
      );
      await svc.activate('app-1');
      expect(keycloak.setUserEnabled).toHaveBeenCalledWith('kc-jane', true);
    });
  });

  // -----------------------------------------------------------------
  //  resetPassword
  // -----------------------------------------------------------------

  describe('resetPassword', () => {
    it("résout l'id KC par e-mail puis appelle sendResetPasswordEmail(kcId)", async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce({
        id: 'app-uuid-prisma',
        email: 'jane@pasteur.sn',
      });
      keycloak.findUserByEmail.mockResolvedValueOnce(
        kcUser({ id: 'kc-jane', email: 'jane@pasteur.sn' }),
      );
      await svc.resetPassword('app-uuid-prisma');
      expect(keycloak.sendResetPasswordEmail).toHaveBeenCalledWith('kc-jane');
      // L'AppUser.id NE doit PAS être passé directement à Keycloak
      expect(keycloak.sendResetPasswordEmail).not.toHaveBeenCalledWith('app-uuid-prisma');
    });

    it('UserNotFound si AppUser inexistant', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce(null);
      await expect(svc.resetPassword('ghost')).rejects.toBeInstanceOf(UserNotFoundException);
      expect(keycloak.sendResetPasswordEmail).not.toHaveBeenCalled();
    });

    it("UserKeycloakAccountNotFound si l'e-mail ne matche aucun compte KC", async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce({
        id: 'app-1',
        email: 'orphan@pasteur.sn',
      });
      // findUserByEmail renvoie null par défaut
      await expect(svc.resetPassword('app-1')).rejects.toBeInstanceOf(
        UserKeycloakAccountNotFoundException,
      );
      expect(keycloak.sendResetPasswordEmail).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  //  update profile
  // -----------------------------------------------------------------

  describe('update', () => {
    it("sync Keycloak utilise l'id KC résolu (AppUser.id ≠ KC.sub)", async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce({
        id: 'app-1',
        email: 'jane@pasteur.sn',
        fullName: 'Jane DIOP',
      });
      prisma.appUser.update.mockResolvedValueOnce({});
      keycloak.findUserByEmail.mockResolvedValueOnce(
        kcUser({ id: 'kc-jane', email: 'jane@pasteur.sn' }),
      );
      // findOne final (utilise aussi findUserByEmail mais best-effort, on
      // peut le laisser fallback en null)
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ id: 'app-1', email: 'jane@pasteur.sn', fullName: 'Jane DIOP-NDIAYE' }),
      );

      await svc.update('app-1', { fullName: 'Jane DIOP-NDIAYE' });
      expect(keycloak.updateUserProfile).toHaveBeenCalledWith('kc-jane', {
        fullName: 'Jane DIOP-NDIAYE',
      });
      expect(keycloak.updateUserProfile).not.toHaveBeenCalledWith('app-1', expect.anything());
    });
  });

  // -----------------------------------------------------------------
  //  Cas spécifique : utilisateur seedé (AppUser.id ≠ Keycloak.sub)
  // -----------------------------------------------------------------

  describe('comptes seedés — AppUser.id ≠ Keycloak.sub', () => {
    it("deactivate d'un compte seedé n'utilise PAS AppUser.id côté Keycloak", async () => {
      // Cas réel : 'admin@pasteur.sn' seedé. AppUser.id = uuid Prisma (ex.
      // 'app-prisma-uuid-9999'), Keycloak.sub = uuid généré à l'import realm.json
      // (ex. 'kc-import-uuid-aaaa'). Sans le hotfix, le 502 IDP est garanti.
      const APP_USER_ID = 'app-prisma-uuid-9999';
      const KC_SUB = 'kc-import-uuid-aaaa';
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ id: APP_USER_ID, email: 'admin@pasteur.sn', roles: ['SUPER_ADMIN'] }),
      );
      prisma.appUser.count.mockResolvedValueOnce(1); // 1 autre SA → autorise
      keycloak.findUserByEmail.mockResolvedValueOnce(
        kcUser({ id: KC_SUB, email: 'admin@pasteur.sn' }),
      );
      prisma.appUser.update.mockResolvedValueOnce({});
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({
          id: APP_USER_ID,
          email: 'admin@pasteur.sn',
          status: 'suspended',
          roles: ['SUPER_ADMIN'],
        }),
      );

      // L'actor (= daf@pasteur.sn) est différent de la cible (admin@pasteur.sn)
      await svc.deactivate(APP_USER_ID, 'daf@pasteur.sn');

      expect(keycloak.setUserEnabled).toHaveBeenCalledWith(KC_SUB, false);
      expect(keycloak.setUserEnabled).not.toHaveBeenCalledWith(APP_USER_ID, false);
      expect(keycloak.findUserByEmail).toHaveBeenCalledWith('admin@pasteur.sn');
    });

    it('anti-self sur compte seedé : DAF ne peut pas se désactiver malgré id ≠ sub', async () => {
      // daf@pasteur.sn (seedé) tente de se désactiver depuis l'écran.
      // L'actor.id du JWT = sub Keycloak ; AppUser.id ≠ sub. La comparaison
      // sur l'id était cassée — la comparaison sur l'e-mail bloque correctement.
      const APP_USER_ID = 'app-prisma-uuid-daf';
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({
          id: APP_USER_ID,
          email: 'daf@pasteur.sn',
          roles: ['DAF'],
        }),
      );
      await expect(
        svc.deactivate(APP_USER_ID, 'daf@pasteur.sn'),
      ).rejects.toBeInstanceOf(UserCannotDeactivateSelfException);
      expect(keycloak.setUserEnabled).not.toHaveBeenCalled();
      // resolveKcId n'est même pas appelée (échec avant)
      expect(keycloak.findUserByEmail).not.toHaveBeenCalled();
    });

    it("setRoles sur compte seedé : passe l'id KC résolu, pas l'AppUser.id", async () => {
      const APP_USER_ID = 'app-prisma-uuid-compta';
      const KC_SUB = 'kc-import-uuid-compta';
      prisma.role.findMany.mockResolvedValueOnce([
        { id: 'r-compta', code: 'COMPTABLE' },
        { id: 'r-cg', code: 'CONTROLEUR' },
      ]);
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({
          id: APP_USER_ID,
          email: 'compta@pasteur.sn',
          roles: ['COMPTABLE'],
        }),
      );
      keycloak.findUserByEmail.mockResolvedValueOnce(
        kcUser({ id: KC_SUB, email: 'compta@pasteur.sn' }),
      );
      prisma.role.findMany.mockResolvedValueOnce([{ id: 'r-cg', code: 'CONTROLEUR' }]);
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({
          id: APP_USER_ID,
          email: 'compta@pasteur.sn',
          roles: ['COMPTABLE', 'CONTROLEUR'],
        }),
      );

      await svc.setRoles(APP_USER_ID, { roles: ['COMPTABLE', 'CONTROLEUR'] });
      // Add CONTROLEUR avec le KC_SUB, pas l'AppUser.id
      expect(keycloak.assignRealmRoles).toHaveBeenCalledWith(KC_SUB, ['CONTROLEUR']);
      expect(keycloak.assignRealmRoles).not.toHaveBeenCalledWith(
        APP_USER_ID,
        expect.anything(),
      );
    });

    it("resetPassword sur compte seedé : passe l'id KC résolu, pas l'AppUser.id", async () => {
      const APP_USER_ID = 'app-prisma-uuid-bailleur';
      const KC_SUB = 'kc-import-uuid-bailleur';
      prisma.appUser.findUnique.mockResolvedValueOnce({
        id: APP_USER_ID,
        email: 'bailleur@pasteur.sn',
      });
      keycloak.findUserByEmail.mockResolvedValueOnce(
        kcUser({ id: KC_SUB, email: 'bailleur@pasteur.sn' }),
      );

      await svc.resetPassword(APP_USER_ID);
      expect(keycloak.sendResetPasswordEmail).toHaveBeenCalledWith(KC_SUB);
      expect(keycloak.sendResetPasswordEmail).not.toHaveBeenCalledWith(APP_USER_ID);
    });
  });

  // -----------------------------------------------------------------
  //  findMany merge
  // -----------------------------------------------------------------

  describe('findMany', () => {
    it('merge enabled depuis Keycloak (best-effort, fallback sur status)', async () => {
      prisma.appUser.findMany.mockResolvedValueOnce([
        fakeUserRow({ id: 'u1', email: 'a@x.com', roles: ['DAF'] }),
        fakeUserRow({ id: 'u2', email: 'b@x.com', status: 'suspended', roles: ['COMPTABLE'] }),
      ]);
      prisma.appUser.count.mockResolvedValueOnce(2);
      keycloak.findUserByEmail
        .mockResolvedValueOnce({ id: 'kc1', enabled: true, username: 'a@x.com', email: 'a@x.com' })
        .mockResolvedValueOnce({ id: 'kc2', enabled: false, username: 'b@x.com', email: 'b@x.com' });

      const out = await svc.findMany({
        page: 1,
        pageSize: 20,
        sort: 'email',
        order: 'asc',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      expect(out.total).toBe(2);
      expect(out.data[0]?.enabled).toBe(true);
      expect(out.data[1]?.enabled).toBe(false);
      expect(out.data[1]?.status).toBe('inactive');
    });
  });
});
