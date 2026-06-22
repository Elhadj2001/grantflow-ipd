import {
  SegregationOfDutiesService,
  type SodEnforceInput,
} from '../segregation-of-duties.service';
import { SegregationOfDutiesException } from '../../exceptions/business.exception';
import type { AuditLogService } from '../../services/audit-log.service';

/**
 * G1/F3 — moteur de séparation des tâches (ADR-009). Unit test du mécanisme
 * partagé : blocage strict + 2 dérogations encadrées (convention + break-glass
 * SUPER_ADMIN), avec journalisation `audit.event_log`. Les 3 services (DA,
 * paiement, écriture) délèguent à ce moteur.
 */
describe('SegregationOfDutiesService.enforce (G1/F3)', () => {
  let audit: { recordDomainEvent: jest.Mock };
  let svc: SegregationOfDutiesService;

  const VALID_REASON = 'Clôture bailleur urgente, valideur unique disponible ce jour.';

  function input(overrides: Partial<SodEnforceInput> = {}): SodEnforceInput {
    return {
      entityType: 'purchase_request',
      entityId: 'pr-1',
      operation: 'approve_pr',
      creatorAppUserId: 'user-a',
      actorAppUserId: 'user-a',
      actor: { id: 'user-a', email: 'a@ipd.sn', roles: ['DAF'] },
      singleActorAuthorized: false,
      bypassReason: undefined,
      ...overrides,
    };
  }

  beforeEach(() => {
    audit = { recordDomainEvent: jest.fn() };
    svc = new SegregationOfDutiesService(audit as unknown as AuditLogService);
  });

  it('OK — acteur ≠ créateur : passe, aucun audit de dérogation', () => {
    expect(() =>
      svc.enforce(input({ creatorAppUserId: 'user-a', actorAppUserId: 'user-b' })),
    ).not.toThrow();
    expect(audit.recordDomainEvent).not.toHaveBeenCalled();
  });

  it('OK — créateur inconnu (null) : pas de conflit', () => {
    expect(() => svc.enforce(input({ creatorAppUserId: null }))).not.toThrow();
    expect(audit.recordDomainEvent).not.toHaveBeenCalled();
  });

  it('REFUS — saisisseur = valideur, sans dérogation → SegregationOfDutiesException', () => {
    expect(() => svc.enforce(input())).toThrow(SegregationOfDutiesException);
    expect(audit.recordDomainEvent).not.toHaveBeenCalled();
  });

  it('DÉROGATION convention — single_actor_authorized=true → autorisé + audit sod_derogation_convention', () => {
    expect(() => svc.enforce(input({ singleActorAuthorized: true }))).not.toThrow();
    expect(audit.recordDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sod_derogation_convention', entityId: 'pr-1' }),
    );
  });

  it('BREAK-GLASS — SUPER_ADMIN + motif (≥ 20) → autorisé + audit sod_break_glass (motif journalisé)', () => {
    expect(() =>
      svc.enforce(input({ actor: { id: 'sa', email: 's@x', roles: ['SUPER_ADMIN'] }, bypassReason: VALID_REASON })),
    ).not.toThrow();
    const call = audit.recordDomainEvent.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'sod_break_glass',
    )?.[0] as { payload?: { bypassReason?: string } } | undefined;
    expect(call).toBeDefined();
    expect(call?.payload?.bypassReason).toBe(VALID_REASON);
  });

  it('REFUS — SUPER_ADMIN avec motif trop court (< 20) → SegregationOfDutiesException (bypassAvailable=true)', () => {
    try {
      svc.enforce(input({ actor: { id: 'sa', email: 's@x', roles: ['SUPER_ADMIN'] }, bypassReason: 'trop court' }));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SegregationOfDutiesException);
      expect((e as SegregationOfDutiesException).bypassAvailable).toBe(true);
    }
    expect(audit.recordDomainEvent).not.toHaveBeenCalled();
  });

  it('REFUS — non-SUPER_ADMIN avec motif valide → pas de break-glass (403)', () => {
    expect(() =>
      svc.enforce(input({ actor: { id: 'user-a', email: 'a@x', roles: ['DAF'] }, bypassReason: VALID_REASON })),
    ).toThrow(SegregationOfDutiesException);
    expect(audit.recordDomainEvent).not.toHaveBeenCalled();
  });
});
