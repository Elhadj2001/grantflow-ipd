import { Prisma } from '@prisma/client';
import type { GrantAgreement } from '@prisma/client';
import { GrantService } from '../grant.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
  GrantHasTransactionsException,
  InactiveDonorException,
  InactiveProjectException,
} from '../../../common/exceptions/business.exception';
import type { CreateGrantDto } from '../dto/create-grant.dto';
import type { GrantQueryDto } from '../dto/grant-query.dto';

describe('GrantService', () => {
  let prisma: {
    grantAgreement: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    journalLine: { count: jest.Mock };
    donor: { findUnique: jest.Mock };
    project: { findUnique: jest.Mock };
    budgetLine: { findMany: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let svc: GrantService;

  const fakeGrant: GrantAgreement = {
    id: '11111111-1111-1111-1111-111111111111',
    reference: 'BMGF-2023-117',
    donorId: '22222222-2222-2222-2222-222222222222',
    projectId: '33333333-3333-3333-3333-333333333333',
    amount: new Prisma.Decimal('485000.00'),
    currency: 'USD',
    overheadRate: new Prisma.Decimal('0.1500'),
    startDate: new Date('2024-01-01T00:00:00Z'),
    endDate: new Date('2026-12-31T00:00:00Z'),
    status: 'active',
    signedAt: new Date('2024-01-15T00:00:00Z'),
    notes: null,
    allowsCashPayment: true,
    createdAt: new Date('2024-01-15T00:00:00Z'),
    singleActorAuthorized: false,
  };

  function baseQuery(overrides: Partial<GrantQueryDto> = {}): GrantQueryDto {
    return {
      page: 1,
      pageSize: 20,
      sort: 'reference',
      order: 'asc',
      ...overrides,
    } as GrantQueryDto;
  }

  function validCreateDto(overrides: Partial<CreateGrantDto> = {}): CreateGrantDto {
    return {
      reference: 'NEW-2026-001',
      donorId: '22222222-2222-2222-2222-222222222222',
      projectId: '33333333-3333-3333-3333-333333333333',
      amount: '485000.00',
      currency: 'USD',
      overheadRate: 0.15,
      startDate: '2026-01-01',
      endDate: '2027-12-31',
      status: 'draft',
      ...overrides,
    } as CreateGrantDto;
  }

  beforeEach(() => {
    prisma = {
      grantAgreement: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      journalLine: { count: jest.fn() },
      donor: { findUnique: jest.fn() },
      project: { findUnique: jest.fn() },
      budgetLine: { findMany: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
      $queryRaw: jest.fn(),
    };
    svc = new GrantService(prisma as unknown as PrismaService);
  });

  // ------------------------------------------------------------------
  describe('findMany', () => {
    it('paginates with defaults', async () => {
      prisma.grantAgreement.findMany.mockResolvedValue([fakeGrant]);
      prisma.grantAgreement.count.mockResolvedValue(1);
      const res = await svc.findMany(baseQuery());
      expect(res.data).toEqual([fakeGrant]);
      expect(res.hasMore).toBe(false);
    });

    it('builds OR clause for q', async () => {
      prisma.grantAgreement.findMany.mockResolvedValue([]);
      prisma.grantAgreement.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ q: 'gates' }));
      const args = prisma.grantAgreement.findMany.mock.calls[0][0];
      expect(args.where.OR).toHaveLength(2);
    });

    it('filters by donorId and projectId', async () => {
      prisma.grantAgreement.findMany.mockResolvedValue([]);
      prisma.grantAgreement.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ donorId: 'd-1', projectId: 'p-1' }));
      const args = prisma.grantAgreement.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ donorId: 'd-1', projectId: 'p-1' });
    });

    it('applies date range filters', async () => {
      prisma.grantAgreement.findMany.mockResolvedValue([]);
      prisma.grantAgreement.count.mockResolvedValue(0);
      await svc.findMany(baseQuery({ startsAfter: '2024-01-01', endsBefore: '2026-12-31' }));
      const args = prisma.grantAgreement.findMany.mock.calls[0][0];
      expect(args.where.startDate).toEqual({ gte: new Date('2024-01-01') });
      expect(args.where.endDate).toEqual({ lte: new Date('2026-12-31') });
    });
  });

  // ------------------------------------------------------------------
  describe('findOne / findByReference', () => {
    it('findOne returns grant + budgetLineCount', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ ...fakeGrant, _count: { budgetLines: 8 } });
      const res = await svc.findOne(fakeGrant.id);
      expect(res.budgetLineCount).toBe(8);
    });

    it('findOne throws 404', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(null);
      await expect(svc.findOne(fakeGrant.id)).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('findByReference returns grant', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ ...fakeGrant, _count: { budgetLines: 0 } });
      const res = await svc.findByReference('BMGF-2023-117');
      expect(res.reference).toBe('BMGF-2023-117');
    });
  });

  // ------------------------------------------------------------------
  describe('create — FK validation', () => {
    it('throws InactiveDonorException when donor.isActive=false', async () => {
      prisma.donor.findUnique.mockResolvedValue({ isActive: false });
      prisma.project.findUnique.mockResolvedValue({ status: 'active' });
      await expect(svc.create(validCreateDto())).rejects.toBeInstanceOf(InactiveDonorException);
    });

    it('throws InactiveProjectException when project.status!=active', async () => {
      prisma.donor.findUnique.mockResolvedValue({ isActive: true });
      prisma.project.findUnique.mockResolvedValue({ status: 'suspended' });
      await expect(svc.create(validCreateDto())).rejects.toBeInstanceOf(InactiveProjectException);
    });

    it('throws EntityNotFoundException when donor not found', async () => {
      prisma.donor.findUnique.mockResolvedValue(null);
      prisma.project.findUnique.mockResolvedValue({ status: 'active' });
      await expect(svc.create(validCreateDto())).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('creates grant when donor active + project active', async () => {
      prisma.donor.findUnique.mockResolvedValue({ isActive: true });
      prisma.project.findUnique.mockResolvedValue({ status: 'active' });
      prisma.grantAgreement.create.mockResolvedValue(fakeGrant);
      const res = await svc.create(validCreateDto());
      expect(res).toEqual(fakeGrant);
    });

    it('maps P2002 to DuplicateCodeException', async () => {
      prisma.donor.findUnique.mockResolvedValue({ isActive: true });
      prisma.project.findUnique.mockResolvedValue({ status: 'active' });
      prisma.grantAgreement.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5' }),
      );
      await expect(svc.create(validCreateDto())).rejects.toBeInstanceOf(DuplicateCodeException);
    });
  });

  // ------------------------------------------------------------------
  describe('update — only-provided-fields', () => {
    it('does not re-validate FK when neither donorId nor projectId change', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.grantAgreement.update.mockResolvedValue(fakeGrant);
      await svc.update(fakeGrant.id, { notes: 'note' } as never);
      expect(prisma.donor.findUnique).not.toHaveBeenCalled();
      expect(prisma.project.findUnique).not.toHaveBeenCalled();
    });

    it('re-validates FK when donorId changes', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.grantAgreement.findUniqueOrThrow.mockResolvedValue(fakeGrant);
      prisma.donor.findUnique.mockResolvedValue({ isActive: true });
      prisma.project.findUnique.mockResolvedValue({ status: 'active' });
      prisma.grantAgreement.update.mockResolvedValue(fakeGrant);
      await svc.update(fakeGrant.id, { donorId: 'new-donor' } as never);
      expect(prisma.donor.findUnique).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  describe('softDelete / suspend / reactivate', () => {
    it('softDelete refused when journal_line count > 0', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.journalLine.count.mockResolvedValue(3);
      await expect(svc.softDelete(fakeGrant.id)).rejects.toBeInstanceOf(GrantHasTransactionsException);
    });

    it('softDelete switches to status=closed when no txn', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.journalLine.count.mockResolvedValue(0);
      prisma.grantAgreement.update.mockResolvedValue({ ...fakeGrant, status: 'closed' });
      const res = await svc.softDelete(fakeGrant.id);
      expect(res.status).toBe('closed');
    });

    it('softDelete rejects when already closed', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ ...fakeGrant, status: 'closed' });
      await expect(svc.softDelete(fakeGrant.id)).rejects.toBeInstanceOf(AlreadyInactiveException);
    });

    it('suspend rejected when already suspended', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ ...fakeGrant, status: 'suspended' });
      await expect(svc.suspend(fakeGrant.id)).rejects.toBeInstanceOf(AlreadyInactiveException);
    });

    it('suspend switches active → suspended', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.grantAgreement.update.mockResolvedValue({ ...fakeGrant, status: 'suspended' });
      const res = await svc.suspend(fakeGrant.id);
      expect(res.status).toBe('suspended');
    });

    it('reactivate switches suspended → active', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({ ...fakeGrant, status: 'suspended' });
      prisma.grantAgreement.update.mockResolvedValue({ ...fakeGrant, status: 'active' });
      const res = await svc.reactivate(fakeGrant.id);
      expect(res.status).toBe('active');
    });

    it('reactivate rejected when already active', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      await expect(svc.reactivate(fakeGrant.id)).rejects.toBeInstanceOf(AlreadyActiveException);
    });
  });

  // ------------------------------------------------------------------
  describe('dashboard', () => {
    it('aggregates totals and utilization from the view', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.$queryRaw.mockResolvedValue([
        {
          budget_line_id: 'bl-1',
          budget_line_code: 'L01',
          budget_line_label: 'Consommables',
          grant_ref: 'BMGF-2023-117',
          project_code: '',
          project_title: '',
          budgeted_amount: new Prisma.Decimal('38000'),
          engaged_amount: new Prisma.Decimal('29245'),
          consumed_amount: new Prisma.Decimal('25588'),
          available_amount: new Prisma.Decimal('8755'),
        },
        {
          budget_line_id: 'bl-2',
          budget_line_code: 'L02',
          budget_line_label: 'Personnel',
          grant_ref: 'BMGF-2023-117',
          project_code: '',
          project_title: '',
          budgeted_amount: new Prisma.Decimal('100000'),
          engaged_amount: new Prisma.Decimal('91000'),
          consumed_amount: new Prisma.Decimal('80000'),
          available_amount: new Prisma.Decimal('9000'),
        },
      ]);
      const d = await svc.dashboard(fakeGrant.id);
      expect(d.grantRef).toBe('BMGF-2023-117');
      expect(d.totalBudgeted).toBe(138000);
      expect(d.totalEngaged).toBe(120245);
      expect(d.totalConsumed).toBe(105588);
      expect(d.totalAvailable).toBe(17755);
      expect(d.byBudgetLine).toHaveLength(2);
      // L02 = 91% utilisé → alerte
      expect(d.alerts.some((a) => a.includes('L02'))).toBe(true);
    });

    it('falls back to Prisma aggregate when view query fails', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.$queryRaw.mockRejectedValue(new Error('view does not exist'));
      prisma.budgetLine.findMany.mockResolvedValue([
        {
          id: 'bl-1',
          code: 'L01',
          label: 'Consommables',
          grantId: fakeGrant.id,
          budgetedAmount: new Prisma.Decimal('38000'),
          defaultAccount: null,
          isOverheadEligible: true,
          isActive: true,
        },
      ]);
      const d = await svc.dashboard(fakeGrant.id);
      expect(d.totalBudgeted).toBe(38000);
      expect(d.totalEngaged).toBe(0);
      expect(d.byBudgetLine).toHaveLength(1);
    });

    it('throws 404 when grant id unknown', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(null);
      await expect(svc.dashboard('x')).rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  // ------------------------------------------------------------------
  describe('buildWhere', () => {
    it('returns empty object for default', () => {
      expect(GrantService.buildWhere(baseQuery())).toEqual({});
    });

    it('combines all filters', () => {
      const w = GrantService.buildWhere(
        baseQuery({
          donorId: 'd-1',
          projectId: 'p-1',
          status: 'active',
          currency: 'EUR',
          startsAfter: '2025-01-01',
          endsBefore: '2026-12-31',
        }),
      );
      expect(w).toMatchObject({
        donorId: 'd-1',
        projectId: 'p-1',
        status: 'active',
        currency: 'EUR',
      });
      expect(w.startDate).toEqual({ gte: new Date('2025-01-01') });
      expect(w.endDate).toEqual({ lte: new Date('2026-12-31') });
    });
  });
});
