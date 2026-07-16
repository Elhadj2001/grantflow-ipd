import { ConflictException, Logger } from '@nestjs/common';
import { NoteTechniqueService } from './note-technique.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createPrismaMock, type PrismaMock } from '../../test-utils/prisma-mock';
import {
  EntityNotFoundException,
  NoteTechniqueInvalidTransitionException,
  NoteTechniqueRejectionReasonRequiredException,
  SegregationOfDutiesException,
} from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { CreateNoteTechniqueDto } from './dto/create-note-technique.dto';
import type { UpdateNoteTechniqueDto } from './dto/update-note-technique.dto';

const actor = { id: 'u1', email: 'go@x', fullName: 'GO', roles: ['CONTROLEUR'] } as AuthenticatedUser;

/** Fabrique une ligne note_technique déterministe (BigInt XOF requis par serialize). */
function ntRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'nt-1',
    grantId: 'grant-1',
    version: 1,
    status: 'draft',
    draftedByUserId: 'u-go',
    draftedAt: new Date('2026-01-01T00:00:00Z'),
    submittedToDafAt: null,
    validatedByDafUserId: null,
    validatedAt: null,
    activatedAt: null,
    budgetCode: 'BUD-1',
    reportingIntermediateDates: [],
    reportingFinalDate: new Date('2026-12-31T00:00:00Z'),
    ownFundsContributionXof: BigInt(0),
    ownFundsContributionCurrency: null,
    overheadRuleId: null,
    singleActorAuthorized: false,
    singleActorJustification: null,
    supersedesId: null,
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('NoteTechniqueService', () => {
  let prisma: PrismaMock;
  let svc: NoteTechniqueService;

  beforeEach(() => {
    prisma = createPrismaMock();
    svc = new NoteTechniqueService(prisma as unknown as PrismaService);
  });

  it('list() returns empty', async () => {
    prisma.noteTechnique.findMany.mockResolvedValue([] as never);
    await expect(svc.list({})).resolves.toEqual([]);
  });

  it('findById() throws when missing', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue(null as never);
    await expect(svc.findById('missing')).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  it('create() creates in draft + serializes BigInt XOF to number', async () => {
    prisma.appUser.findUnique.mockResolvedValue({ id: 'app-1' } as never);
    prisma.noteTechnique.create.mockResolvedValue({
      id: 'nt1',
      grantId: 'g1',
      status: 'draft',
      ownFundsContributionXof: BigInt(500000),
    } as never);
    const dto = {
      grantId: 'g1',
      budgetCode: 'BC-1',
      reportingFinalDate: new Date('2026-12-31'),
      reportingIntermediateDates: [],
      ownFundsContributionXof: 500000,
      singleActorAuthorized: false,
    } as unknown as CreateNoteTechniqueDto;
    const r = await svc.create(actor, dto);
    expect(r.status).toBe('draft');
    expect(r.ownFundsContributionXof).toBe(500000);
    expect(typeof r.ownFundsContributionXof).toBe('number');
  });

  it('update() rejects when status is not draft (ConflictException)', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue({ id: 'nt1', status: 'active' } as never);
    await expect(svc.update(actor, 'nt1', {} as unknown as UpdateNoteTechniqueDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

/**
 * US-051 — transitions du workflow Note Technique (ADR-006).
 * State machine pure : draft → pending_daf → validated_daf → active → superseded
 * (+ pending_daf → draft via reject). SoD (US-053) et matérialisation
 * budgétaire (US-056) hors périmètre ici.
 */
describe('NoteTechniqueService — transitions workflow (US-051)', () => {
  let prisma: PrismaMock;
  let svc: NoteTechniqueService;

  beforeEach(() => {
    prisma = createPrismaMock();
    svc = new NoteTechniqueService(prisma as unknown as PrismaService);
  });

  // ---------------------------------------------------------------- submitToDaf
  it('Test 1 — submitToDaf : draft → pending_daf, submitted_to_daf_at posé', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue(ntRow({ status: 'draft' }) as never);
    prisma.noteTechnique.update.mockResolvedValue(
      ntRow({ status: 'pending_daf', submittedToDafAt: new Date() }) as never,
    );

    const res = await svc.submitToDaf('nt-1', actor);

    expect(res.status).toBe('pending_daf');
    expect(prisma.noteTechnique.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'nt-1' },
        data: expect.objectContaining({
          status: 'pending_daf',
          submittedToDafAt: expect.any(Date),
        }),
      }),
    );
  });

  it('Test 2 — submitToDaf depuis active : NoteTechniqueInvalidTransitionException', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue(ntRow({ status: 'active' }) as never);

    await expect(svc.submitToDaf('nt-1', actor)).rejects.toBeInstanceOf(
      NoteTechniqueInvalidTransitionException,
    );
    expect(prisma.noteTechnique.update).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------- validateAsDaf
  it('Test 3 — validateAsDaf : pending_daf → validated_daf, validated_by + validated_at posés', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue(ntRow({ status: 'pending_daf' }) as never);
    prisma.appUser.findUnique.mockResolvedValue({ id: 'daf-user-1' } as never);
    prisma.noteTechnique.update.mockResolvedValue(
      ntRow({
        status: 'validated_daf',
        validatedByDafUserId: 'daf-user-1',
        validatedAt: new Date(),
      }) as never,
    );

    const res = await svc.validateAsDaf('nt-1', actor);

    expect(res.status).toBe('validated_daf');
    expect(prisma.noteTechnique.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'validated_daf',
          validatedByDafUserId: 'daf-user-1',
          validatedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('Test 4 — validateAsDaf depuis draft : NoteTechniqueInvalidTransitionException', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue(ntRow({ status: 'draft' }) as never);

    await expect(svc.validateAsDaf('nt-1', actor)).rejects.toBeInstanceOf(
      NoteTechniqueInvalidTransitionException,
    );
    expect(prisma.noteTechnique.update).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- rejectAsDaf
  it('Test 5 — rejectAsDaf : pending_daf → draft, motif journalisé', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    prisma.noteTechnique.findFirst.mockResolvedValue(ntRow({ status: 'pending_daf' }) as never);
    prisma.noteTechnique.update.mockResolvedValue(
      ntRow({ status: 'draft', submittedToDafAt: null }) as never,
    );
    const reason = 'Budget mal ventilé, revoir la ligne équipement svp';

    const res = await svc.rejectAsDaf('nt-1', actor, reason);

    expect(res.status).toBe('draft');
    expect(prisma.noteTechnique.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'draft', submittedToDafAt: null }),
      }),
    );
    const payload = logSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'note_technique_transition',
    )?.[0] as { reason?: string; to?: string };
    expect(payload.reason).toBe(reason);
    expect(payload.to).toBe('draft');
    logSpy.mockRestore();
  });

  it('Test 6 — rejectAsDaf sans motif (< 20 chars) : NoteTechniqueRejectionReasonRequiredException', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue(ntRow({ status: 'pending_daf' }) as never);

    await expect(svc.rejectAsDaf('nt-1', actor, 'trop court')).rejects.toBeInstanceOf(
      NoteTechniqueRejectionReasonRequiredException,
    );
    expect(prisma.noteTechnique.update).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------- activate
  it('Test 7 — activate : validated_daf → active, ancienne active du grant → superseded', async () => {
    prisma.noteTechnique.findFirst
      .mockResolvedValueOnce(ntRow({ id: 'nt-2', status: 'validated_daf' }) as never) // requireNote
      .mockResolvedValueOnce({ id: 'nt-old' } as never); // active courante dans la tx
    prisma.noteTechnique.update.mockResolvedValue(
      ntRow({ id: 'nt-2', status: 'active', activatedAt: new Date(), supersedesId: 'nt-old' }) as never,
    );

    const res = await svc.activate('nt-2', actor);

    expect(res.status).toBe('active');
    expect(prisma.$transaction).toHaveBeenCalled();
    // 1) ancienne active passée en superseded
    expect(prisma.noteTechnique.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'nt-old' },
        data: expect.objectContaining({ status: 'superseded' }),
      }),
    );
    // 2) nouvelle NT activée + supersedes_id pointant l'ancienne
    expect(prisma.noteTechnique.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'nt-2' },
        data: expect.objectContaining({
          status: 'active',
          activatedAt: expect.any(Date),
          supersedesId: 'nt-old',
        }),
      }),
    );
  });

  it('Test 8 — activate sans NT active précédente : validated_daf → active simple', async () => {
    prisma.noteTechnique.findFirst
      .mockResolvedValueOnce(ntRow({ status: 'validated_daf' }) as never) // requireNote
      .mockResolvedValueOnce(null as never); // aucune active courante
    prisma.noteTechnique.update.mockResolvedValue(
      ntRow({ status: 'active', activatedAt: new Date() }) as never,
    );

    const res = await svc.activate('nt-1', actor);

    expect(res.status).toBe('active');
    expect(prisma.noteTechnique.update).toHaveBeenCalledTimes(1);
    const call = prisma.noteTechnique.update.mock.calls[0][0] as {
      data: { status: string; supersedesId?: string };
    };
    expect(call.data.status).toBe('active');
    expect(call.data.supersedesId).toBeUndefined();
  });

  it('Test 9 — activate depuis draft : NoteTechniqueInvalidTransitionException', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue(ntRow({ status: 'draft' }) as never);

    await expect(svc.activate('nt-1', actor)).rejects.toBeInstanceOf(
      NoteTechniqueInvalidTransitionException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------- log Pino
  it("Test 10 — transitions journalisées Pino avec event 'note_technique_transition'", async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    prisma.noteTechnique.findFirst.mockResolvedValue(ntRow({ status: 'draft' }) as never);
    prisma.noteTechnique.update.mockResolvedValue(
      ntRow({ status: 'pending_daf', submittedToDafAt: new Date() }) as never,
    );

    await svc.submitToDaf('nt-1', actor);

    const events = logSpy.mock.calls.map((c) => (c[0] as { event?: string })?.event);
    expect(events).toContain('note_technique_transition');
    const payload = logSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'note_technique_transition',
    )![0] as { from?: string; to?: string; actorId?: string };
    expect(payload.from).toBe('draft');
    expect(payload.to).toBe('pending_daf');
    expect(payload.actorId).toBe('u1');
    logSpy.mockRestore();
  });
});

