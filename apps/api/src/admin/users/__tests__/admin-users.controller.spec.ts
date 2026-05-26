/**
 * Sprint F-ADMIN-USERS Lot B — tests RBAC + délégation contrôleur.
 *
 * On vérifie deux choses :
 *   1. La métadata @Roles posée au niveau de la classe (SUPER_ADMIN, DAF)
 *      est bien attachée — c'est CE que lit le RolesGuard global.
 *      Sans ça, n'importe quel user authentifié aurait accès aux endpoints
 *      admin (régression de sécurité critique).
 *   2. Les handlers délèguent au service avec les bons arguments
 *      (ParseUUIDPipe est géré par Nest, on teste la délégation métier).
 */

import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../../auth/decorators/roles.decorator';
import { AdminUsersController } from '../admin-users.controller';
import type { AdminUsersService } from '../admin-users.service';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';

describe('AdminUsersController', () => {
  // ---------------- RBAC ----------------

  describe('RBAC metadata (@Roles class-level)', () => {
    it('expose @Roles("SUPER_ADMIN", "DAF") au niveau classe', () => {
      const reflector = new Reflector();
      const roles = reflector.get<string[]>(ROLES_KEY, AdminUsersController);
      expect(roles).toEqual(['SUPER_ADMIN', 'DAF']);
    });

    it("aucun rôle 'COMPTABLE' n'est autorisé (sinon écart RBAC)", () => {
      const reflector = new Reflector();
      const roles = reflector.get<string[]>(ROLES_KEY, AdminUsersController);
      expect(roles).not.toContain('COMPTABLE');
      expect(roles).not.toContain('BAILLEUR');
      expect(roles).not.toContain('DEMANDEUR');
    });
  });

  // ---------------- Délégation ----------------

  describe('handlers delegate to service', () => {
    let svc: jest.Mocked<AdminUsersService>;
    let ctrl: AdminUsersController;

    beforeEach(() => {
      svc = {
        findMany: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        setRoles: jest.fn(),
        deactivate: jest.fn(),
        activate: jest.fn(),
        resetPassword: jest.fn(),
      } as unknown as jest.Mocked<AdminUsersService>;
      ctrl = new AdminUsersController(svc);
    });

    it('list → svc.findMany(query)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = { page: 1, pageSize: 20 } as any;
      ctrl.list(q);
      expect(svc.findMany).toHaveBeenCalledWith(q);
    });

    it('findOne → svc.findOne(id)', () => {
      ctrl.findOne('uuid-1');
      expect(svc.findOne).toHaveBeenCalledWith('uuid-1');
    });

    it('create → svc.create(dto)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dto = { email: 'x@y.z', fullName: 'X Y', roles: ['DAF'] } as any;
      ctrl.create(dto);
      expect(svc.create).toHaveBeenCalledWith(dto);
    });

    it('update → svc.update(id, dto)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctrl.update('uuid-1', { fullName: 'New' } as any);
      expect(svc.update).toHaveBeenCalledWith('uuid-1', { fullName: 'New' });
    });

    it('setRoles → svc.setRoles(id, dto)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctrl.setRoles('uuid-1', { roles: ['DAF', 'COMPTABLE'] } as any);
      expect(svc.setRoles).toHaveBeenCalledWith('uuid-1', { roles: ['DAF', 'COMPTABLE'] });
    });

    it("deactivate → svc.deactivate(id, actor.email) — HOTFIX : comparaison sur e-mail (citext UNIQUE) car AppUser.id ≠ Keycloak.sub pour les comptes seedés", () => {
      const actor: AuthenticatedUser = {
        id: 'actor-uuid',
        email: 'admin@pasteur.sn',
        fullName: 'Admin IPD',
        roles: ['SUPER_ADMIN'],
      };
      ctrl.deactivate('target-uuid', actor);
      expect(svc.deactivate).toHaveBeenCalledWith('target-uuid', 'admin@pasteur.sn');
      // Garde-fou anti-régression : l'id JWT (= Keycloak.sub) NE doit pas
      // être passé au service — il ne corrige pas le faux positif anti-self
      // pour les comptes seedés (AppUser.id ≠ sub).
      expect(svc.deactivate).not.toHaveBeenCalledWith('target-uuid', 'actor-uuid');
    });

    it('activate → svc.activate(id)', () => {
      ctrl.activate('uuid-1');
      expect(svc.activate).toHaveBeenCalledWith('uuid-1');
    });

    it('resetPassword → svc.resetPassword(id)', async () => {
      svc.resetPassword.mockResolvedValueOnce(undefined);
      await ctrl.resetPassword('uuid-1');
      expect(svc.resetPassword).toHaveBeenCalledWith('uuid-1');
    });
  });
});
