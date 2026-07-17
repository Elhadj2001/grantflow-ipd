import { createPrismaMock, type PrismaMock } from '../../test-utils/prisma-mock';
import { DashboardService } from '../dashboard.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * US-066 — le résumé dashboard agrège les 4 compteurs en un appel, avec le
 * scoping rôle des listes sources (DA propres pour DEMANDEUR, sections
 * comptables à null pour les rôles sans vue comptable).
 */
describe('DashboardService (US-066)', () => {
  let prisma: PrismaMock;
  let svc: DashboardService;
  // `groupBy` est une méthode générique surchargée : mockDeep ne l'expose
  // pas avec la surface jest.Mock typée → cast local unique.
  let groupByMock: jest.Mock;

  const daf: AuthenticatedUser = {
    id: 'kc-daf',
    email: 'daf@x',
    fullName: 'DAF',
    roles: ['DAF'],
  };
  const demandeur: AuthenticatedUser = {
    id: 'kc-dem',
    email: 'd@x',
    fullName: 'Demandeur',
    roles: ['DEMANDEUR'],
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-15T10:00:00Z'));
    prisma = createPrismaMock();
    groupByMock = prisma.purchaseRequest.groupBy as unknown as jest.Mock;
    groupByMock.mockResolvedValue([
      { status: 'pending_pi', _count: { _all: 3 } },
      { status: 'pending_daf', _count: { _all: 2 } },
    ]);
    prisma.invoice.count.mockResolvedValue(4 as never);
    prisma.grantAgreement.count.mockResolvedValue(6 as never);
    prisma.paymentRun.count.mockResolvedValue(1 as never);
    svc = new DashboardService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('DAF (full view) : compteurs globaux, byStatus complet avec zéros, total sommé', async () => {
    const res = await svc.summary(daf);
    expect(res.prPending.total).toBe(5);
    expect(res.prPending.scopedToOwn).toBe(false);
    expect(res.prPending.byStatus).toEqual({
      submitted: 0,
      pending_pi: 3,
      pending_cg: 0,
      pending_daf: 2,
      pending_caissier: 0,
    });
    expect(res.invoicesToMatch).toBe(4);
    expect(res.activeGrants).toBe(6);
    expect(res.paymentsExecutedThisMonth).toBe(1);
    // Full view → PAS de résolution app_user ni de filtre requestedBy.
    expect(prisma.appUser.findUnique).not.toHaveBeenCalled();
    const groupByArgs = groupByMock.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(groupByArgs.where.requestedBy).toBeUndefined();
  });

  it('paiements du mois : fenêtre = 1er du mois courant (runDate gte)', async () => {
    await svc.summary(daf);
    expect(prisma.paymentRun.count).toHaveBeenCalledWith({
      where: {
        status: 'executed',
        runDate: { gte: new Date(Date.UTC(2026, 5, 1)) },
      },
    });
  });

  it('DEMANDEUR : DA scopées à ses propres demandes, sections comptables null', async () => {
    prisma.appUser.findUnique.mockResolvedValue({ id: 'usr-dem' } as never);
    const res = await svc.summary(demandeur);
    expect(res.prPending.scopedToOwn).toBe(true);
    const groupByArgs = groupByMock.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(groupByArgs.where.requestedBy).toBe('usr-dem');
    expect(res.invoicesToMatch).toBeNull();
    expect(res.paymentsExecutedThisMonth).toBeNull();
    expect(res.activeGrants).toBe(6);
    expect(prisma.invoice.count).not.toHaveBeenCalled();
    expect(prisma.paymentRun.count).not.toHaveBeenCalled();
  });

  it('DEMANDEUR inconnu de app_user : zéros, AUCUN auto-provisioning', async () => {
    prisma.appUser.findUnique.mockResolvedValue(null as never);
    const res = await svc.summary(demandeur);
    expect(res.prPending.total).toBe(0);
    expect(res.prPending.scopedToOwn).toBe(true);
    expect(res.activeGrants).toBe(6);
    expect(prisma.appUser.create).not.toHaveBeenCalled();
    expect(prisma.purchaseRequest.groupBy).not.toHaveBeenCalled();
  });

  it('BAILLEUR : conventions actives seulement en données globales, DA scopées', async () => {
    prisma.appUser.findUnique.mockResolvedValue(null as never);
    const bailleur: AuthenticatedUser = {
      id: 'kc-b',
      email: 'b@x',
      fullName: 'Bailleur',
      roles: ['BAILLEUR'],
    };
    const res = await svc.summary(bailleur);
    expect(res.activeGrants).toBe(6);
    expect(res.invoicesToMatch).toBeNull();
    expect(res.paymentsExecutedThisMonth).toBeNull();
    expect(res.prPending.total).toBe(0);
  });
});
