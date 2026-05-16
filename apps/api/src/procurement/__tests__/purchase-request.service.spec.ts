import { Prisma } from '@prisma/client';
import type { PurchaseRequest, PurchaseRequestLine } from '@prisma/client';
import { PurchaseRequestService } from '../purchase-request.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import {
  BudgetLineNotInGrantException,
  EntityNotFoundException,
  GrantNotActiveException,
  InsufficientBudgetException,
  PrNotDeletableException,
  PrNotEditableException,
  PrNotOwnedException,
  ProjectGrantMismatchException,
} from '../../common/exceptions/business.exception';
import type { CreatePurchaseRequestDto } from '../dto/create-pr.dto';
import type { PurchaseRequestQueryDto } from '../dto/pr-query.dto';

describe('PurchaseRequestService', () => {
  let prisma: {
    purchaseRequest: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    purchaseRequestLine: {
      groupBy: jest.Mock;
      deleteMany: jest.Mock;
    };
    purchaseOrderLine: { groupBy: jest.Mock };
    grantAgreement: { findUnique: jest.Mock };
    budgetLine: { findMany: jest.Mock };
    approvalStep: { create: jest.Mock };
    appUser: { findUnique: jest.Mock; create: jest.Mock };
    cashBox: { findUnique: jest.Mock };
    purchaseRequestAggregate?: jest.Mock;
    $transaction: jest.Mock;
    $executeRawUnsafe: jest.Mock;
  } & {
    purchaseRequest: { aggregate: jest.Mock };
  };
  let svc: PurchaseRequestService;

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
    prisma = {
      purchaseRequest: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: null } }),
      },
      purchaseRequestLine: { groupBy: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
      purchaseOrderLine: { groupBy: jest.fn().mockResolvedValue([]) },
      grantAgreement: { findUnique: jest.fn() },
      budgetLine: { findMany: jest.fn() },
      approvalStep: { create: jest.fn() },
      cashBox: { findUnique: jest.fn() },
      // Bridge Keycloak.sub → auth.app_user.id : on assume id == actor.id pour le test.
      appUser: {
        findUnique: jest.fn(({ where }: { where: { email: string } }) => {
          const map: Record<string, string> = {
            'd@x': userOwn,
            'b@x': userOther,
            'daf@x': 'usr-daf',
            'sa@x': 'usr-sa',
          };
          const id = map[where.email];
          return Promise.resolve(id ? { id } : null);
        }),
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb: unknown) => {
        if (typeof cb === 'function') {
          return (cb as (tx: unknown) => unknown)(prisma);
        }
        return Promise.all(cb as unknown[]);
      }),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    svc = new PurchaseRequestService(prisma as unknown as PrismaService);
  });

  // ------------------------------------------------------------------
  describe('generatePrNumber (advisory lock + count)', () => {
    it('formats DA-YYYY-NNNN with 4-digit zero-padding', async () => {
      prisma.purchaseRequest.count.mockResolvedValueOnce(0);
      prisma.purchaseRequest.create.mockResolvedValue(makePrWithLines([], { prNumber: 'DA-2026-0001' }));
      prisma.grantAgreement.findUnique.mockResolvedValue({ projectId, budgetLines: [{ id: blId1 }] });
      const res = await svc.create(demandeur, createDto());
      expect(res.prNumber).toMatch(/^DA-\d{4}-0001$/);
      // pg_advisory_xact_lock was called.
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'));
    });

    it('increments past existing PRs for the year', async () => {
      prisma.purchaseRequest.count.mockResolvedValueOnce(42);
      prisma.grantAgreement.findUnique.mockResolvedValue({ projectId, budgetLines: [{ id: blId1 }] });
      prisma.purchaseRequest.create.mockImplementation(async (args: { data: { prNumber: string } }) =>
        makePrWithLines([], { prNumber: args.data.prNumber }),
      );
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
      });
      await expect(svc.create(demandeur, createDto())).rejects.toBeInstanceOf(
        ProjectGrantMismatchException,
      );
    });

    it('throws BudgetLineNotInGrantException when a line references a wrong BL', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ projectId, budgetLines: [{ id: blId1 }] });
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
      });
      prisma.purchaseRequest.count.mockResolvedValue(0);
      prisma.purchaseRequest.create.mockImplementation(async (args: { data: { totalAmount: number } }) =>
        makePrWithLines([], { totalAmount: new Prisma.Decimal(args.data.totalAmount) }),
      );
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
  });

  // ------------------------------------------------------------------
  describe('findMany — RBAC scoping', () => {
    it('DEMANDEUR sees only own DAs (requestedBy override)', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseRequest.count.mockResolvedValue(0);
      await svc.findMany(demandeur, baseQuery());
      const args = prisma.purchaseRequest.findMany.mock.calls[0][0];
      expect(args.where.requestedBy).toBe(demandeur.id);
    });

    it('DAF can pass requestedBy filter (sees everyone)', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseRequest.count.mockResolvedValue(0);
      await svc.findMany(daf, baseQuery({ requestedBy: userOwn }));
      const args = prisma.purchaseRequest.findMany.mock.calls[0][0];
      expect(args.where.requestedBy).toBe(userOwn);
    });

    it('DAF without requestedBy sees all (no ownership filter)', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseRequest.count.mockResolvedValue(0);
      await svc.findMany(daf, baseQuery());
      const args = prisma.purchaseRequest.findMany.mock.calls[0][0];
      expect(args.where.requestedBy).toBeUndefined();
    });

    it('builds OR clause for q on description+prNumber', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseRequest.count.mockResolvedValue(0);
      await svc.findMany(daf, baseQuery({ q: 'reactif' }));
      const args = prisma.purchaseRequest.findMany.mock.calls[0][0];
      expect(args.where.OR).toHaveLength(2);
    });

    it('filters status / projectId / grantId / date range', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseRequest.count.mockResolvedValue(0);
      await svc.findMany(daf, baseQuery({
        status: 'submitted', projectId, grantId,
        fromDate: '2026-01-01', toDate: '2026-12-31',
      }));
      const args = prisma.purchaseRequest.findMany.mock.calls[0][0];
      expect(args.where.status).toBe('submitted');
      expect(args.where.requestedAt).toEqual({
        gte: new Date('2026-01-01'),
        lte: new Date('2026-12-31'),
      });
    });
  });

  // ------------------------------------------------------------------
  describe('findOne — ownership', () => {
    it('DEMANDEUR sees own DA', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePrWithLines([]));
      const res = await svc.findOne(demandeur, pr.id);
      expect(res.id).toBe(pr.id);
    });

    it("DEMANDEUR foreign DA → PrNotOwnedException (404 for obscurity)", async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePrWithLines([], { requestedBy: 'other' }));
      await expect(svc.findOne(demandeur, pr.id)).rejects.toBeInstanceOf(PrNotOwnedException);
    });

    it('DAF sees any DA', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePrWithLines([], { requestedBy: 'someone-else' }),
      );
      await expect(svc.findOne(daf, pr.id)).resolves.toBeTruthy();
    });

    it('returns 404 when id unknown', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(null);
      await expect(svc.findOne(daf, pr.id)).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('update', () => {
    it('rejects when status ≠ draft', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePrWithLines([], { status: 'submitted' }));
      await expect(svc.update(demandeur, pr.id, {} as never)).rejects.toBeInstanceOf(
        PrNotEditableException,
      );
    });

    it("DEMANDEUR cannot update another's DA (404 obscurity)", async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePrWithLines([], { requestedBy: 'other-user' }),
      );
      await expect(svc.update(demandeur, pr.id, {} as never)).rejects.toBeInstanceOf(
        PrNotOwnedException,
      );
    });

    it('SUPER_ADMIN can update any draft DA', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePrWithLines([], { requestedBy: 'other-user' }),
      );
      prisma.purchaseRequest.update.mockResolvedValue(makePrWithLines([]));
      await expect(svc.update(sa, pr.id, { description: 'fix' } as never)).resolves.toBeTruthy();
    });

    it('revalidates grant cohérence when projectId/grantId change', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePrWithLines([]));
      prisma.grantAgreement.findUnique.mockResolvedValue({ projectId: 'other-project' });
      await expect(
        svc.update(demandeur, pr.id, { projectId, grantId: 'new-grant' } as never),
      ).rejects.toBeInstanceOf(ProjectGrantMismatchException);
    });
  });

  // ------------------------------------------------------------------
  describe('cancel', () => {
    it('passes draft → cancelled', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(pr);
      prisma.purchaseRequest.update.mockResolvedValue({ ...pr, status: 'cancelled' });
      const res = await svc.cancel(demandeur, pr.id);
      expect(res.status).toBe('cancelled');
    });

    it('refuses cancel on non-draft', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue({ ...pr, status: 'submitted' });
      await expect(svc.cancel(demandeur, pr.id)).rejects.toBeInstanceOf(PrNotDeletableException);
    });

    it('refuses cancel from foreign user (404 obscurity)', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue({ ...pr, requestedBy: 'other' });
      await expect(svc.cancel(demandeur, pr.id)).rejects.toBeInstanceOf(PrNotOwnedException);
    });
  });

  // ------------------------------------------------------------------
  describe('checkBudget', () => {
    it('returns wouldExceed=true when line totals exceed budget', async () => {
      const ln = line({ lineTotal: new Prisma.Decimal('50000'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePrWithLines([ln]));
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('38000') },
      ]);
      const res = await svc.checkBudget(demandeur, pr.id);
      expect(res.wouldExceed).toBe(true);
      expect(res.byLine).toHaveLength(1);
      expect(res.byLine[0].available).toBeLessThan(0);
    });

    it('returns wouldExceed=false when within budget', async () => {
      const ln = line({ lineTotal: new Prisma.Decimal('10000'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePrWithLines([ln]));
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('38000') },
      ]);
      const res = await svc.checkBudget(demandeur, pr.id);
      expect(res.wouldExceed).toBe(false);
    });

    it('aggregates other pending PRs as alreadyConsumed', async () => {
      const ln = line({ lineTotal: new Prisma.Decimal('5000'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePrWithLines([ln]));
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('38000') },
      ]);
      prisma.purchaseRequestLine.groupBy.mockResolvedValue([
        { budgetLineId: blId1, _sum: { lineTotal: new Prisma.Decimal('20000') } },
      ]);
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
      });
      await expect(svc.submit(demandeur, pr.id)).rejects.toBeInstanceOf(PrNotEditableException);
    });

    it('rejects when grant.status ≠ active', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr, lines: [], grant: { status: 'suspended', projectId },
      });
      await expect(svc.submit(demandeur, pr.id)).rejects.toBeInstanceOf(GrantNotActiveException);
    });

    it('rejects with INSUFFICIENT_BUDGET when at least one line exceeds', async () => {
      const ln = line({ lineTotal: new Prisma.Decimal('99999999'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr, lines: [ln], grant: { status: 'active', projectId },
      });
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('100') },
      ]);
      await expect(svc.submit(demandeur, pr.id)).rejects.toBeInstanceOf(InsufficientBudgetException);
    });

    it('happy path: status → pending_pi + approval_step created', async () => {
      const ln = line({ lineTotal: new Prisma.Decimal('100'), budgetLineId: blId1 });
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr, lines: [ln], grant: { status: 'active', projectId },
      });
      prisma.budgetLine.findMany.mockResolvedValue([
        { id: blId1, code: 'L01', label: 'L01', budgetedAmount: new Prisma.Decimal('38000') },
      ]);
      prisma.purchaseRequest.update.mockResolvedValue({ ...pr, status: 'pending_pi' });
      prisma.approvalStep.create.mockResolvedValue({});
      const res = await svc.submit(demandeur, pr.id);
      expect(res.status).toBe('pending_pi');
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

    it('rejects when project/grant mismatch detected late (data drift)', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue({
        ...pr, lines: [], grant: { status: 'active', projectId: 'other-project' },
      });
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
      });
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
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(false));
      prisma.cashBox.findUnique.mockResolvedValue({
        id: cbId, isActive: true, perRequestMax: new Prisma.Decimal('100000'),
      });
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
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(true));
      prisma.cashBox.findUnique.mockResolvedValue({
        id: cbId, isActive: false, perRequestMax: new Prisma.Decimal('100000'),
      });
      const { CashBoxInactiveException } = await import(
        '../../common/exceptions/business.exception'
      );
      await expect(
        svc.create(demandeur, createDto({ requestType: 'petty_cash', cashBoxId: cbId })),
      ).rejects.toBeInstanceOf(CashBoxInactiveException);
    });

    it('petty_cash total > perRequestMax → CASH_LIMIT_PER_REQUEST_EXCEEDED', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(true));
      prisma.cashBox.findUnique.mockResolvedValue({
        id: cbId, isActive: true, perRequestMax: new Prisma.Decimal('50000'),
        perDayUserMax: new Prisma.Decimal('200000'),
      });
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
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(true));
      prisma.cashBox.findUnique.mockResolvedValue({
        id: cbId, isActive: true,
        perRequestMax: new Prisma.Decimal('100000'),
        perDayUserMax: new Prisma.Decimal('200000'),
      });
      // Déjà 180k consommés aujourd'hui ; on tente d'en ajouter 50k.
      prisma.purchaseRequest.aggregate.mockResolvedValue({
        _sum: { totalAmount: new Prisma.Decimal('180000') },
      });
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
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(true));
      prisma.cashBox.findUnique.mockResolvedValue({
        id: cbId, isActive: true,
        perRequestMax: new Prisma.Decimal('100000'),
        perDayUserMax: new Prisma.Decimal('200000'),
      });
      prisma.purchaseRequest.count.mockResolvedValue(0);
      prisma.purchaseRequest.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...pr, ...data, lines: [] }),
      );
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
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(true));
      prisma.cashBox.findUnique.mockResolvedValue({
        id: cbId, isActive: true,
        perRequestMax: new Prisma.Decimal('200000'),
        perDayUserMax: new Prisma.Decimal('100000'), // even with a low per-day, cash_advance ignores it
      });
      prisma.purchaseRequest.aggregate.mockResolvedValue({
        _sum: { totalAmount: new Prisma.Decimal('300000') },
      });
      prisma.purchaseRequest.count.mockResolvedValue(0);
      prisma.purchaseRequest.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...pr, ...data, lines: [] }),
      );
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
      prisma.grantAgreement.findUnique.mockResolvedValue(makeGrant(true));
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
      });
      prisma.purchaseRequest.update.mockResolvedValue({ ...pr, status: 'pending_caissier' });
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
      });
      prisma.purchaseRequest.update.mockResolvedValue({ ...pr, status: 'pending_pi' });
      await svc.submit(demandeur, pr.id);
      expect(prisma.approvalStep.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ approverRole: 'PI', stepOrder: 1 }),
      });
    });
  });
});
