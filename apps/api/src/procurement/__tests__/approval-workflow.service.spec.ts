import { Prisma, PrStatus } from '@prisma/client';
import type { ApprovalStep, PurchaseRequest } from '@prisma/client';
import {
  ApprovalWorkflowService,
  APPROVAL_THRESHOLD_CG,
  APPROVAL_THRESHOLD_DAF,
} from '../services/approval-workflow.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import {
  CashWorkflowNotYetImplementedException,
  PiNotOwnerOfProjectException,
  PrAlreadyDecidedException,
  PrNotAwaitingYouException,
  PrNotInApprovalException,
  RejectionReasonRequiredException,
} from '../../common/exceptions/business.exception';

describe('ApprovalWorkflowService', () => {
  let prisma: {
    purchaseRequest: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    approvalStep: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    project: { findUnique: jest.Mock };
    appUser: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let svc: ApprovalWorkflowService;

  const piId = 'pi000000-0000-0000-0000-000000000001';
  const cgId = 'cg000000-0000-0000-0000-000000000002';
  const dafId = 'daf00000-0000-0000-0000-000000000003';
  const projectId = 'prj00000-0000-0000-0000-000000000010';
  const prId = 'pr000000-0000-0000-0000-000000000020';

  const pi: AuthenticatedUser = {
    id: 'pi-sub', email: 'pi@x', fullName: 'PI', roles: ['PI'],
  };
  const cg: AuthenticatedUser = {
    id: 'cg-sub', email: 'cg@x', fullName: 'CG', roles: ['CONTROLEUR'],
  };
  const daf: AuthenticatedUser = {
    id: 'daf-sub', email: 'daf@x', fullName: 'DAF', roles: ['DAF'],
  };
  const sa: AuthenticatedUser = {
    id: 'sa-sub', email: 'sa@x', fullName: 'SA', roles: ['SUPER_ADMIN'],
  };
  const dem: AuthenticatedUser = {
    id: 'dem-sub', email: 'dem@x', fullName: 'DEM', roles: ['DEMANDEUR'],
  };

  function makePr(overrides: Partial<PurchaseRequest> = {}): PurchaseRequest {
    return {
      id: prId,
      prNumber: 'DA-2026-0001',
      requestedBy: 'requester',
      requestedAt: new Date('2026-05-10T00:00:00Z'),
      neededBy: null,
      status: PrStatus.pending_pi,
      projectId,
      grantId: 'grant-1',
      costCenterId: null,
      activityId: null,
      totalAmount: new Prisma.Decimal('100000'),
      currency: 'XOF',
      description: 'test',
      requestType: 'standard',
      rejectionReason: null,
      updatedAt: new Date('2026-05-10T00:00:00Z'),
      ...overrides,
    } as PurchaseRequest;
  }

  function makeStep(overrides: Partial<ApprovalStep> = {}): ApprovalStep {
    return {
      id: 'step-1', entityType: 'purchase_request', entityId: prId,
      stepOrder: 1, approverId: null, approverRole: 'PI',
      status: 'pending', decidedAt: null, decisionNotes: null,
      ...overrides,
    } as ApprovalStep;
  }

  beforeEach(() => {
    prisma = {
      purchaseRequest: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      approvalStep: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
      project: { findUnique: jest.fn() },
      appUser: {
        findUnique: jest.fn(({ where }: { where: { email: string } }) => {
          const map: Record<string, string> = {
            'pi@x': piId, 'cg@x': cgId, 'daf@x': dafId, 'sa@x': 'sa-app', 'dem@x': 'dem-app',
          };
          return Promise.resolve(map[where.email] ? { id: map[where.email] } : null);
        }),
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb: unknown) => {
        if (typeof cb === 'function') return (cb as (tx: unknown) => unknown)(prisma);
        return Promise.all(cb as unknown[]);
      }),
    };
    svc = new ApprovalWorkflowService(prisma as unknown as PrismaService);
  });

  // ------------------------------------------------------------------
  describe('approveCurrentStep — threshold routing', () => {
    it('amount < 500k : PI approves → APPROVED (no next step)', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr({ totalAmount: new Prisma.Decimal('100000') }));
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      prisma.project.findUnique.mockResolvedValue({ piUserId: piId });
      prisma.purchaseRequest.update.mockResolvedValue(makePr({ status: PrStatus.approved }));
      const res = await svc.approveCurrentStep(pi, prId);
      expect(res.nextStepRole).toBeNull();
      expect(res.pr.status).toBe(PrStatus.approved);
      // no new step created
      expect(prisma.approvalStep.create).not.toHaveBeenCalled();
    });

    it('500k ≤ amount < 5M : PI approves → PENDING_CG', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr({ totalAmount: new Prisma.Decimal('1000000') }));
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      prisma.project.findUnique.mockResolvedValue({ piUserId: piId });
      prisma.purchaseRequest.update.mockResolvedValue(makePr({ status: PrStatus.pending_cg }));
      const res = await svc.approveCurrentStep(pi, prId);
      expect(res.nextStepRole).toBe('CONTROLEUR');
      expect(res.pr.status).toBe(PrStatus.pending_cg);
      expect(prisma.approvalStep.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stepOrder: 2, approverRole: 'CONTROLEUR' }),
        }),
      );
    });

    it('amount ≥ 5M : CG approves a pending_cg PR → PENDING_DAF', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({ totalAmount: new Prisma.Decimal('10000000'), status: PrStatus.pending_cg }),
      );
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'CONTROLEUR', stepOrder: 2 }));
      prisma.purchaseRequest.update.mockResolvedValue(makePr({ status: PrStatus.pending_daf }));
      const res = await svc.approveCurrentStep(cg, prId);
      expect(res.nextStepRole).toBe('DAF');
      expect(res.pr.status).toBe(PrStatus.pending_daf);
    });

    it('DAF approves the last step → APPROVED', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({ totalAmount: new Prisma.Decimal('10000000'), status: PrStatus.pending_daf }),
      );
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'DAF', stepOrder: 3 }));
      prisma.purchaseRequest.update.mockResolvedValue(makePr({ status: PrStatus.approved }));
      const res = await svc.approveCurrentStep(daf, prId);
      expect(res.nextStepRole).toBeNull();
      expect(res.pr.status).toBe(PrStatus.approved);
    });

    it('threshold constants are sane (CG=500k, DAF=5M)', () => {
      expect(APPROVAL_THRESHOLD_CG).toBe(500_000);
      expect(APPROVAL_THRESHOLD_DAF).toBe(5_000_000);
    });
  });

  // ------------------------------------------------------------------
  describe('approveCurrentStep — role checks', () => {
    it('rejects wrong role (DAF tries to approve pending_pi) → PR_NOT_AWAITING_YOU', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr());
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      await expect(svc.approveCurrentStep(daf, prId)).rejects.toBeInstanceOf(
        PrNotAwaitingYouException,
      );
    });

    it('SUPER_ADMIN bypasses role check', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr());
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      prisma.project.findUnique.mockResolvedValue({ piUserId: piId });
      prisma.purchaseRequest.update.mockResolvedValue(makePr({ status: PrStatus.approved }));
      const res = await svc.approveCurrentStep(sa, prId);
      expect(res.pr.status).toBe(PrStatus.approved);
    });

    it('PI not owner of project → PI_NOT_OWNER_OF_PROJECT', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr());
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      prisma.project.findUnique.mockResolvedValue({ piUserId: 'someone-else' });
      await expect(svc.approveCurrentStep(pi, prId)).rejects.toBeInstanceOf(
        PiNotOwnerOfProjectException,
      );
    });

    it('CG approval does NOT trigger PI ownership check', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({ status: PrStatus.pending_cg, totalAmount: new Prisma.Decimal('1000000') }),
      );
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'CONTROLEUR', stepOrder: 2 }));
      prisma.purchaseRequest.update.mockResolvedValue(makePr({ status: PrStatus.approved }));
      const res = await svc.approveCurrentStep(cg, prId);
      expect(res.pr.status).toBe(PrStatus.approved);
      expect(prisma.project.findUnique).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  describe('approveCurrentStep — guards', () => {
    it('rejects when PR not in approval (draft) → PR_NOT_IN_APPROVAL', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr({ status: PrStatus.draft }));
      await expect(svc.approveCurrentStep(pi, prId)).rejects.toBeInstanceOf(
        PrNotInApprovalException,
      );
    });

    it('rejects when no pending step exists → PR_ALREADY_DECIDED', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr());
      prisma.approvalStep.findFirst.mockResolvedValue(null);
      await expect(svc.approveCurrentStep(pi, prId)).rejects.toBeInstanceOf(
        PrAlreadyDecidedException,
      );
    });

    it('rejects requestType=petty_cash → 501 CASH_WORKFLOW_NOT_YET_IMPLEMENTED', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr({ requestType: 'petty_cash' }));
      await expect(svc.approveCurrentStep(pi, prId)).rejects.toBeInstanceOf(
        CashWorkflowNotYetImplementedException,
      );
    });

    it('rejects requestType=cash_advance → 501', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr({ requestType: 'cash_advance' }));
      await expect(svc.approveCurrentStep(pi, prId)).rejects.toBeInstanceOf(
        CashWorkflowNotYetImplementedException,
      );
    });
  });

  // ------------------------------------------------------------------
  describe('rejectCurrentStep', () => {
    it('requires reason ≥ 5 chars', async () => {
      await expect(svc.rejectCurrentStep(pi, prId, 'no')).rejects.toBeInstanceOf(
        RejectionReasonRequiredException,
      );
    });

    it('happy path: status → REJECTED + rejectionReason saved', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr());
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      prisma.purchaseRequest.update.mockResolvedValue(
        makePr({ status: PrStatus.rejected, rejectionReason: 'Budget non justifié dans le plan annuel' }),
      );
      const res = await svc.rejectCurrentStep(pi, prId, 'Budget non justifié dans le plan annuel');
      expect(res.status).toBe(PrStatus.rejected);
      expect(res.rejectionReason).toBe('Budget non justifié dans le plan annuel');
    });

    it('rejects wrong role on reject', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr());
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      await expect(svc.rejectCurrentStep(daf, prId, 'reason here')).rejects.toBeInstanceOf(
        PrNotAwaitingYouException,
      );
    });

    it('refuses when not in approval (draft)', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr({ status: PrStatus.draft }));
      await expect(svc.rejectCurrentStep(pi, prId, 'reason here')).rejects.toBeInstanceOf(
        PrNotInApprovalException,
      );
    });

    it('blocks petty_cash on reject too', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr({ requestType: 'petty_cash' }));
      await expect(svc.rejectCurrentStep(pi, prId, 'reason here')).rejects.toBeInstanceOf(
        CashWorkflowNotYetImplementedException,
      );
    });
  });

  // ------------------------------------------------------------------
  describe('returnForChanges', () => {
    it('marks step as returned and PR back to DRAFT', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr());
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      prisma.purchaseRequest.update.mockResolvedValue(makePr({ status: PrStatus.draft }));
      const res = await svc.returnForChanges(pi, prId, 'Préciser le fournisseur attendu');
      expect(res.status).toBe(PrStatus.draft);
      expect(prisma.approvalStep.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'returned' }),
        }),
      );
    });

    it('refuses empty comment', async () => {
      await expect(svc.returnForChanges(pi, prId, '')).rejects.toBeInstanceOf(
        RejectionReasonRequiredException,
      );
    });

    it('blocks petty_cash', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr({ requestType: 'petty_cash' }));
      await expect(svc.returnForChanges(pi, prId, 'changement nécessaire')).rejects.toBeInstanceOf(
        CashWorkflowNotYetImplementedException,
      );
    });
  });

  // ------------------------------------------------------------------
  describe('getMyPendingApprovals', () => {
    it('PI sees only DA pending_pi from projects they own', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([makePr()]);
      prisma.purchaseRequest.count.mockResolvedValue(1);
      await svc.getMyPendingApprovals(pi, { page: 1, pageSize: 20 });
      const args = prisma.purchaseRequest.findMany.mock.calls[0][0];
      expect(args.where.status.in).toContain(PrStatus.pending_pi);
      expect(args.where.requestType).toBe('standard');
      expect(args.where.project).toEqual({ piUserId: piId });
    });

    it('CG sees all pending_cg', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseRequest.count.mockResolvedValue(0);
      await svc.getMyPendingApprovals(cg, { page: 1, pageSize: 20 });
      const args = prisma.purchaseRequest.findMany.mock.calls[0][0];
      expect(args.where.status.in).toEqual([PrStatus.pending_cg]);
      expect(args.where.project).toBeUndefined();
    });

    it('DAF sees all pending_daf', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseRequest.count.mockResolvedValue(0);
      await svc.getMyPendingApprovals(daf, { page: 1, pageSize: 20 });
      const args = prisma.purchaseRequest.findMany.mock.calls[0][0];
      expect(args.where.status.in).toEqual([PrStatus.pending_daf]);
    });

    it('SUPER_ADMIN sees all in_approval', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseRequest.count.mockResolvedValue(0);
      await svc.getMyPendingApprovals(sa, { page: 1, pageSize: 20 });
      const args = prisma.purchaseRequest.findMany.mock.calls[0][0];
      expect(args.where.status.in).toEqual(
        expect.arrayContaining([PrStatus.pending_pi, PrStatus.pending_cg, PrStatus.pending_daf]),
      );
    });

    it('urgent filter applies needed_by ≤ today+7 days', async () => {
      prisma.purchaseRequest.findMany.mockResolvedValue([]);
      prisma.purchaseRequest.count.mockResolvedValue(0);
      await svc.getMyPendingApprovals(cg, { page: 1, pageSize: 20, urgent: true });
      const args = prisma.purchaseRequest.findMany.mock.calls[0][0];
      expect(args.where.neededBy).toMatchObject({ not: null });
    });
  });

  // ------------------------------------------------------------------
  describe('splitting detection (anti-fractionnement)', () => {
    it('does not warn at exactly 3 other DAs (threshold = >3)', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr());
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      prisma.project.findUnique.mockResolvedValue({ piUserId: piId });
      prisma.purchaseRequest.count.mockResolvedValue(3);
      prisma.purchaseRequest.update.mockResolvedValue(makePr({ status: PrStatus.approved }));
      const res = await svc.approveCurrentStep(pi, prId);
      expect(res.splittingWarning).toBeNull();
    });

    it('warns when > 3 active DAs in 30 days', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr());
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      prisma.project.findUnique.mockResolvedValue({ piUserId: piId });
      prisma.purchaseRequest.count.mockResolvedValue(4);
      prisma.purchaseRequest.update.mockResolvedValue(makePr({ status: PrStatus.approved }));
      const res = await svc.approveCurrentStep(pi, prId);
      expect(res.splittingWarning).toEqual({ recentCount: 5, projectId });
    });
  });

  // ------------------------------------------------------------------
  describe('getApprovalHistory', () => {
    it('returns steps ordered by stepOrder asc', async () => {
      prisma.approvalStep.findMany.mockResolvedValue([
        makeStep({ stepOrder: 1, approverRole: 'PI', status: 'approved' }),
        makeStep({ stepOrder: 2, approverRole: 'CONTROLEUR', status: 'pending' }),
      ]);
      const res = await svc.getApprovalHistory(prId);
      expect(res).toHaveLength(2);
      const args = prisma.approvalStep.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual({ stepOrder: 'asc' });
    });
  });

  // ------------------------------------------------------------------
  describe('ownership ignored on workflow methods', () => {
    it('a DEMANDEUR cannot approve (PR_NOT_AWAITING_YOU)', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(makePr());
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      await expect(svc.approveCurrentStep(dem, prId)).rejects.toBeInstanceOf(
        PrNotAwaitingYouException,
      );
    });
  });
});
