import { Prisma } from '@prisma/client';
import type { PurchaseRequest, PurchaseRequestLine } from '@prisma/client';
import { PurchaseRequestService } from '../purchase-request.service';
import { ExchangeRateService } from '../../referential/exchange-rate/exchange-rate.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import {
  BudgetLineNotInGrantException,
  EligibilityValidationException,
  EntityNotFoundException,
  GrantNotActiveException,
  InsufficientBudgetException,
  PrNotDeletableException,
  PrNotEditableException,
  PrNotOwnedException,
  ProjectGrantMismatchException,
} from '../../common/exceptions/business.exception';
import type { EligibilityEngineService } from '../../grant_office/eligibility/eligibility-engine.service';
import type { EligibilityContextBuilder } from '../../grant_office/eligibility/eligibility-context-builder.service';
import type { CreatePurchaseRequestDto } from '../dto/create-pr.dto';
import type { PurchaseRequestQueryDto } from '../dto/pr-query.dto';
import { createPrismaMock, type PrismaMock } from '../../test-utils/prisma-mock';
import { useFakeDate, restoreRealDate } from '../../test-utils/fake-time';

describe('PurchaseRequestService', () => {
  // US-062 (fix F22) : horloge figée → numéros DA-YYYY-NNNN et horodatages
  // par défaut déterministes, indépendants de la date d'exécution.
  beforeAll(() => useFakeDate('2026-06-15'));
  afterAll(() => restoreRealDate());

  let prisma: PrismaMock;
  let svc: PurchaseRequestService;
  // US-049 : mocks de la gate d'éligibilité (ADR-007). Par défaut `validate`
  // renvoie OK ; les tests dédiés reconfigurent `validate`/`build`.
  let engine: { validate: jest.Mock };
  let builder: { build: jest.Mock };

  // Projection typée du `where` passé au 1er appel `findMany`. mockDeep type
  // `mock.calls[0][0]` comme l'union d'args Prisma (potentiellement undefined
  // + index signature absente → TS18048/TS7053). On narrow vers le type Prisma
  // attendu pour conserver l'autocomplétion et des assertions type-safe.
  function firstFindManyWhere(): Prisma.PurchaseRequestWhereInput {
    const args = prisma.purchaseRequest.findMany.mock.calls[0]?.[0] as
      | { where?: Prisma.PurchaseRequestWhereInput }
      | undefined;
    return (args?.where ?? {}) as Prisma.PurchaseRequestWhereInput;
  }

  const projectId = 'prj00000-0000-0000-0000-000000000000';
  const grantId = 'grt00000-0000-0000-0000-000000000000';
  const blId1 = 'bl100000-0000-0000-0000-000000000001';
  const blId2 = 'bl200000-0000-0000-0000-000000000002';
  const userOwn = 'usr00000-0000-0000-0000-000000000001';
  const userOther = 'usr00000-0000-0000-0000-000000000002';

  const demandeur: AuthenticatedUser = {
    id: userOwn, email: 'd@x', fullName: 'D', roles: ['DEMANDEUR'],
  };
  const otherDemandeur: AuthenticatedUser = {
    id: userOther, email: 'b@x', fullName: 'B', roles: ['DEMANDEUR'],
  };
  const daf: AuthenticatedUser = {
    id: 'usr-daf', email: 'daf@x', fullName: 'DAF', roles: ['DAF'],
  };
  const sa: AuthenticatedUser = {
    id: 'usr-sa', email: 'sa@x', fullName: 'SA', roles: ['SUPER_ADMIN'],
  };
  // Fix fix-acheteur-visibility-scope : ACHETEUR a un scope par STATUT
  // (approved/closed) côté findMany, en plus de son ownership.
  const acheteur: AuthenticatedUser = {
    id: 'usr-acheteur', email: 'acheteur@x', fullName: 'Acheteur', roles: ['ACHETEUR'],
  };

  const pr: PurchaseRequest = {
    id: 'pr000000-0000-0000-0000-000000000000',
    prNumber: 'DA-2026-0001',
    requestedBy: userOwn,
    requestedAt: new Date('2026-05-10T00:00:00Z'),
    neededBy: null,
    status: 'draft',
    projectId,
    grantId,
    costCenterId: null,
    activityId: null,
    totalAmount: new Prisma.Decimal('1000'),
    currency: 'XOF',
    description: 'test',
    requestType: 'standard',
    rejectionReason: null,
    cashBoxId: null,
    updatedAt: new Date('2026-05-10T00:00:00Z'),
    // US-003-bis : colonnes multidevise ADR-005 (nullable, non testées ici).
    total_amount_xof: null,
    fx_rate: null,
    fx_rate_date: null,
    // US-054 : champs matérialisés PPT-5/6 (nullable/default, gate dormante ici).
    expenseNatureCode: null,
    pasteurParisReimbursed: false,
    supplierInvoiceNumber: null,
  };

  function makePrWithLines(lines: PurchaseRequestLine[] = [], overrides: Partial<PurchaseRequest> = {}) {
    return { ...pr, ...overrides, lines };
  }

  function line(o: Partial<PurchaseRequestLine>): PurchaseRequestLine {
    return {
      id: 'l000', prId: pr.id, lineNumber: 1,
      description: 'x', quantity: new Prisma.Decimal('1'),
      unit: 'unit', unitPrice: new Prisma.Decimal('1000'),
      lineTotal: new Prisma.Decimal('1000'),
      budgetLineId: blId1, defaultAccount: null,
      ...o,
    } as PurchaseRequestLine;
  }

  function createDto(o: Partial<CreatePurchaseRequestDto> = {}): CreatePurchaseRequestDto {
    return {
      projectId,
      grantId,
      description: 'Une DA test',
      currency: 'XOF',
      lines: [{ description: 'L1', quantity: 1, unit: 'unit', unitPrice: 1000, budgetLineId: blId1 }],
      ...o,
    } as CreatePurchaseRequestDto;
  }

  function baseQuery(o: Partial<PurchaseRequestQueryDto> = {}): PurchaseRequestQueryDto {
    return { page: 1, pageSize: 20, sort: 'requestedAt', order: 'desc', ...o } as PurchaseRequestQueryDto;
  }

  beforeEach(() => {
    // F2 : mock profond `mockDeep<PrismaService>()` — auto-stube toute méthode
    // (y compris `tx.purchaseRequest.findFirst` ajouté par le générateur de
    // numéro de DA). `$transaction` est pré-câblé en passthrough par le helper.
    // On ne (re)configure ici que les retours dont les assertions dépendent.
    prisma = createPrismaMock();
    prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
    prisma.purchaseRequest.aggregate.mockResolvedValue({
      _sum: { totalAmount: null },
    } as never);
    prisma.purchaseRequestLine.findMany.mockResolvedValue([] as never);
    prisma.purchaseOrderLine.findMany.mockResolvedValue([] as never);
    prisma.$executeRawUnsafe.mockResolvedValue(1 as never);
    // Bridge Keycloak.sub → auth.app_user.id : on assume id == actor.id pour le test.
    prisma.appUser.findUnique.mockImplementation((args: unknown) => {
      const { where } = args as { where: { email: string } };
      const map: Record<string, string> = {
        'd@x': userOwn,
        'b@x': userOther,
        'daf@x': 'usr-daf',
        'sa@x': 'usr-sa',
        'acheteur@x': 'usr-acheteur',
      };
      const id = map[where.email];
      return Promise.resolve(id ? { id } : null) as never;
    });
    // US-010 : ExchangeRateService injecté. Mock identité XOF (toutes les
    // fixtures budget de ce spec sont en XOF → xofAmount = montant brut).
    // PRÉSERVÉ tel quel : seul le mock PRISMA migre vers mockDeep.
    const fx = {
      convertToXof: jest.fn(async (amount: number | { toString(): string }) => ({
        xofAmount: Number(amount),
        fxRate: 1,
        fxRateDate: new Date('2026-05-10'),
        isIndicativeFallback: false,
      })),
    };
    // US-049 : par défaut, éligibilité OK (aucun blocage, aucun warning). La
    // gate est de toute façon DORMANTE pour les DA sans `expenseNatureCode`
    // (cas des fixtures existantes) → `build`/`validate` ne sont pas appelés.
    engine = {
      validate: jest.fn(async () => ({
        ok: true,
        blockedVerdicts: [],
        warnings: [],
        verdictsByRule: {},
      })),
    };
    builder = { build: jest.fn(async () => ({}) as never) };
    svc = new PurchaseRequestService(
      prisma,
      fx as unknown as ExchangeRateService,
      engine as unknown as EligibilityEngineService,
      builder as unknown as EligibilityContextBuilder,
    );
  });

  // ------------------------------------------------------------------
  describe('generatePrNumber (advisory lock + count)', () => {
    it('formats DA-YYYY-NNNN with 4-digit zero-padding', async () => {
      // Aucune DA existante cette année → `findFirst` renvoie null (par défaut
      // mockDeep) → séquence repart à 1. NB : le générateur dérive la séquence
      // de MAX(prNumber) via `findFirst`, plus de `count()` (cf. F2).
      prisma.purchaseRequest.create.mockResolvedValue(
        makePrWithLines([], { prNumber: 'DA-2026-0001' }) as never,
      );
      prisma.grantAgreement.findUnique.mockResolvedValue({ projectId, budgetLines: [{ id: blId1 }] } as never);
      const res = await svc.create(demandeur, createDto());
      expect(res.prNumber).toMatch(/^DA-\d{4}-0001$/);
      // pg_advisory_xact_lock was called.
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'));
    });

    it('increments past existing PRs for the year', async () => {
      // F2 : la séquence vient de MAX(prNumber) via `findFirst` (et non plus de
      // `count()`). On stube donc la dernière DA de l'année à -0042 → next = 43.
      const year = new Date().getFullYear();
      prisma.purchaseRequest.findFirst.mockResolvedValue({
        prNumber: `DA-${year}-0042`,
      } as never);
      prisma.grantAgreement.findUnique.mockResolvedValue({ projectId, budgetLines: [{ id: blId1 }] } as never);
      prisma.purchaseRequest.create.mockImplementation((args: unknown) => {
        const { data } = args as { data: { prNumber: string } };
        return Promise.resolve(makePrWithLines([], { prNumber: data.prNumber })) as never;
      });
      const res = await svc.create(demandeur, createDto());
      expect(res.prNumber).toMatch(/-0043$/);
    });
  });

  // ------------------------------------------------------------------
  describe('create — referential coherence', () => {
    it('throws ProjectGrantMismatchException when grant.projectId !== projectId', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({
        projectId: 'other-project',
        budgetLines: [{ id: blId1 }],
      } as never);
      await expect(svc.create(demandeur, createDto())).rejects.toBeInstanceOf(
        ProjectGrantMismatchException,
      );
    });

    it('throws BudgetLineNotInGrantException when a line references a wrong BL', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ projectId, budgetLines: [{ id: blId1 }] } as never);
      await expect(
        svc.create(
          demandeur,
          createDto({
            lines: [
              { description: 'x', quantity: 1, unit: 'unit', unitPrice: 1, budgetLineId: 'bl-other' },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BudgetLineNotInGrantException);
    });

    it('throws EntityNotFoundException when grant does not exist', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(null);
      await expect(svc.create(demandeur, createDto())).rejects.toBeInstanceOf(
        EntityNotFoundException,
      );
    });

    it('happy path: creates PR with totalAmount = sum(q*p) and 1-indexed lineNumbers', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({
        projectId,
        budgetLines: [{ id: blId1 }, { id: blId2 }],
      } as never);
      prisma.purchaseRequest.count.mockResolvedValue(0 as never);
      prisma.purchaseRequest.create.mockImplementation((args: unknown) => {
        const { data } = args as { data: { totalAmount: number } };
        return Promise.resolve(
          makePrWithLines([], { totalAmount: new Prisma.Decimal(data.totalAmount) }),
        ) as never;
      });
      const res = await svc.create(
        demandeur,
        createDto({
          lines: [
            { description: 'L1', quantity: 2, unit: 'unit', unitPrice: 1000, budgetLineId: blId1 },
            { description: 'L2', quantity: 5, unit: 'unit', unitPrice: 200, budgetLineId: blId2 },
          ],
        }),
      );
      expect(Number(res.totalAmount)).toBe(3000);
    });

    // US-096 (F-S8-11) : total calculé en Prisma.Decimal — 3 × (0,1 × 1)
    // vaut exactement 0.3 (l'ancienne réduction float64 donnait
    // 0.30000000000000004, persisté tel quel en Decimal(18,2)).
    it('US-096 — totalAmount Decimal exact (3 × 0,1 → 0.3, pas 0.30000000000000004)', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({
        projectId,
        budgetLines: [{ id: blId1 }],
      } as never);
      prisma.purchaseRequest.count.mockResolvedValue(0 as never);
      let persisted: Prisma.Decimal | undefined;
      prisma.purchaseRequest.create.mockImplementation((args: unknown) => {
        const { data } = args as { data: { totalAmount: Prisma.Decimal } };
        persisted = data.totalAmount;
        return Promise.resolve(
          makePrWithLines([], { totalAmount: new Prisma.Decimal(data.totalAmount) }),
        ) as never;
      });
      await svc.create(
        demandeur,
        createDto({
          lines: [
            { description: 'A', quantity: 0.1, unit: 'unit', unitPrice: 1, budgetLineId: blId1 },
            { description: 'B', quantity: 0.1, unit: 'unit', unitPrice: 1, budgetLineId: blId1 },
            { description: 'C', quantity: 0.1, unit: 'unit', unitPrice: 1, budgetLineId: blId1 },
          ],
        }),
      );
      expect(persisted).toBeInstanceOf(Prisma.Decimal);
      expect(persisted?.toString()).toBe('0.3');
    });
  });

  // ------------------------------------------------------------------
  // US-064 — le DTO transporte les champs éligibilité (colonnes US-054)
  // jusqu'à Prisma, et la chaîne create → submit aboutit au rejet PPT.
  describe('create/update — champs éligibilité US-064', () => {
    it('create transporte expenseNatureCode / pasteurParisReimbursed / supplierInvoiceNumber', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({
        projectId,
        budgetLines: [{ id: blId1 }],
      } as never);
      prisma.purchaseRequest.create.mockResolvedValue(makePrWithLines([]) as never);
      await svc.create(
        demandeur,
        createDto({
          expenseNatureCode: 'LAB_CONSUMABLES',
          pasteurParisReimbursed: true,
          supplierInvoiceNumber: 'INV-2026-0042',
        } as never),
      );
      expect(prisma.purchaseRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expenseNatureCode: 'LAB_CONSUMABLES',
            pasteurParisReimbursed: true,
            supplierInvoiceNumber: 'INV-2026-0042',
          }),
        }),
      );
    });

    it('create sans champs éligibilité → défauts null / false / null (gate dormante)', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({
        projectId,
        budgetLines: [{ id: blId1 }],
      } as never);
      prisma.purchaseRequest.create.mockResolvedValue(makePrWithLines([]) as never);
      await svc.create(demandeur, createDto());
      expect(prisma.purchaseRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expenseNatureCode: null,
            pasteurParisReimbursed: false,
            supplierInvoiceNumber: null,
          }),
        }),
      );
    });

    it('update transporte les champs éligibilité (PATCH, undefined = inchangé)', async () => {
      const existing = makePrWithLines([]);
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...existing,
        status: 'draft',
        requestedBy: userOwn,
        lines: [],
      } as never);
      prisma.purchaseRequest.update.mockResolvedValue(existing as never);
      await svc.update(demandeur, existing.id, {
        expenseNatureCode: 'MISSION_TRAVEL',
        pasteurParisReimbursed: true,
      } as never);
      expect(prisma.purchaseRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expenseNatureCode: 'MISSION_TRAVEL',
            pasteurParisReimbursed: true,
            supplierInvoiceNumber: undefined,
          }),
        }),
      );
    });

    it('chaîne complète US-064 : DA créée avec nature inéligible → submit REJETÉ code ELIG_NATURE_NOT_ALLOWED', async () => {
      // 1. create() avec la nature saisie au formulaire.
      prisma.grantAgreement.findUnique.mockResolvedValue({
        projectId,
        budgetLines: [{ id: blId1 }],
      } as never);
      const created = makePrWithLines([], { expenseNatureCode: 'ALCOHOL' } as never);
      prisma.purchaseRequest.create.mockResolvedValue(created as never);
      const pr = await svc.create(demandeur, createDto({ expenseNatureCode: 'ALCOHOL' } as never));

      // 2. submit() : la colonne matérialisée active la gate → le moteur
      //    rend le verdict PPT slide 7 (ELIG_NATURE_NOT_ALLOWED, bloquant).
      const ln = line({ lineTotal: new Prisma.Decimal('100'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr,
        lines: [ln],
        grant: { status: 'active', projectId },
        expenseNatureCode: 'ALCOHOL',
      } as never);
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('38000'), grant: { currency: 'XOF' } },
      ] as never);
      engine.validate.mockResolvedValueOnce({
        ok: false,
        blockedVerdicts: [
          { kind: 'blocked', code: 'ELIG_NATURE_NOT_ALLOWED', message: 'Nature exclue par la Note Technique' },
        ],
        warnings: [],
        verdictsByRule: {},
      });

      const err = await svc.submit(demandeur, pr.id).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EligibilityValidationException);
      expect((err as EligibilityValidationException).details).toMatchObject({
        blockedCodes: ['ELIG_NATURE_NOT_ALLOWED'],
      });
      expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  describe('findMany — RBAC scoping', () => {
    it('DEMANDEUR sees only own DAs (requestedBy override)', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
      prisma.purchaseRequest.count.mockResolvedValue(0 as never);
      await svc.findMany(demandeur, baseQuery());
      const where = firstFindManyWhere();
      expect(where.requestedBy).toBe(demandeur.id);
    });

    it('DAF can pass requestedBy filter (sees everyone)', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
      prisma.purchaseRequest.count.mockResolvedValue(0 as never);
      await svc.findMany(daf, baseQuery({ requestedBy: userOwn }));
      const where = firstFindManyWhere();
      expect(where.requestedBy).toBe(userOwn);
    });

    it('DAF without requestedBy sees all (no ownership filter)', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
      prisma.purchaseRequest.count.mockResolvedValue(0 as never);
      await svc.findMany(daf, baseQuery());
      const where = firstFindManyWhere();
      expect(where.requestedBy).toBeUndefined();
    });

    it('builds OR clause for q on description+prNumber', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
      prisma.purchaseRequest.count.mockResolvedValue(0 as never);
      await svc.findMany(daf, baseQuery({ q: 'reactif' }));
      const where = firstFindManyWhere();
      expect(where.OR).toHaveLength(2);
    });

    it('filters status / projectId / grantId / date range', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
      prisma.purchaseRequest.count.mockResolvedValue(0 as never);
      await svc.findMany(daf, baseQuery({
        status: 'submitted', projectId, grantId,
        fromDate: '2026-01-01', toDate: '2026-12-31',
      }));
      const where = firstFindManyWhere();
      expect(where.status).toBe('submitted');
      expect(where.requestedAt).toEqual({
        gte: new Date('2026-01-01'),
        lte: new Date('2026-12-31'),
      });
    });

    // ------------------------------------------------------------------
    // Fix fix-acheteur-visibility-scope
    // ------------------------------------------------------------------
    it('ACHETEUR : where.OR couvre ownership ∨ status ∈ [approved, closed]', async () => {
      // Symptôme corrigé : avant le fix, l\'acheteur recevait
      // where.requestedBy = self → liste vide (jamais owner d\'une DA).
      prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
      prisma.purchaseRequest.count.mockResolvedValue(0 as never);
      await svc.findMany(acheteur, baseQuery());
      const where = firstFindManyWhere();

      // Plus de filtre flat requestedBy.
      expect(where.requestedBy).toBeUndefined();
      // OR composite :
      expect(where.OR).toEqual([
        { requestedBy: 'usr-acheteur' },
        { status: { in: ['approved', 'closed'] } },
      ]);
    });

    it('ACHETEUR + recherche q : combine via AND (préserve le OR de visibilité)', async () => {
      // Régression : sans la composition AND, le OR de recherche
      // clobberait celui de la visibilité, exposant TOUTES les DA
      // matchant le texte (y compris les drafts cross-projets).
      prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
      prisma.purchaseRequest.count.mockResolvedValue(0 as never);
      await svc.findMany(acheteur, baseQuery({ q: 'reactif' }));
      const where = firstFindManyWhere();
      const and = where.AND as Prisma.PurchaseRequestWhereInput[] | undefined;

      expect(where.OR).toBeUndefined();
      expect(and).toHaveLength(2);
      // Premier AND : visibility OR.
      expect(and?.[0]).toEqual({
        OR: [
          { requestedBy: 'usr-acheteur' },
          { status: { in: ['approved', 'closed'] } },
        ],
      });
      // Second AND : recherche q.
      expect(and?.[1].OR).toHaveLength(2);
    });

    it('DEMANDEUR non-régression : pas de OR de visibilité, scope ownership flat', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([] as never);
      prisma.purchaseRequest.count.mockResolvedValue(0 as never);
      await svc.findMany(demandeur, baseQuery());
      const where = firstFindManyWhere();
      // Forme flat conservée pour DEMANDEUR (pas de OR visibilité).
      expect(where.requestedBy).toBe(userOwn);
      expect(where.OR).toBeUndefined();
      expect(where.AND).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  describe('findOne — ownership', () => {
    it('DEMANDEUR sees own DA', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePrWithLines([]) as never);
      const res = await svc.findOne(demandeur, pr.id);
      expect(res.id).toBe(pr.id);
    });

    it("DEMANDEUR foreign DA → PrNotOwnedException (404 for obscurity)", async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePrWithLines([], { requestedBy: 'other' }) as never,
      );
      await expect(svc.findOne(demandeur, pr.id)).rejects.toBeInstanceOf(PrNotOwnedException);
    });

    it('DAF sees any DA', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePrWithLines([], { requestedBy: 'someone-else' }) as never,
      );
      await expect(svc.findOne(daf, pr.id)).resolves.toBeTruthy();
    });

    it('returns 404 when id unknown', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(null);
      await expect(svc.findOne(daf, pr.id)).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    // ----------------------------------------------------------------
    // Régression — bug 404 chez les valideurs (PI/CG/DAF/CAISSIER)
    // ----------------------------------------------------------------
    it('PI assigned via project.piUserId sees pending_pi DA they did not request', async () => {
      // Le PI clique sur une DA depuis sa file d'attente "pending_pi".
      // Avant le fix, `assertCanRead` levait PrNotOwnedException (404) car
      // pr.requestedBy ≠ appUserId(PI). Désormais, le helper voit
      // pr.project.piUserId === appUserId(PI) et autorise la lecture.
      const piId = 'usr-pi';
      const pi: AuthenticatedUser = {
        id: piId, email: 'pi@x', fullName: 'PI', roles: ['PI'],
      };
      // Étendre le bridge email → app_user.id pour ce test.
      prisma.appUser.findUnique.mockImplementation((args: unknown) => {
        const { where } = args as { where: { email: string } };
        const map: Record<string, string> = {
          'd@x': userOwn,
          'b@x': userOther,
          'daf@x': 'usr-daf',
          'sa@x': 'usr-sa',
          'pi@x': piId,
        };
        const id = map[where.email];
        return Promise.resolve(id ? { id } : null) as never;
      });
      // `project` n'est pas dans `PurchaseRequest` natif (c'est une relation
      // chargée via include). On builde l'objet enrichi via unknown narrow.
      const prWithProject: unknown = {
        ...makePrWithLines([], { status: 'pending_pi', requestedBy: userOther }),
        project: { piUserId: piId },
      };
      prisma.purchaseRequest.findUnique.mockResolvedValue(prWithProject as never);
      const res = await svc.findOne(pi, pr.id);
      expect(res.id).toBe(pr.id);
    });

    it('PI not assigned (foreign project) → PrNotOwnedException (regression guard)', async () => {
      // Un PI qui n'est PAS le PI du projet de la DA ne doit pas voir cette DA.
      // 404 (PrNotOwnedException) pour ne pas révéler l'existence — OWASP.
      const piForeign: AuthenticatedUser = {
        id: 'usr-pi-other', email: 'pi-other@x', fullName: 'PI Other', roles: ['PI'],
      };
      prisma.appUser.findUnique.mockImplementation((args: unknown) => {
        const { where } = args as { where: { email: string } };
        const map: Record<string, string> = {
          'pi-other@x': 'usr-pi-other-app',
        };
        const id = map[where.email];
        return Promise.resolve(id ? { id } : null) as never;
      });
      const prWithForeignProject: unknown = {
        ...makePrWithLines([], { status: 'pending_pi', requestedBy: userOther }),
        project: { piUserId: 'usr-some-other-pi' },
      };
      prisma.purchaseRequest.findUnique.mockResolvedValue(prWithForeignProject as never);
      await expect(svc.findOne(piForeign, pr.id)).rejects.toBeInstanceOf(PrNotOwnedException);
    });
  });

  // ------------------------------------------------------------------
  describe('update', () => {
    it('rejects when status ≠ draft', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePrWithLines([], { status: 'submitted' }) as never,
      );
      await expect(svc.update(demandeur, pr.id, {} as never)).rejects.toBeInstanceOf(
        PrNotEditableException,
      );
    });

    it("DEMANDEUR cannot update another's DA (404 obscurity)", async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePrWithLines([], { requestedBy: 'other-user' }) as never,
      );
      await expect(svc.update(demandeur, pr.id, {} as never)).rejects.toBeInstanceOf(
        PrNotOwnedException,
      );
    });

    it('SUPER_ADMIN can update any draft DA', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePrWithLines([], { requestedBy: 'other-user' }) as never,
      );
      prisma.purchaseRequest.update.mockResolvedValue(makePrWithLines([]) as never);
      await expect(svc.update(sa, pr.id, { description: 'fix' } as never)).resolves.toBeTruthy();
    });

    it('revalidates grant cohérence when projectId/grantId change', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePrWithLines([]) as never);
      prisma.grantAgreement.findUnique.mockResolvedValue({ projectId: 'other-project' } as never);
      await expect(
        svc.update(demandeur, pr.id, { projectId, grantId: 'new-grant' } as never),
      ).rejects.toBeInstanceOf(ProjectGrantMismatchException);
    });
  });

  // ------------------------------------------------------------------
  describe('cancel', () => {
    it('passes draft → cancelled', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(pr as never);
      prisma.purchaseRequest.update.mockResolvedValue({ ...pr, status: 'cancelled' } as never);
      const res = await svc.cancel(demandeur, pr.id);
      expect(res.status).toBe('cancelled');
    });

    it('refuses cancel on non-draft', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue({ ...pr, status: 'submitted' } as never);
      await expect(svc.cancel(demandeur, pr.id)).rejects.toBeInstanceOf(PrNotDeletableException);
    });

    it('refuses cancel from foreign user (404 obscurity)', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue({ ...pr, requestedBy: 'other' } as never);
      await expect(svc.cancel(demandeur, pr.id)).rejects.toBeInstanceOf(PrNotOwnedException);
    });
  });

  // ------------------------------------------------------------------
  describe('checkBudget', () => {
    it('returns wouldExceed=true when line totals exceed budget', async () => {
      const ln = line({ lineTotal: new Prisma.Decimal('50000'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePrWithLines([ln]) as never);
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('38000'), grant: { currency: 'XOF' } },
      ] as never);
      const res = await svc.checkBudget(demandeur, pr.id);
      expect(res.wouldExceed).toBe(true);
      expect(res.byLine).toHaveLength(1);
      expect(res.byLine[0].available).toBeLessThan(0);
    });

    it('returns wouldExceed=false when within budget', async () => {
      const ln = line({ lineTotal: new Prisma.Decimal('10000'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePrWithLines([ln]) as never);
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('38000'), grant: { currency: 'XOF' } },
      ] as never);
      const res = await svc.checkBudget(demandeur, pr.id);
      expect(res.wouldExceed).toBe(false);
    });

    it('aggregates other pending PRs as alreadyConsumed', async () => {
      const ln = line({ lineTotal: new Prisma.Decimal('5000'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePrWithLines([ln]) as never);
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('38000'), grant: { currency: 'XOF' } },
      ] as never);
      // US-010 : computeBudgetUsageByLine fetche désormais les lignes (avec la
      // devise du parent) puis convertit en XOF — plus de groupBy.
      prisma.purchaseRequestLine.findMany.mockResolvedValue([
        {
          budgetLineId: blId1,
          lineTotal: new Prisma.Decimal('20000'),
          pr: { currency: 'XOF', requestedAt: new Date('2026-05-01') },
        },
      ] as never);
      const res = await svc.checkBudget(demandeur, pr.id);
      expect(res.byLine[0].alreadyConsumed).toBe(20000);
      expect(res.byLine[0].available).toBe(38000 - 20000 - 5000);
    });
  });

  // ------------------------------------------------------------------
  describe('submit', () => {
    it('rejects when status ≠ draft', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr, status: 'submitted', lines: [], grant: { status: 'active', projectId },
      } as never);
      await expect(svc.submit(demandeur, pr.id)).rejects.toBeInstanceOf(PrNotEditableException);
    });

    it('rejects when grant.status ≠ active', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr, lines: [], grant: { status: 'suspended', projectId },
      } as never);
      await expect(svc.submit(demandeur, pr.id)).rejects.toBeInstanceOf(GrantNotActiveException);
    });

    it('rejects with INSUFFICIENT_BUDGET when at least one line exceeds', async () => {
      const ln = line({ lineTotal: new Prisma.Decimal('99999999'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr, lines: [ln], grant: { status: 'active', projectId },
      } as never);
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('100'), grant: { currency: 'XOF' } },
      ] as never);
      await expect(svc.submit(demandeur, pr.id)).rejects.toBeInstanceOf(InsufficientBudgetException);
    });

    it('happy path: status → pending_pi + approval_step created', async () => {
      const ln = line({ lineTotal: new Prisma.Decimal('100'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr, lines: [ln], grant: { status: 'active', projectId },
      } as never);
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('38000'), grant: { currency: 'XOF' } },
      ] as never);
      prisma.purchaseRequest.update.mockResolvedValue({ ...pr, status: 'pending_pi' } as never);
      prisma.approvalStep.create.mockResolvedValue({} as never);
      const res = await svc.submit(demandeur, pr.id);
      expect(res.pr.status).toBe('pending_pi');
      expect(res.warnings).toEqual([]);
      // Gate DORMANTE : DA sans `expenseNatureCode` → moteur non sollicité.
      expect(builder.build).not.toHaveBeenCalled();
      expect(engine.validate).not.toHaveBeenCalled();
      expect(prisma.approvalStep.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'purchase_request',
            entityId: pr.id,
            stepOrder: 1,
            approverRole: 'PI',
            status: 'pending',
          }),
        }),
      );
    });

    // US-049 — Gate d'éligibilité (ADR-007). On force `expenseNatureCode` sur
    // la DA pour activer la gate (sinon dormante). Le moteur étant mocké, le
    // contenu du contexte importe peu — seul le branchement est sous test.
    it('US-049 eligibility OK with nature → submit passes, engine consulted, no warnings', async () => {
      const ln = line({ lineTotal: new Prisma.Decimal('100'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr, lines: [ln], grant: { status: 'active', projectId }, expenseNatureCode: 'REAGENTS',
      } as never);
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('38000'), grant: { currency: 'XOF' } },
      ] as never);
      prisma.purchaseRequest.update.mockResolvedValue({ ...pr, status: 'pending_pi' } as never);
      prisma.approvalStep.create.mockResolvedValue({} as never);

      const res = await svc.submit(demandeur, pr.id);

      expect(builder.build).toHaveBeenCalledTimes(1);
      expect(engine.validate).toHaveBeenCalledTimes(1);
      expect(res.pr.status).toBe('pending_pi');
      expect(res.warnings).toEqual([]);
    });

    it('US-049 eligibility BLOCKED → throws EligibilityValidationException, no persistence', async () => {
      const ln = line({ lineTotal: new Prisma.Decimal('100'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr, lines: [ln], grant: { status: 'active', projectId }, expenseNatureCode: 'ALCOHOL',
      } as never);
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('38000'), grant: { currency: 'XOF' } },
      ] as never);
      engine.validate.mockResolvedValueOnce({
        ok: false,
        blockedVerdicts: [
          { kind: 'blocked', code: 'ELIG_NATURE_EXCLUDED', message: 'Nature exclue par la convention' },
        ],
        warnings: [],
        verdictsByRule: {},
      });

      await expect(svc.submit(demandeur, pr.id)).rejects.toBeInstanceOf(
        EligibilityValidationException,
      );
      // Aucune écriture : la gate bloque AVANT la transaction.
      expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
      expect(prisma.approvalStep.create).not.toHaveBeenCalled();
    });

    it('US-049 eligibility WARNING (non bloquant) → submit passes, warnings transportés', async () => {
      const ln = line({ lineTotal: new Prisma.Decimal('100'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr, lines: [ln], grant: { status: 'active', projectId }, expenseNatureCode: 'REAGENTS',
      } as never);
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('38000'), grant: { currency: 'XOF' } },
      ] as never);
      prisma.purchaseRequest.update.mockResolvedValue({ ...pr, status: 'pending_pi' } as never);
      prisma.approvalStep.create.mockResolvedValue({} as never);
      engine.validate.mockResolvedValueOnce({
        ok: true,
        blockedVerdicts: [],
        warnings: [
          { kind: 'warning', code: 'ELIG_ANTI_SPLITTING', message: 'Fractionnement suspecté' },
        ],
        verdictsByRule: {},
      });

      const res = await svc.submit(demandeur, pr.id);

      expect(res.pr.status).toBe('pending_pi');
      expect(res.warnings).toHaveLength(1);
      expect(res.warnings[0].code).toBe('ELIG_ANTI_SPLITTING');
    });

    it('rejects when project/grant mismatch detected late (data drift)', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr, lines: [], grant: { status: 'active', projectId: 'other-project' },
      } as never);
      await expect(svc.submit(demandeur, pr.id)).rejects.toBeInstanceOf(
        ProjectGrantMismatchException,
      );
    });
  });

  // ------------------------------------------------------------------
  describe('ownership writes', () => {
    it('blocks foreign DEMANDEUR on submit', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr, requestedBy: 'someone', lines: [], grant: { status: 'active', projectId },
      } as never);
      await expect(svc.submit(otherDemandeur, pr.id)).rejects.toBeInstanceOf(PrNotOwnedException);
    });
  });

  // ====================================================================
  //  CASH FLOWS — create + submit (sprint 2.3)
  // ====================================================================
  describe('cash flows — create', () => {
    const cbId = 'cb000000-0000-0000-0000-000000000001';

    function makeGrant(allowsCash = true) {
      return { id: grantId, projectId, allowsCashPayment: allowsCash, budgetLines: [{ id: blId1 }] };
    }

    it('petty_cash on grant.allowsCashPayment=false → CASH_PAYMENT_NOT_ALLOWED', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(false) as never);
      prisma.cashBox.findUnique.mockResolvedValue({
        id: cbId, isActive: true, perRequestMax: new Prisma.Decimal('100000'),
      } as never);
      const { CashPaymentNotAllowedException } = await import(
        '../../common/exceptions/business.exception'
      );
      await expect(
        svc.create(
          demandeur,
          createDto({ requestType: 'petty_cash', cashBoxId: cbId }),
        ),
      ).rejects.toBeInstanceOf(CashPaymentNotAllowedException);
    });

    it('petty_cash on inactive cash box → CASH_BOX_INACTIVE', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(true) as never);
      prisma.cashBox.findUnique.mockResolvedValue({
        id: cbId, isActive: false, perRequestMax: new Prisma.Decimal('100000'),
      } as never);
      const { CashBoxInactiveException } = await import(
        '../../common/exceptions/business.exception'
      );
      await expect(
        svc.create(demandeur, createDto({ requestType: 'petty_cash', cashBoxId: cbId })),
      ).rejects.toBeInstanceOf(CashBoxInactiveException);
    });

    it('petty_cash total > perRequestMax → CASH_LIMIT_PER_REQUEST_EXCEEDED', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(true) as never);
      prisma.cashBox.findUnique.mockResolvedValue({
        id: cbId, isActive: true, perRequestMax: new Prisma.Decimal('50000'),
        perDayUserMax: new Prisma.Decimal('200000'),
      } as never);
      const { CashLimitPerRequestExceededException } = await import(
        '../../common/exceptions/business.exception'
      );
      await expect(
        svc.create(
          demandeur,
          createDto({
            requestType: 'petty_cash',
            cashBoxId: cbId,
            lines: [{ description: 'A', quantity: 1, unit: 'unit', unitPrice: 60000, budgetLineId: blId1 }],
          }),
        ),
      ).rejects.toBeInstanceOf(CashLimitPerRequestExceededException);
    });

    it('petty_cash : 4ᵉ DA du jour > perDayUserMax → CASH_LIMIT_PER_DAY_EXCEEDED', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(true) as never);
      prisma.cashBox.findUnique.mockResolvedValue({
        id: cbId, isActive: true,
        perRequestMax: new Prisma.Decimal('100000'),
        perDayUserMax: new Prisma.Decimal('200000'),
      } as never);
      // Déjà 180k consommés aujourd'hui ; on tente d'en ajouter 50k.
      // US-011 : computeUserDailyCashXof fetche les DA du jour (findMany) et
      // convertit chacune en XOF — plus d'aggregate(_sum).
      prisma.purchaseRequest.findMany.mockResolvedValue([
        { totalAmount: new Prisma.Decimal('180000'), currency: 'XOF', requestedAt: new Date() },
      ] as never);
      const { CashLimitPerDayExceededException } = await import(
        '../../common/exceptions/business.exception'
      );
      await expect(
        svc.create(
          demandeur,
          createDto({
            requestType: 'petty_cash',
            cashBoxId: cbId,
            lines: [{ description: 'A', quantity: 1, unit: 'unit', unitPrice: 50000, budgetLineId: blId1 }],
          }),
        ),
      ).rejects.toBeInstanceOf(CashLimitPerDayExceededException);
    });

    it('petty_cash happy path under all limits → 201 + cashBoxId persisted', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(true) as never);
      prisma.cashBox.findUnique.mockResolvedValue({
        id: cbId, isActive: true,
        perRequestMax: new Prisma.Decimal('100000'),
        perDayUserMax: new Prisma.Decimal('200000'),
      } as never);
      prisma.purchaseRequest.count.mockResolvedValue(0 as never);
      prisma.purchaseRequest.create.mockImplementation((args: unknown) => {
        const { data } = args as { data: Record<string, unknown> };
        return Promise.resolve({ ...pr, ...data, lines: [] }) as never;
      });
      const res = await svc.create(
        demandeur,
        createDto({
          requestType: 'petty_cash',
          cashBoxId: cbId,
          lines: [{ description: 'Eau', quantity: 1, unit: 'unit', unitPrice: 45000, budgetLineId: blId1 }],
        }),
      );
      expect(res.cashBoxId).toBe(cbId);
      expect(res.requestType).toBe('petty_cash');
    });

    it('cash_advance has NO per-day limit', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(true) as never);
      prisma.cashBox.findUnique.mockResolvedValue({
        id: cbId, isActive: true,
        perRequestMax: new Prisma.Decimal('200000'),
        perDayUserMax: new Prisma.Decimal('100000'), // even with a low per-day, cash_advance ignores it
      } as never);
      prisma.purchaseRequest.aggregate.mockResolvedValue({
        _sum: { totalAmount: new Prisma.Decimal('300000') },
      } as never);
      prisma.purchaseRequest.count.mockResolvedValue(0 as never);
      prisma.purchaseRequest.create.mockImplementation((args: unknown) => {
        const { data } = args as { data: Record<string, unknown> };
        return Promise.resolve({ ...pr, ...data, lines: [] }) as never;
      });
      const res = await svc.create(
        demandeur,
        createDto({
          requestType: 'cash_advance',
          cashBoxId: cbId,
          lines: [{ description: 'Mission', quantity: 1, unit: 'unit', unitPrice: 150000, budgetLineId: blId1 }],
        }),
      );
      expect(res.requestType).toBe('cash_advance');
    });

    it('petty_cash without cashBoxId reaches the service → CASH_BOX_REQUIRED', async () => {
      // Zod superRefine déjà la 400 en amont, mais on s'assure que le service
      // double-vérifie pour les appels internes (ex: bulk import futur).
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(true) as never);
      const { CashBoxRequiredException } = await import(
        '../../common/exceptions/business.exception'
      );
      await expect(
        svc.create(demandeur, createDto({ requestType: 'petty_cash' })),
      ).rejects.toBeInstanceOf(CashBoxRequiredException);
    });
  });

  // ------------------------------------------------------------------
  describe('cash flows — submit (routage de la 1ère étape)', () => {
    it('petty_cash submit → status pending_caissier + approval_step CAISSIER', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr,
        requestType: 'petty_cash',
        cashBoxId: 'cb-1',
        lines: [],
        grant: { status: 'active', projectId },
      } as never);
      prisma.purchaseRequest.update.mockResolvedValue({ ...pr, status: 'pending_caissier' } as never);
      await svc.submit(demandeur, pr.id);
      expect(prisma.approvalStep.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ approverRole: 'CAISSIER', stepOrder: 1 }),
      });
    });

    it('cash_advance submit → status pending_pi + approval_step PI', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr,
        requestType: 'cash_advance',
        cashBoxId: 'cb-1',
        lines: [],
        grant: { status: 'active', projectId },
      } as never);
      prisma.purchaseRequest.update.mockResolvedValue({ ...pr, status: 'pending_pi' } as never);
      await svc.submit(demandeur, pr.id);
      expect(prisma.approvalStep.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ approverRole: 'PI', stepOrder: 1 }),
      });
    });
  });
});
