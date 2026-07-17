/**
 * US-052 — endpoints REST des transitions Note Technique (ADR-006).
 *
 * Convention de spec contrôleur (cf. admin-users.controller.spec) :
 *   1. RBAC — on vérifie la métadata @Roles posée par méthode, car c'est CE
 *      que lit le RolesGuard global. Un user hors de ces listes obtiendra 403.
 *   2. Délégation — handlers appellent le service avec les bons arguments et
 *      relaient son retour (les exceptions métier remontent telles quelles).
 *   3. Validation Zod du corps de /reject (≥ 20 caractères → 400 via le
 *      ZodValidationPipe global) testée au niveau du schéma.
 */

import { Reflector } from '@nestjs/core';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { NoteTechniqueController } from './note-technique.controller';
import { NoteTechniqueService } from './note-technique.service';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { NoteTechniqueInvalidTransitionException } from '../../common/exceptions/business.exception';
import { RejectNoteTechniqueSchema } from './dto/reject-note-technique.dto';
import type { RejectNoteTechniqueDto } from './dto/reject-note-technique.dto';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

const ACTOR: AuthenticatedUser = {
  id: 'actor-1',
  email: 'go@ipd.sn',
  fullName: 'GO User',
  roles: ['CONTROLEUR'],
};

describe('NoteTechniqueController — transitions REST (US-052)', () => {
  let service: DeepMockProxy<NoteTechniqueService>;
  let ctrl: NoteTechniqueController;

  beforeEach(() => {
    service = mockDeep<NoteTechniqueService>();
    ctrl = new NoteTechniqueController(service);
  });

  it('Test 1 — POST :id/submit délègue à submitToDaf et relaie le retour', async () => {
    const nt = { id: 'nt-1', status: 'pending_daf' };
    service.submitToDaf.mockResolvedValue(nt as never);

    const res = await ctrl.submitToDaf('nt-1', ACTOR);

    expect(service.submitToDaf).toHaveBeenCalledWith('nt-1', ACTOR);
    expect(res).toBe(nt);
  });

  it('Test 2 — POST :id/submit propage InvalidTransition (409) du service', async () => {
    service.submitToDaf.mockRejectedValue(
      new NoteTechniqueInvalidTransitionException('nt-1', 'active', 'pending_daf'),
    );

    const err = await ctrl.submitToDaf('nt-1', ACTOR).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoteTechniqueInvalidTransitionException);
    expect((err as NoteTechniqueInvalidTransitionException).getStatus()).toBe(409);
  });

  it('Test 3 — POST :id/validate délègue à validateAsDaf (sans header → bypass undefined)', async () => {
    const nt = { id: 'nt-1', status: 'validated_daf' };
    service.validateAsDaf.mockResolvedValue(nt as never);

    const res = await ctrl.validateAsDaf('nt-1', ACTOR);

    expect(service.validateAsDaf).toHaveBeenCalledWith('nt-1', ACTOR, undefined);
    expect(res).toBe(nt);
  });

  it('Test 8 — POST :id/validate propage le header X-Bypass-SoD-Reason (US-053)', async () => {
    const nt = { id: 'nt-1', status: 'validated_daf' };
    service.validateAsDaf.mockResolvedValue(nt as never);
    const bypass = 'Break-glass : clôture bailleur urgente, unique valideur disponible.';

    const res = await ctrl.validateAsDaf('nt-1', ACTOR, bypass);

    expect(service.validateAsDaf).toHaveBeenCalledWith('nt-1', ACTOR, bypass);
    expect(res).toBe(nt);
  });

  it('Test 4 — /reject : corps invalide (reason < 20 chars) rejeté par Zod (→ 400)', () => {
    const tooShort = RejectNoteTechniqueSchema.safeParse({ reason: 'trop court' });
    expect(tooShort.success).toBe(false);

    const missing = RejectNoteTechniqueSchema.safeParse({});
    expect(missing.success).toBe(false);
  });

  it('Test 5 — POST :id/reject : corps valide délègue à rejectAsDaf(id, actor, reason)', async () => {
    const dto = {
      reason: 'Ligne équipement à revoir, montant trop élevé pour la convention.',
    } as RejectNoteTechniqueDto;
    expect(RejectNoteTechniqueSchema.safeParse(dto).success).toBe(true);
    const nt = { id: 'nt-1', status: 'draft' };
    service.rejectAsDaf.mockResolvedValue(nt as never);

    const res = await ctrl.rejectAsDaf('nt-1', dto, ACTOR);

    expect(service.rejectAsDaf).toHaveBeenCalledWith('nt-1', ACTOR, dto.reason);
    expect(res).toBe(nt);
  });

  it('Test 6 — POST :id/activate délègue à activate et relaie le retour', async () => {
    const nt = { id: 'nt-1', status: 'active' };
    service.activate.mockResolvedValue(nt as never);

    const res = await ctrl.activate('nt-1', ACTOR);

    expect(service.activate).toHaveBeenCalledWith('nt-1', ACTOR);
    expect(res).toBe(nt);
  });

  it('Test 7 — RBAC : @Roles par méthode (le RolesGuard renvoie 403 hors de ces rôles)', () => {
    const reflector = new Reflector();
    const get = (fn: unknown): string[] | undefined =>
      reflector.get<string[]>(ROLES_KEY, fn as () => unknown);

    expect(get(NoteTechniqueController.prototype.submitToDaf)).toEqual([
      'GO',
      'CONTROLEUR',
      'SUPER_ADMIN',
    ]);
    expect(get(NoteTechniqueController.prototype.validateAsDaf)).toEqual(['DAF', 'SUPER_ADMIN']);
    expect(get(NoteTechniqueController.prototype.rejectAsDaf)).toEqual(['DAF', 'SUPER_ADMIN']);
    expect(get(NoteTechniqueController.prototype.activate)).toEqual([
      'GO',
      'CONTROLEUR',
      'SUPER_ADMIN',
    ]);

    // Un DEMANDEUR / BAILLEUR n'est dans AUCUNE liste → 403 garanti par le guard.
    const submitRoles = get(NoteTechniqueController.prototype.submitToDaf) ?? [];
    expect(submitRoles).not.toContain('DEMANDEUR');
    expect(submitRoles).not.toContain('BAILLEUR');
    const validateRoles = get(NoteTechniqueController.prototype.validateAsDaf) ?? [];
    expect(validateRoles).not.toContain('CONTROLEUR'); // un CONTROLEUR ne peut pas s'auto-valider
  });

  // ------------------------------------------------------------------
  // US-065 — rôle GO dédié (ADR-006). Le RolesGuard lit ces métadatas :
  // les inclure/exclure PROUVE le 403 pour les cas interdits.
  // ------------------------------------------------------------------
  describe('US-065 — RBAC rôle GO', () => {
    const reflector = new Reflector();
    const get = (fn: unknown): string[] =>
      reflector.get<string[]>(ROLES_KEY, fn as () => unknown) ?? [];

    it('GO peut créer, éditer, lister et soumettre une NT', () => {
      expect(get(NoteTechniqueController.prototype.create)).toContain('GO');
      expect(get(NoteTechniqueController.prototype.update)).toContain('GO');
      expect(get(NoteTechniqueController.prototype.list)).toContain('GO');
      expect(get(NoteTechniqueController.prototype.findById)).toContain('GO');
      expect(get(NoteTechniqueController.prototype.submitToDaf)).toContain('GO');
      expect(get(NoteTechniqueController.prototype.activate)).toContain('GO');
    });

    it('GO ne peut PAS valider ni rejeter (validation = DAF, SoD ADR-009)', () => {
      expect(get(NoteTechniqueController.prototype.validateAsDaf)).not.toContain('GO');
      expect(get(NoteTechniqueController.prototype.rejectAsDaf)).not.toContain('GO');
    });

    it('un PI ne peut PAS créer de NT (absent de toutes les listes NT)', () => {
      expect(get(NoteTechniqueController.prototype.create)).not.toContain('PI');
      expect(get(NoteTechniqueController.prototype.update)).not.toContain('PI');
      expect(get(NoteTechniqueController.prototype.submitToDaf)).not.toContain('PI');
      expect(get(NoteTechniqueController.prototype.validateAsDaf)).not.toContain('PI');
      expect(get(NoteTechniqueController.prototype.activate)).not.toContain('PI');
    });
  });
});