/**
 * US-053 — Séparation des tâches sur validateAsDaf (ADR-009, règle d'or n°6).
 * Le rédacteur (drafted_by_user_id, un AppUser.id) ne peut pas valider :
 * on compare l'AppUser.id résolu de l'acteur au rédacteur. Dérogations :
 * convention single_actor_authorized OU break-glass SUPER_ADMIN (motif ≥ 20).
 */
describe('NoteTechniqueService.validateAsDaf — Segregation of Duties (US-053)', () => {
  let prisma: PrismaMock;
  let svc: NoteTechniqueService;

  const SUPER_ADMIN: AuthenticatedUser = {
    id: 'sa-sub',
    email: 'sa@ipd.sn',
    fullName: 'Super Admin',
    roles: ['SUPER_ADMIN'],
  };
  const VALID_BYPASS = 'Break-glass : clôture bailleur urgente, unique valideur disponible ce jour.';

  beforeEach(() => {
    prisma = createPrismaMock();
    svc = new NoteTechniqueService(prisma as unknown as PrismaService);
  });

  it('SoD-1 — valideur ≠ rédacteur → OK (cas nominal)', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue(
      ntRow({ status: 'pending_daf', draftedByUserId: 'go-app-id' }) as never,
    );
    prisma.appUser.findUnique.mockResolvedValue({ id: 'daf-app-id' } as never); // acteur ≠ rédacteur
    prisma.noteTechnique.update.mockResolvedValue(ntRow({ status: 'validated_daf' }) as never);

    const res = await svc.validateAsDaf('nt-1', actor);

    expect(res.status).toBe('validated_daf');
    expect(prisma.noteTechnique.update).toHaveBeenCalled();
  });

  it('SoD-2 — rédacteur valide lui-même, sans dérogation → SegregationOfDutiesException', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue(
      ntRow({ status: 'pending_daf', draftedByUserId: 'same-app-id', singleActorAuthorized: false }) as never,
    );
    prisma.appUser.findUnique.mockResolvedValue({ id: 'same-app-id' } as never); // acteur = rédacteur

    await expect(svc.validateAsDaf('nt-1', actor)).rejects.toBeInstanceOf(SegregationOfDutiesException);
    expect(prisma.noteTechnique.update).not.toHaveBeenCalled();
  });

  it('SoD-3 — rédacteur valide lui-même MAIS single_actor_authorized=true → OK', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue(
      ntRow({ status: 'pending_daf', draftedByUserId: 'same-app-id', singleActorAuthorized: true }) as never,
    );
    prisma.appUser.findUnique.mockResolvedValue({ id: 'same-app-id' } as never);
    prisma.noteTechnique.update.mockResolvedValue(ntRow({ status: 'validated_daf' }) as never);

    const res = await svc.validateAsDaf('nt-1', actor);

    expect(res.status).toBe('validated_daf');
  });

  it("SoD-4 — rédacteur SUPER_ADMIN avec bypass valide → OK + log warn 'sod_bypass'", async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma.noteTechnique.findFirst.mockResolvedValue(
      ntRow({ status: 'pending_daf', draftedByUserId: 'sa-app-id', singleActorAuthorized: false }) as never,
    );
    prisma.appUser.findUnique.mockResolvedValue({ id: 'sa-app-id' } as never); // acteur = rédacteur
    prisma.noteTechnique.update.mockResolvedValue(ntRow({ status: 'validated_daf' }) as never);

    const res = await svc.validateAsDaf('nt-1', SUPER_ADMIN, VALID_BYPASS);

    expect(res.status).toBe('validated_daf');
    const payload = warnSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'sod_bypass',
    )?.[0] as { operation?: string; bypassReason?: string; actorId?: string };
    expect(payload).toBeDefined();
    expect(payload.operation).toBe('note_technique_validate');
    expect(payload.bypassReason).toBe(VALID_BYPASS);
    warnSpy.mockRestore();
  });

  it('SoD-5 — rédacteur SUPER_ADMIN avec bypass < 20 chars → SegregationOfDutiesException', async () => {
    prisma.noteTechnique.findFirst.mockResolvedValue(
      ntRow({ status: 'pending_daf', draftedByUserId: 'sa-app-id', singleActorAuthorized: false }) as never,
    );
    prisma.appUser.findUnique.mockResolvedValue({ id: 'sa-app-id' } as never);

    await expect(svc.validateAsDaf('nt-1', SUPER_ADMIN, 'trop court')).rejects.toBeInstanceOf(
      SegregationOfDutiesException,
    );
    expect(prisma.noteTechnique.update).not.toHaveBeenCalled();
  });
});
