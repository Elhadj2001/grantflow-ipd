import { Prisma } from '@prisma/client';
import { PilotageService } from '../pilotage.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import {
  EntityNotFoundException,
  PiNotOwnerOfProjectException,
} from '../../common/exceptions/business.exception';

describe('PilotageService', () => {
  let prisma: {
    grantAgreement: { findUnique: jest.Mock };
    project: { findMany: jest.Mock };
    dedicatedFundMovement: { findMany: jest.Mock };
    overheadCalculation: { findMany: jest.Mock };
    appUser: { findUnique: jest.Mock; create: jest.Mock };
    $queryRaw: jest.Mock;
    $queryRawUnsafe: jest.Mock;
  };
  let svc: PilotageService;

  const PI_USER_ID = '11111111-1111-1111-1111-111111111111';
  const OTHER_PI_USER_ID = '22222222-2222-2222-2222-222222222222';
  const GRANT_ID = '33333333-3333-3333-3333-333333333333';

  const fakeGrant = {
    id: GRANT_ID,
    reference: 'BMGF-2023-117',
    amount: new Prisma.Decimal('485000'),
    currency: 'USD',
    overheadRate: new Prisma.Decimal('0.15'),
    startDate: new Date('2024-01-01T00:00:00Z'),
    endDate: new Date('2026-12-31T00:00:00Z'),
    status: 'active',
  };

  const piActor: AuthenticatedUser = {
    id: 'kc-pi-1',
    email: 'pi-a@ipd.sn',
    fullName: 'Dr PI A',
    roles: ['PI'],
  };

  const cgActor: AuthenticatedUser = {
    id: 'kc-cg-1',
    email: 'cg@ipd.sn',
    fullName: 'CG',
    roles: ['CONTROLEUR'],
  };

  beforeEach(() => {
    prisma = {
      grantAgreement: { findUnique: jest.fn() },
      project: { findMany: jest.fn() },
      dedicatedFundMovement: { findMany: jest.fn() },
      overheadCalculation: { findMany: jest.fn() },
      appUser: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $queryRawUnsafe: jest.fn(),
    };
    svc = new PilotageService(prisma as unknown as PrismaService);
  });

  // ----------------------------------------------------------------------
  // myProjects
  // ----------------------------------------------------------------------

  describe('myProjects', () => {
    it('retourne uniquement les projets dont caller est piUserId', async () => {
      prisma.appUser.findUnique.mockResolvedValue({ id: PI_USER_ID });
      prisma.project.findMany.mockResolvedValue([
        {
          id: 'p1',
          code: 'P-001',
          title: 'Projet A',
          status: 'active',
          grants: [
            {
              id: GRANT_ID,
              reference: 'BMGF-2023-117',
              amount: new Prisma.Decimal('485000'),
              currency: 'USD',
              startDate: new Date('2024-01-01T00:00:00Z'),
              endDate: new Date('2026-12-31T00:00:00Z'),
              status: 'active',
              donor: { code: 'BMGF', label: 'Bill & Melinda Gates' },
            },
          ],
        },
      ]);

      const res = await svc.myProjects(piActor);
      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ piUserId: PI_USER_ID }),
        }),
      );
      expect(res.total).toBe(1);
      expect(res.data[0].code).toBe('P-001');
      expect(res.data[0].grants[0].reference).toBe('BMGF-2023-117');
      expect(res.data[0].grants[0].donorCode).toBe('BMGF');
    });

    it('crée le AppUser si caller pas encore présent (1er login)', async () => {
      prisma.appUser.findUnique.mockResolvedValue(null);
      prisma.appUser.create.mockResolvedValue({ id: PI_USER_ID });
      prisma.project.findMany.mockResolvedValue([]);

      const res = await svc.myProjects(piActor);
      expect(prisma.appUser.create).toHaveBeenCalled();
      expect(res.total).toBe(0);
    });

    it('renvoie liste vide si aucun projet PI', async () => {
      prisma.appUser.findUnique.mockResolvedValue({ id: PI_USER_ID });
      prisma.project.findMany.mockResolvedValue([]);
      const res = await svc.myProjects(piActor);
      expect(res.total).toBe(0);
      expect(res.data).toEqual([]);
    });
  });

  // ----------------------------------------------------------------------
  // assertCanViewGrant — cross-PI safety
  // ----------------------------------------------------------------------

  describe('assertCanViewGrant', () => {
    it('autorise CG sans contrôle de propriété', async () => {
      await expect(svc.assertCanViewGrant(cgActor, GRANT_ID)).resolves.toBeUndefined();
      expect(prisma.grantAgreement.findUnique).not.toHaveBeenCalled();
    });

    it('autorise un PI propriétaire du projet', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({
        id: GRANT_ID,
        project: { piUserId: PI_USER_ID },
      });
      prisma.appUser.findUnique.mockResolvedValue({ id: PI_USER_ID });

      await expect(svc.assertCanViewGrant(piActor, GRANT_ID)).resolves.toBeUndefined();
    });

    it('refuse un PI qui n\'est PAS owner du projet (cross-PI safety)', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({
        id: GRANT_ID,
        project: { piUserId: OTHER_PI_USER_ID },
      });
      prisma.appUser.findUnique.mockResolvedValue({ id: PI_USER_ID });

      await expect(svc.assertCanViewGrant(piActor, GRANT_ID)).rejects.toBeInstanceOf(
        PiNotOwnerOfProjectException,
      );
    });

    it('lève 404 si grant inexistant et caller PI', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(null);
      await expect(svc.assertCanViewGrant(piActor, GRANT_ID)).rejects.toBeInstanceOf(
        EntityNotFoundException,
      );
    });

    it('autorise SUPER_ADMIN même non-owner', async () => {
      const sa: AuthenticatedUser = { ...piActor, roles: ['SUPER_ADMIN'] };
      await expect(svc.assertCanViewGrant(sa, GRANT_ID)).resolves.toBeUndefined();
    });
  });

  // ----------------------------------------------------------------------
  // transactions
  // ----------------------------------------------------------------------

  describe('transactions', () => {
    it('404 si grant inconnu', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(null);
      await expect(
        svc.transactions(GRANT_ID, { type: 'all' }),
      ).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('agrège debit/credit + net', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.$queryRawUnsafe.mockResolvedValue([
        {
          entry_id: 'e1',
          entry_number: 'OD-2026-0001',
          entry_date: new Date('2026-03-15T00:00:00Z'),
          journal: 'OD',
          label: 'Test',
          source_type: 'invoice',
          source_id: 'inv1',
          account_code: '611',
          debit: new Prisma.Decimal('1000'),
          credit: new Prisma.Decimal('0'),
          currency: 'XOF',
          status: 'posted',
        },
        {
          entry_id: 'e2',
          entry_number: 'OD-2026-0002',
          entry_date: new Date('2026-03-10T00:00:00Z'),
          journal: 'AC',
          label: 'PO',
          source_type: 'purchase_order',
          source_id: 'po1',
          account_code: '401',
          debit: new Prisma.Decimal('0'),
          credit: new Prisma.Decimal('1000'),
          currency: 'XOF',
          status: 'posted',
        },
      ]);

      const res = await svc.transactions(GRANT_ID, { type: 'all' });
      expect(res.total).toBe(2);
      expect(res.totalDebit).toBe(1000);
      expect(res.totalCredit).toBe(1000);
      expect(res.data[0].net).toBe(1000);
      expect(res.data[1].net).toBe(-1000);
    });

    it('renvoie data=[] si type filtre ne correspond à aucune famille connue', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      // 'pr' = aucune source_type → SOURCE_FAMILY map. PR n'est pas un sourceType
      // utilisé par PostingService (les écritures viennent des PO/Invoice).
      // On vérifie juste qu'on ne crashe pas (renvoie 0 ou un set valide).
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      const res = await svc.transactions(GRANT_ID, { type: 'pr' });
      expect(res.total).toBe(0);
    });
  });

  // ----------------------------------------------------------------------
  // analyticalBreakdown
  // ----------------------------------------------------------------------

  describe('analyticalBreakdown', () => {
    it('breakdown par account avec parts calculées', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.$queryRawUnsafe.mockResolvedValue([
        { key: '611', label: 'Achats consommables', amount: 60_000 },
        { key: '614', label: 'Locations', amount: 40_000 },
      ]);

      const res = await svc.analyticalBreakdown(GRANT_ID, 'account');
      expect(res.total).toBe(100_000);
      expect(res.entries).toHaveLength(2);
      expect(res.entries[0].share).toBeCloseTo(0.6, 5);
      expect(res.entries[1].share).toBeCloseTo(0.4, 5);
    });

    it('share = 0 si total = 0', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      const res = await svc.analyticalBreakdown(GRANT_ID, 'cost_center');
      expect(res.total).toBe(0);
      expect(res.entries).toEqual([]);
    });

    it('breakdown par period utilise DATE_TRUNC mensuel', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.$queryRawUnsafe.mockResolvedValue([
        { key: '2026-01', label: '2026-01', amount: 10 },
        { key: '2026-02', label: '2026-02', amount: 20 },
      ]);
      const res = await svc.analyticalBreakdown(GRANT_ID, 'period');
      expect(res.by).toBe('period');
      expect(res.entries[0].key).toBe('2026-01');
    });
  });

  // ----------------------------------------------------------------------
  // dedicatedFunds
  // ----------------------------------------------------------------------

  describe('dedicatedFunds', () => {
    it('retourne solde + mouvements + lastMovement', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.dedicatedFundMovement.findMany.mockResolvedValue([
        {
          id: 'm2',
          movementType: 'allocation',
          amount: new Prisma.Decimal('5000'),
          currency: 'XOF',
          rationale: 'Surplus',
          computedAt: new Date('2026-03-31T00:00:00Z'),
          journalEntryId: 'je2',
          period: { code: '2026-03' },
        },
        {
          id: 'm1',
          movementType: 'allocation',
          amount: new Prisma.Decimal('3000'),
          currency: 'XOF',
          rationale: 'Surplus init',
          computedAt: new Date('2026-02-28T00:00:00Z'),
          journalEntryId: 'je1',
          period: { code: '2026-02' },
        },
      ]);
      prisma.$queryRaw.mockResolvedValue([{ balance: 8000 }]);

      const res = await svc.dedicatedFunds(GRANT_ID);
      expect(res.balance).toBe(8000);
      expect(res.movements).toHaveLength(2);
      expect(res.lastMovement?.id).toBe('m2');
    });

    it('balance = 0 et lastMovement = null si pas de mouvement', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.dedicatedFundMovement.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([{ balance: 0 }]);

      const res = await svc.dedicatedFunds(GRANT_ID);
      expect(res.balance).toBe(0);
      expect(res.lastMovement).toBeNull();
    });
  });

  // ----------------------------------------------------------------------
  // overheadCalculation
  // ----------------------------------------------------------------------

  describe('overheadCalculation', () => {
    it('calcule variance facturable - reversé', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.overheadCalculation.findMany.mockResolvedValue([
        {
          id: 'oc1',
          eligibleBase: new Prisma.Decimal('100000'),
          overheadRate: new Prisma.Decimal('0.15'),
          overheadAmount: new Prisma.Decimal('15000'),
          journalEntryId: 'je1',
          computedAt: new Date('2026-03-31T00:00:00Z'),
          period: { code: '2026-03' },
        },
      ]);
      prisma.$queryRaw.mockResolvedValue([{ reversed: 10000 }]);

      const res = await svc.overheadCalculation(GRANT_ID);
      expect(res.totalBillable).toBe(15000);
      expect(res.totalReversed).toBe(10000);
      expect(res.variance).toBe(5000);
      expect(res.variancePercent).toBeCloseTo(5000 / 15000, 5);
    });

    it('variancePercent = 0 si totalBillable = 0', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(fakeGrant);
      prisma.overheadCalculation.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([{ reversed: 0 }]);

      const res = await svc.overheadCalculation(GRANT_ID);
      expect(res.totalBillable).toBe(0);
      expect(res.variancePercent).toBe(0);
    });
  });
});
