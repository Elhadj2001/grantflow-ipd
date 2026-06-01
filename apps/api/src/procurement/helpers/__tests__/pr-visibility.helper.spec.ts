import { PrStatus, PrType } from '@prisma/client';
import { canActorViewPr, type PrVisibilityView } from '../pr-visibility.helper';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user.type';

describe('canActorViewPr', () => {
  // ------------------------------------------------------------------
  // Fixtures
  // ------------------------------------------------------------------
  const ownerId = 'usr00000-0000-0000-0000-000000000001';
  const otherUserId = 'usr00000-0000-0000-0000-000000000002';
  const piOwnerId = 'usr00000-0000-0000-0000-000000000003';
  const otherPiId = 'usr00000-0000-0000-0000-000000000004';

  const demandeurOwner: AuthenticatedUser = {
    id: ownerId, email: 'owner@x', fullName: 'Owner', roles: ['DEMANDEUR'],
  };
  const demandeurOther: AuthenticatedUser = {
    id: otherUserId, email: 'other@x', fullName: 'Other', roles: ['DEMANDEUR'],
  };
  const pi: AuthenticatedUser = {
    id: piOwnerId, email: 'pi@x', fullName: 'PI', roles: ['PI'],
  };
  const piForeign: AuthenticatedUser = {
    id: otherPiId, email: 'pi-other@x', fullName: 'PI Other', roles: ['PI'],
  };
  const controleur: AuthenticatedUser = {
    id: 'cg-1', email: 'cg@x', fullName: 'CG', roles: ['CONTROLEUR'],
  };
  const daf: AuthenticatedUser = {
    id: 'daf-1', email: 'daf@x', fullName: 'DAF', roles: ['DAF'],
  };
  const superAdmin: AuthenticatedUser = {
    id: 'sa-1', email: 'sa@x', fullName: 'SA', roles: ['SUPER_ADMIN'],
  };
  const caissier: AuthenticatedUser = {
    id: 'caissier-1', email: 'caissier@x', fullName: 'Caissier', roles: ['CAISSIER'],
  };
  const acheteur: AuthenticatedUser = {
    id: 'acheteur-1', email: 'acheteur@x', fullName: 'Acheteur', roles: ['ACHETEUR'],
  };

  function makePr(overrides: Partial<PrVisibilityView> = {}): PrVisibilityView {
    return {
      requestedBy: ownerId,
      status: PrStatus.pending_pi,
      requestType: PrType.standard,
      project: { piUserId: piOwnerId },
      ...overrides,
    };
  }

  // ------------------------------------------------------------------
  // PI scoping (project.piUserId)
  // ------------------------------------------------------------------
  describe('PI scoping', () => {
    it('PI assigned to the project sees the DA regardless of status', () => {
      const pr = makePr({ status: PrStatus.pending_pi });
      expect(canActorViewPr(pi, piOwnerId, pr)).toBe(true);
    });

    it('PI assigned still sees DA even after their approval step (e.g. approved)', () => {
      const pr = makePr({ status: PrStatus.approved });
      expect(canActorViewPr(pi, piOwnerId, pr)).toBe(true);
    });

    it('PI assigned still sees DA in pending_daf', () => {
      const pr = makePr({ status: PrStatus.pending_daf });
      expect(canActorViewPr(pi, piOwnerId, pr)).toBe(true);
    });

    it('foreign PI (different project) → false', () => {
      const pr = makePr({ project: { piUserId: piOwnerId } });
      // piForeign is PI but for a different project.
      expect(canActorViewPr(piForeign, otherPiId, pr)).toBe(false);
    });

    it('PI on a DA whose project has no piUserId → false', () => {
      const pr = makePr({ project: { piUserId: null } });
      expect(canActorViewPr(pi, piOwnerId, pr)).toBe(false);
    });

    it('PI on a DA whose project payload is missing → false', () => {
      const pr = makePr({ project: null });
      expect(canActorViewPr(pi, piOwnerId, pr)).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // Full-access roles
  // ------------------------------------------------------------------
  describe('full-access roles', () => {
    it('CONTROLEUR sees any DA', () => {
      const pr = makePr({ requestedBy: 'someone-else' });
      expect(canActorViewPr(controleur, 'cg-app-id', pr)).toBe(true);
    });

    it('DAF sees any DA', () => {
      const pr = makePr({ requestedBy: 'someone-else' });
      expect(canActorViewPr(daf, 'daf-app-id', pr)).toBe(true);
    });

    it('SUPER_ADMIN sees any DA', () => {
      const pr = makePr({ requestedBy: 'someone-else' });
      expect(canActorViewPr(superAdmin, 'sa-app-id', pr)).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // CAISSIER
  // ------------------------------------------------------------------
  describe('CAISSIER', () => {
    it('sees petty_cash DA regardless of status', () => {
      const pr = makePr({ requestType: PrType.petty_cash, status: PrStatus.approved });
      expect(canActorViewPr(caissier, 'caissier-app-id', pr)).toBe(true);
    });

    it('does NOT see a standard DA', () => {
      const pr = makePr({ requestType: PrType.standard });
      expect(canActorViewPr(caissier, 'caissier-app-id', pr)).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // Owner / non-owner DEMANDEUR
  // ------------------------------------------------------------------
  describe('DEMANDEUR ownership', () => {
    it('owner DEMANDEUR sees own DA', () => {
      const pr = makePr({ requestedBy: ownerId });
      expect(canActorViewPr(demandeurOwner, ownerId, pr)).toBe(true);
    });

    it('foreign DEMANDEUR (not owner) → false', () => {
      const pr = makePr({ requestedBy: ownerId });
      expect(canActorViewPr(demandeurOther, otherUserId, pr)).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // ACHETEUR (fix-acheteur-visibility-scope)
  // ------------------------------------------------------------------
  describe('ACHETEUR — status-conditional visibility', () => {
    /**
     * L'ACHETEUR a un scope restreint par statut : il ne voit que les DA
     * `approved` (à transformer en BC) ou `closed` (traçabilité). Pas
     * d'accès aux brouillons / pending_* — séparation des tâches.
     *
     * Avant ce fix : ACHETEUR était dans ALL_ACCESS_ROLES → voyait TOUT
     * (trop permissif). Après ce fix : conditionné au statut.
     */

    it('approved DA → true (transformation en BC à venir)', () => {
      const pr = makePr({ status: PrStatus.approved, requestedBy: 'someone-else' });
      expect(canActorViewPr(acheteur, 'acheteur-app-id', pr)).toBe(true);
    });

    it('closed DA → true (traçabilité post-cycle)', () => {
      const pr = makePr({ status: PrStatus.closed, requestedBy: 'someone-else' });
      expect(canActorViewPr(acheteur, 'acheteur-app-id', pr)).toBe(true);
    });

    it('draft DA → false (pas en charge du brouillon)', () => {
      const pr = makePr({ status: PrStatus.draft, requestedBy: 'someone-else' });
      expect(canActorViewPr(acheteur, 'acheteur-app-id', pr)).toBe(false);
    });

    it('pending_pi DA → false (validation, hors scope ACHETEUR)', () => {
      const pr = makePr({ status: PrStatus.pending_pi, requestedBy: 'someone-else' });
      expect(canActorViewPr(acheteur, 'acheteur-app-id', pr)).toBe(false);
    });

    it('pending_cg DA → false', () => {
      const pr = makePr({ status: PrStatus.pending_cg, requestedBy: 'someone-else' });
      expect(canActorViewPr(acheteur, 'acheteur-app-id', pr)).toBe(false);
    });

    it('pending_daf DA → false', () => {
      const pr = makePr({ status: PrStatus.pending_daf, requestedBy: 'someone-else' });
      expect(canActorViewPr(acheteur, 'acheteur-app-id', pr)).toBe(false);
    });

    it('rejected DA → false (workflow terminé négativement, hors scope BC)', () => {
      const pr = makePr({ status: PrStatus.rejected, requestedBy: 'someone-else' });
      expect(canActorViewPr(acheteur, 'acheteur-app-id', pr)).toBe(false);
    });

    it('ACHETEUR qui est aussi owner d\'un draft → true via ownership', () => {
      // Régression : la règle owner DOIT s\'appliquer en plus du scope statut.
      const pr = makePr({ status: PrStatus.draft, requestedBy: 'acheteur-app-id' });
      expect(canActorViewPr(acheteur, 'acheteur-app-id', pr)).toBe(true);
    });
  });
});
