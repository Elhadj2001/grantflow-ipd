/**
 * Sprint F-ADMIN-USERS Lot B — tests intégration AdminUsersService.
 *
 * On mock PrismaService + KeycloakAdminService pour vérifier la logique
 * métier (orchestration KC↔DB, garde anti-lock-out, garde anti-self-deactivate,
 * sync rôles diff add/remove). Pas de vraie DB ni de vrai Keycloak.
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
        fakeUserRow({ roles: ['DAF', 'COMPTABLE'] }),
      );
      prisma.role.findMany.mockResolvedValueOnce([
        { id: 'r-cg', code: 'CONTROLEUR' },
        { id: 'r-compta', code: 'COMPTABLE' },
      ]); // resolve IDs add+remove
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ roles: ['DAF', 'CONTROLEUR'] }),
      ); // findOne final

      await svc.setRoles('user-uuid-1', { roles: ['DAF', 'CONTROLEUR'] });

      // toRemove=[COMPTABLE], toAdd=[CONTROLEUR]
      expect(keycloak.removeRealmRoles).toHaveBeenCalledWith('user-uuid-1', ['COMPTABLE']);
      expect(keycloak.assignRealmRoles).toHaveBeenCalledWith('user-uuid-1', ['CONTROLEUR']);
    });

    it('no-op si l\'ensemble est identique (aucun appel Keycloak diff)', async () => {
      prisma.role.findMany.mockResolvedValueOnce([
        { id: 'r-daf', code: 'DAF' },
      ]);
      prisma.appUser.findUnique.mockResolvedValueOnce(fakeUserRow({ roles: ['DAF'] }));
      prisma.appUser.findUnique.mockResolvedValueOnce(fakeUserRow({ roles: ['DAF'] })); // findOne final
      await svc.setRoles('user-uuid-1', { roles: ['DAF'] });
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
        fakeUserRow({ roles: ['SUPER_ADMIN'] }),
      );
      prisma.appUser.count.mockResolvedValueOnce(2); // 2 autres SA
      prisma.role.findMany.mockResolvedValueOnce([
        { id: 'r-daf', code: 'DAF' },
        { id: 'r-sa', code: 'SUPER_ADMIN' },
      ]);
      prisma.appUser.findUnique.mockResolvedValueOnce(fakeUserRow({ roles: ['DAF'] }));
      await svc.setRoles('user-uuid-1', { roles: ['DAF'] });
      expect(keycloak.removeRealmRoles).toHaveBeenCalledWith('user-uuid-1', ['SUPER_ADMIN']);
    });
  });

  // -----------------------------------------------------------------
  //  deactivate / activate
  // -----------------------------------------------------------------

  describe('deactivate', () => {
    it("refuse de se désactiver soi-même", async () => {
      await expect(svc.deactivate('me', 'me')).rejects.toBeInstanceOf(
        UserCannotDeactivateSelfException,
      );
      expect(keycloak.setUserEnabled).not.toHaveBeenCalled();
    });

    it('UserNotFound si AppUser inexistant', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce(null);
      await expect(svc.deactivate('ghost', 'admin')).rejects.toBeInstanceOf(
        UserNotFoundException,
      );
    });

    it('UserAlreadyInactive si statut suspended', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ status: 'suspended', roles: ['DAF'] }),
      );
      await expect(svc.deactivate('user-1', 'admin')).rejects.toBeInstanceOf(
        UserAlreadyInactiveException,
      );
    });

    it('refuse si la cible est le dernier SUPER_ADMIN actif', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ roles: ['SUPER_ADMIN'] }),
      );
      prisma.appUser.count.mockResolvedValueOnce(0); // pas d'autre SA
      await expect(svc.deactivate('user-1', 'admin')).rejects.toBeInstanceOf(
        UserCannotRemoveLastSuperAdminException,
      );
    });

    it('happy path : setEnabled(false) + AppUser.status=suspended', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce(fakeUserRow({ roles: ['DAF'] }));
      prisma.appUser.findUnique.mockResolvedValueOnce(
        fakeUserRow({ status: 'suspended', roles: ['DAF'] }),
      );
      prisma.appUser.update.mockResolvedValueOnce({});
      const out = await svc.deactivate('user-1', 'admin');
      expect(keycloak.setUserEnabled).toHaveBeenCalledWith('user-1', false);
      expect(prisma.appUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ status: 'suspended' }),
        }),
      );
      expect(out.status).toBe('inactive');
    });
  });

  describe('activate', () => {
    it('UserAlreadyActive si déjà actif', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce({ id: 'u', status: 'active' });
      await expect(svc.activate('u')).rejects.toBeInstanceOf(UserAlreadyActiveException);
    });

    it('happy path : setEnabled(true) + AppUser.status=active', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce({ id: 'u', status: 'suspended' });
      prisma.appUser.update.mockResolvedValueOnce({});
      prisma.appUser.findUnique.mockResolvedValueOnce(fakeUserRow({ id: 'u', roles: ['DAF'] }));
      await svc.activate('u');
      expect(keycloak.setUserEnabled).toHaveBeenCalledWith('u', true);
    });
  });

  // -----------------------------------------------------------------
  //  resetPassword
  // -----------------------------------------------------------------

  describe('resetPassword', () => {
    it('appelle sendResetPasswordEmail si user existe', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce({ id: 'u', email: 'x@y.z' });
      await svc.resetPassword('u');
      expect(keycloak.sendResetPasswordEmail).toHaveBeenCalledWith('u');
    });

    it('UserNotFound si AppUser inexistant', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce(null);
      await expect(svc.resetPassword('ghost')).rejects.toBeInstanceOf(UserNotFoundException);
      expect(keycloak.sendResetPasswordEmail).not.toHaveBeenCalled();
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
