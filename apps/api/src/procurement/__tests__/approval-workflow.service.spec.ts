import { Prisma, PrStatus } from '@prisma/client';
import type { ApprovalStep, PurchaseRequest } from '@prisma/client';
import {
  ApprovalWorkflowService,
  APPROVAL_THRESHOLD_CG,
  APPROVAL_THRESHOLD_DAF,
} from '../services/approval-workflow.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExchangeRateService } from '../../referential/exchange-rate/exchange-rate.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import {
  PiNotOwnerOfProjectException,
  PrAlreadyDecidedException,
  PrNotAwaitingYouException,
  PrNotInApprovalException,
  PrTypeMismatchException,
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
    cashBox: { findUnique: jest.Mock; update: jest.Mock };
    cashSettlement: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let fx: { convertToXof: jest.Mock };
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
            'pi@x': piId, 'cg@x': cgId, 'daf@x': dafId, 'sa@x': 'sa-app',
            'dem@x': 'dem-app', 'cas@x': 'cas-app',
          };
          return Promise.resolve(map[where.email] ? { id: map[where.email] } : null);
        }),
        create: jest.fn(),
      },
      cashBox: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cb-1',
          currentBalance: new Prisma.Decimal('500000'),
        }),
        update: jest.fn(),
      },
      cashSettlement: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb: unknown) => {
        if (typeof cb === 'function') return (cb as (tx: unknown) => unknown)(prisma);
        return Promise.all(cb as unknown[]);
      }),
    };
    // Mock ExchangeRateService — par défaut, no-op (XOF in → XOF out).
    // Les tests qui veulent simuler une devise non-XOF mockent ce hook au
    // cas par cas (cf. describe `currency conversion`).
    fx = {
      // US-004 : XofConversionResult = { xofAmount, fxRate, fxRateDate, isIndicativeFallback }.
      convertToXof: jest.fn(async (amount: number) => {
        // Défaut : on retourne tel quel (fxRate=1) — les tests de routage ne
        // s'appuient que sur xofAmount ; les cas devise ≠ XOF surchargent
        // via mockResolvedValueOnce.
        return { xofAmount: amount, fxRate: 1, fxRateDate: new Date('2026-05-10'), isIndicativeFallback: false };
      }),
    };
    svc = new ApprovalWorkflowService(
      prisma as unknown as PrismaService,
      fx as unknown as ExchangeRateService,
    );
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
  // Fix fix-approval-workflow-currency-conversion
  // ------------------------------------------------------------------
  describe('approveCurrentStep — currency conversion before threshold routing', () => {
    /**
     * Bug avant le fix : 100 000 EUR (= 65 595 700 XOF) comparé naïvement
     * à 500 000 XOF (APPROVAL_THRESHOLD_CG) renvoyait `100000 < 500000`
     * → next = null → PR clôturée à `approved` après PI. Le fix convertit
     * en XOF via ExchangeRateService.convertToXof avant la comparaison.
     */

    it('DA 100k EUR (= 65.6M XOF, > 5M) : PI approves → CONTROLEUR (pas approved)', async () => {
      // Au taux BCEAO 655,957 : 100 000 EUR = 65 595 700 XOF.
      fx.convertToXof.mockResolvedValueOnce({
        xofAmount: 65_595_700,
        fxRate: 655.957,
        fxRateDate: new Date('2026-05-10'),
        isIndicativeFallback: false,
      });
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({ totalAmount: new Prisma.Decimal('100000'), currency: 'EUR' }),
      );
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      prisma.project.findUnique.mockResolvedValue({ piUserId: piId });
      prisma.purchaseRequest.update.mockResolvedValue(
        makePr({ status: PrStatus.pending_cg, currency: 'EUR' }),
      );

      const res = await svc.approveCurrentStep(pi, prId);

      // Régression directe du bug : avant le fix, res.pr.status === 'approved'.
      expect(res.nextStepRole).toBe('CONTROLEUR');
      expect(res.pr.status).toBe(PrStatus.pending_cg);
      expect(fx.convertToXof).toHaveBeenCalledWith(100000, 'EUR');
      expect(prisma.approvalStep.create).toHaveBeenCalled();
    });

    it('DA 1k EUR (= ~655 957 XOF, entre 500k et 5M) : PI → CONTROLEUR, pas DAF', async () => {
      // 1 000 EUR = 655 957 XOF — au-dessus de CG (500k), en-dessous de DAF (5M).
      fx.convertToXof.mockResolvedValueOnce({
        xofAmount: 655_957,
        fxRate: 655.957,
        fxRateDate: new Date('2026-05-10'),
        isIndicativeFallback: false,
      });
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({ totalAmount: new Prisma.Decimal('1000'), currency: 'EUR' }),
      );
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      prisma.project.findUnique.mockResolvedValue({ piUserId: piId });
      prisma.purchaseRequest.update.mockResolvedValue(
        makePr({ status: PrStatus.pending_cg, currency: 'EUR' }),
      );

      const res = await svc.approveCurrentStep(pi, prId);

      expect(res.nextStepRole).toBe('CONTROLEUR');
      // Ne doit PAS passer en pending_daf — 655k < 5M.
      expect(res.pr.status).toBe(PrStatus.pending_cg);
    });

    it('DA 100 XOF (baseline) : PI seul, pas de conversion appelée', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({ totalAmount: new Prisma.Decimal('100'), currency: 'XOF' }),
      );
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      prisma.project.findUnique.mockResolvedValue({ piUserId: piId });
      prisma.purchaseRequest.update.mockResolvedValue(makePr({ status: PrStatus.approved }));

      const res = await svc.approveCurrentStep(pi, prId);

      expect(res.nextStepRole).toBeNull();
      expect(res.pr.status).toBe(PrStatus.approved);
      // Pas d'appel à convertToXof quand la devise est déjà XOF — la
      // garde côté service évite un round-trip BD inutile.
      expect(fx.convertToXof).not.toHaveBeenCalled();
    });

    it('DA 10k USD (= 6M XOF au taux indicatif fallback) : PI → CG → DAF', async () => {
      // 10 000 USD * 600 (FALLBACK_INDICATIVE_TO_XOF) = 6 000 000 XOF, > 5M.
      // Côté CG : on doit router sur DAF.
      fx.convertToXof.mockResolvedValueOnce({
        xofAmount: 6_000_000,
        fxRate: 600,
        fxRateDate: new Date('2026-05-10'),
        isIndicativeFallback: true,
      });
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({
          totalAmount: new Prisma.Decimal('10000'),
          currency: 'USD',
          status: PrStatus.pending_cg,
        }),
      );
      prisma.approvalStep.findFirst.mockResolvedValue(
        makeStep({ approverRole: 'CONTROLEUR', stepOrder: 2 }),
      );
      prisma.purchaseRequest.update.mockResolvedValue(
        makePr({ status: PrStatus.pending_daf, currency: 'USD' }),
      );

      const res = await svc.approveCurrentStep(cg, prId);

      expect(res.nextStepRole).toBe('DAF');
      expect(res.pr.status).toBe(PrStatus.pending_daf);
      expect(fx.convertToXof).toHaveBeenCalledWith(10000, 'USD');
    });

    it('petty_cash en EUR : bypass conversion (workflow cash sans seuils)', async () => {
      // Un petty_cash n'utilise pas les seuils — pas de conversion nécessaire,
      // computeNextStepRole renvoie null direct. Le fix garde donc la
      // conversion uniquement pour requestType === 'standard'.
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({
          totalAmount: new Prisma.Decimal('5000'),
          currency: 'EUR',
          requestType: 'petty_cash',
          cashBoxId: 'cb-1',
        }),
      );
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'CAISSIER' }));
      prisma.purchaseRequest.update.mockResolvedValue(
        makePr({ status: PrStatus.approved, requestType: 'petty_cash' }),
      );

      const res = await svc.approveCurrentStep(
        { id: 'cas-sub', email: 'cas@x', fullName: 'Cas', roles: ['CAISSIER'] },
        prId,
      );

      expect(res.nextStepRole).toBeNull();
      expect(fx.convertToXof).not.toHaveBeenCalled();
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

    // Sprint 2.3 : les workflows cash sont implémentés. Les tests dédiés
    // (petty_cash → CAISSIER, cash_advance → PI puis CAISSIER) sont dans
    // les blocs `describe('cash workflows', ...)` plus bas.
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

    it('allows reject on petty_cash (cash workflow operational since sprint 2.3)', async () => {
      const caissier: AuthenticatedUser = {
        id: 'cas-sub', email: 'cas@x', fullName: 'CAS', roles: ['CAISSIER'],
      };
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({ requestType: 'petty_cash', status: PrStatus.pending_caissier }),
      );
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'CAISSIER' }));
      prisma.purchaseRequest.update.mockResolvedValue(
        makePr({ status: PrStatus.rejected, rejectionReason: 'Pas assez justifié' }),
      );
      const res = await svc.rejectCurrentStep(caissier, prId, 'Pas assez justifié');
      expect(res.status).toBe(PrStatus.rejected);
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

    it('blocks petty_cash (urgent — return-for-changes is not allowed)', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({ requestType: 'petty_cash', status: PrStatus.pending_caissier }),
      );
      await expect(svc.returnForChanges(pi, prId, 'changement nécessaire')).rejects.toBeInstanceOf(
        PrTypeMismatchException,
      );
    });

    it('allows cash_advance return (less urgent — workflow includes PI step)', async () => {
      prisma.purchaseRequest.findUnique.mockResolvedValue(
        makePr({ requestType: 'cash_advance' }),
      );
      prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
      prisma.project.findUnique.mockResolvedValue({ piUserId: piId });
      prisma.purchaseRequest.update.mockResolvedValue(makePr({ status: PrStatus.draft }));
      const res = await svc.returnForChanges(pi, prId, 'Préciser la mission');
      expect(res.status).toBe(PrStatus.draft);
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
      // sprint 2.3 : on n'exclut plus les DA cash de la liste pending
      // (le PI peut être 1ʳᵉ étape sur cash_advance).
      expect(args.where.requestType).toBeUndefined();
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

  // ====================================================================
  //  CASH WORKFLOWS (sprint 2.3)
  // ====================================================================
  describe('cash workflows', () => {
    const caissier: AuthenticatedUser = {
      id: 'cas-sub', email: 'cas@x', fullName: 'CAS', roles: ['CAISSIER'],
    };

    describe('petty_cash : 1 étape (CAISSIER seule)', () => {
      it('caissier approve → APPROVED direct + balance décrémentée', async () => {
        const pr = makePr({
          requestType: 'petty_cash',
          status: PrStatus.pending_caissier,
          cashBoxId: 'cb-1',
          totalAmount: new Prisma.Decimal('45000'),
        });
        prisma.purchaseRequest.findUnique.mockResolvedValue(pr);
        prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'CAISSIER' }));
        prisma.purchaseRequest.update.mockResolvedValue({ ...pr, status: PrStatus.approved });

        const res = await svc.approveCurrentStep(caissier, prId);
        expect(res.pr.status).toBe(PrStatus.approved);
        expect(res.nextStepRole).toBeNull();
        expect(prisma.cashBox.update).toHaveBeenCalledWith({
          where: { id: 'cb-1' },
          data: { currentBalance: { decrement: 45000 } },
        });
      });

      it('DAF cannot approve a petty_cash → 403 PR_NOT_AWAITING_YOU', async () => {
        prisma.purchaseRequest.findUnique.mockResolvedValue(
          makePr({ requestType: 'petty_cash', status: PrStatus.pending_caissier }),
        );
        prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'CAISSIER' }));
        await expect(svc.approveCurrentStep(daf, prId)).rejects.toBeInstanceOf(
          PrNotAwaitingYouException,
        );
      });

      it('caissier reject → REJECTED with reason', async () => {
        const pr = makePr({ requestType: 'petty_cash', status: PrStatus.pending_caissier });
        prisma.purchaseRequest.findUnique.mockResolvedValue(pr);
        prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'CAISSIER' }));
        prisma.purchaseRequest.update.mockResolvedValue({
          ...pr,
          status: PrStatus.rejected,
          rejectionReason: 'Justificatif manquant',
        });
        const res = await svc.rejectCurrentStep(caissier, prId, 'Justificatif manquant');
        expect(res.status).toBe(PrStatus.rejected);
      });

      it('insufficient funds → CASH_BOX_INSUFFICIENT_FUNDS (no decrement)', async () => {
        const pr = makePr({
          requestType: 'petty_cash',
          status: PrStatus.pending_caissier,
          cashBoxId: 'cb-1',
          totalAmount: new Prisma.Decimal('600000'),
        });
        prisma.purchaseRequest.findUnique.mockResolvedValue(pr);
        prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'CAISSIER' }));
        prisma.cashBox.findUnique.mockResolvedValue({
          id: 'cb-1',
          currentBalance: new Prisma.Decimal('50000'),
        });
        const { CashBoxInsufficientFundsException } = await import(
          '../../common/exceptions/business.exception'
        );
        await expect(svc.approveCurrentStep(caissier, prId)).rejects.toBeInstanceOf(
          CashBoxInsufficientFundsException,
        );
        expect(prisma.cashBox.update).not.toHaveBeenCalled();
      });
    });

    describe('cash_advance : 2 étapes (PI → CAISSIER)', () => {
      it('PI approve → next step = CAISSIER, status = pending_caissier', async () => {
        const pr = makePr({
          requestType: 'cash_advance',
          status: PrStatus.pending_pi,
          totalAmount: new Prisma.Decimal('80000'),
          cashBoxId: 'cb-1',
        });
        prisma.purchaseRequest.findUnique.mockResolvedValue(pr);
        prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'PI' }));
        prisma.project.findUnique.mockResolvedValue({ piUserId: piId });
        prisma.purchaseRequest.update.mockResolvedValue({
          ...pr,
          status: PrStatus.pending_caissier,
        });

        const res = await svc.approveCurrentStep(pi, prId);
        expect(res.nextStepRole).toBe('CAISSIER');
        expect(res.pr.status).toBe(PrStatus.pending_caissier);
        expect(prisma.approvalStep.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ approverRole: 'CAISSIER', status: 'pending' }),
        });
      });

      it('CAISSIER approve (after PI) → APPROVED + balance décrémentée', async () => {
        const pr = makePr({
          requestType: 'cash_advance',
          status: PrStatus.pending_caissier,
          totalAmount: new Prisma.Decimal('80000'),
          cashBoxId: 'cb-1',
        });
        prisma.purchaseRequest.findUnique.mockResolvedValue(pr);
        prisma.approvalStep.findFirst.mockResolvedValue(makeStep({ approverRole: 'CAISSIER', stepOrder: 2 }));
        prisma.purchaseRequest.update.mockResolvedValue({ ...pr, status: PrStatus.approved });
        const res = await svc.approveCurrentStep(caissier, prId);
        expect(res.nextStepRole).toBeNull();
        expect(prisma.cashBox.update).toHaveBeenCalledWith({
          where: { id: 'cb-1' },
          data: { currentBalance: { decrement: 80000 } },
        });
      });
    });

    describe('settleCashAdvance', () => {
      const settledFakePr = makePr({
        requestType: 'cash_advance',
        status: PrStatus.approved,
        totalAmount: new Prisma.Decimal('100000'),
        cashBoxId: 'cb-1',
      });

      it('variance négative (reliquat) crédite la caisse', async () => {
        prisma.purchaseRequest.findUnique.mockResolvedValue(settledFakePr);
        prisma.cashSettlement.findUnique.mockResolvedValue(null);
        prisma.cashSettlement.create.mockResolvedValue({
          id: 'st-1',
          purchaseRequestId: prId,
          actualSpent: new Prisma.Decimal('80000'),
          variance: new Prisma.Decimal('-20000'),
          justifications: 'Hôtel moins cher',
          settledBy: 'cas-app',
          settledAt: new Date('2026-05-16T12:00:00Z'),
        });
        prisma.purchaseRequest.update.mockResolvedValue({
          ...settledFakePr,
          status: PrStatus.settled,
        });

        const res = await svc.settleCashAdvance(caissier, prId, {
          actualSpent: 80000,
          justifications: 'Hôtel moins cher',
        });
        expect(res.pr.status).toBe(PrStatus.settled);
        expect(prisma.cashBox.update).toHaveBeenCalledWith({
          where: { id: 'cb-1' },
          data: { currentBalance: { increment: 20000 } },
        });
      });

      it('variance positive ne re-décrémente PAS la caisse', async () => {
        prisma.purchaseRequest.findUnique.mockResolvedValue(settledFakePr);
        prisma.cashSettlement.findUnique.mockResolvedValue(null);
        prisma.cashSettlement.create.mockResolvedValue({
          id: 'st-2',
          purchaseRequestId: prId,
          actualSpent: new Prisma.Decimal('120000'),
          variance: new Prisma.Decimal('20000'),
          justifications: null,
          settledBy: 'cas-app',
          settledAt: new Date(),
        });
        prisma.purchaseRequest.update.mockResolvedValue({
          ...settledFakePr,
          status: PrStatus.settled,
        });
        await svc.settleCashAdvance(caissier, prId, { actualSpent: 120000 });
        expect(prisma.cashBox.update).not.toHaveBeenCalled();
      });

      it('refuse si DA standard → PR_TYPE_MISMATCH', async () => {
        prisma.purchaseRequest.findUnique.mockResolvedValue(makePr({ requestType: 'standard' }));
        const { PrTypeMismatchException } = await import(
          '../../common/exceptions/business.exception'
        );
        await expect(
          svc.settleCashAdvance(caissier, prId, { actualSpent: 100 }),
        ).rejects.toBeInstanceOf(PrTypeMismatchException);
      });

      it('refuse si statut ≠ approved → PR_NOT_APPROVED_FOR_SETTLE', async () => {
        prisma.purchaseRequest.findUnique.mockResolvedValue(
          makePr({ requestType: 'cash_advance', status: PrStatus.pending_pi }),
        );
        const { PrNotApprovedForSettleException } = await import(
          '../../common/exceptions/business.exception'
        );
        await expect(
          svc.settleCashAdvance(caissier, prId, { actualSpent: 100 }),
        ).rejects.toBeInstanceOf(PrNotApprovedForSettleException);
      });

      it('refuse settle déjà existant → PR_ALREADY_SETTLED', async () => {
        prisma.purchaseRequest.findUnique.mockResolvedValue(settledFakePr);
        prisma.cashSettlement.findUnique.mockResolvedValue({ id: 'st-existing' });
        const { PrAlreadySettledException } = await import(
          '../../common/exceptions/business.exception'
        );
        await expect(
          svc.settleCashAdvance(caissier, prId, { actualSpent: 100 }),
        ).rejects.toBeInstanceOf(PrAlreadySettledException);
      });
    });

    describe('pending-my-approval (CAISSIER)', () => {
      it('CAISSIER sees pending_caissier only', async () => {
        prisma.purchaseRequest.findMany.mockResolvedValue([]);
        prisma.purchaseRequest.count.mockResolvedValue(0);
        await svc.getMyPendingApprovals(caissier, { page: 1, pageSize: 20 });
        const args = prisma.purchaseRequest.findMany.mock.calls[0][0];
        expect(args.where.status.in).toEqual([PrStatus.pending_caissier]);
      });
    });
  });
});
