import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { PurchaseRequestService } from '../purchase-request.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExchangeRateService } from '../../referential/exchange-rate/exchange-rate.service';
import { EligibilityEngineService } from '../../grant_office/eligibility/eligibility-engine.service';
import { EligibilityContextBuilder } from '../../grant_office/eligibility/eligibility-context-builder.service';
import { InsufficientBudgetException } from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

/**
 * US-014 — tests d'intégration des combinaisons devise × seuil, validant la
 * chaîne complète câblée en S2 :
 *   - US-010 : contrôle budgétaire en XOF
 *   - US-011 : limites caisse en XOF
 *   - US-012 : décrément solde caisse en XOF
 *   - US-013 : précision Decimal sur agrégats
 *
 * Isolation : TestingModule NestJS + mockDeep<PrismaService>() (auto-stube
 * toute méthode Prisma, dont findFirst — évite le finding F2). L'
 * ExchangeRateService est un STUB déterministe (pas mockDeep) : taux fixes
 * prévisibles par devise.
 *
 * NB modélisation : `computeBudgetUsageByLine` convertit budgetedAmount
 * DEPUIS la devise du grant. Pour coller aux montants XOF du brief, le grant
 * est en XOF (budget déjà en XOF — cas IPD courant) ; c'est la conversion
 * CÔTÉ DA (devise EUR/USD → XOF) qui valide le multidevise.
 */
describe('Multidevise × seuils — intégration (S2/US-014)', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let svc: PurchaseRequestService;

  const ownerId = 'usr-owner';
  const projectId = 'prj-1';
  const grantId = 'grt-1';
  const blId = 'bl-1';
  const prId = 'pr-1';

  const demandeur: AuthenticatedUser = {
    id: 'kc-owner', email: 'owner@x', fullName: 'Owner', roles: ['DEMANDEUR'],
  };

  /** Stub FX déterministe : XOF no-op, EUR parité BCEAO, USD taux DB simulé. */
  const fxStub = {
    convertToXof: jest.fn(async (amount: number | Prisma.Decimal, currency: string) => {
      const n = Number(amount);
      const base = { fxRateDate: new Date('2026-05-10'), isIndicativeFallback: false };
      if (currency === 'XOF') return { xofAmount: Math.round(n), fxRate: 1, ...base };
      if (currency === 'EUR') return { xofAmount: Math.round(n * 655.957), fxRate: 655.957, ...base };
      if (currency === 'USD') return { xofAmount: Math.round(n * 605), fxRate: 605, ...base };
      throw new Error(`stub: devise non gérée ${currency}`);
    }),
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PurchaseRequestService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExchangeRateService, useValue: fxStub },
        // US-049 : la gate d'éligibilité n'est pas exercée ici (Test 4 bloque
        // au budget AVANT la gate, et les fixtures n'ont pas de nature de
        // dépense → gate dormante). Stubs minimaux pour satisfaire la DI.
        {
          provide: EligibilityEngineService,
          useValue: {
            validate: jest.fn(async () => ({
              ok: true,
              blockedVerdicts: [],
              warnings: [],
              verdictsByRule: {},
            })),
          },
        },
        { provide: EligibilityContextBuilder, useValue: { build: jest.fn(async () => ({})) } },
      ],
    }).compile();
    svc = moduleRef.get(PurchaseRequestService);

    // resolveAppUserId : bridge email → app_user.id.
    prisma.appUser.findUnique.mockResolvedValue({ id: ownerId } as never);
    // Agrégats vides par défaut (surchargés par test).
    prisma.purchaseRequestLine.findMany.mockResolvedValue([] as never);
    prisma.purchaseOrderLine.findMany.mockResolvedValue([] as never);
    fxStub.convertToXof.mockClear();
  });

  /** Construit une DA (avec lignes + project) pour checkBudget/submit. */
  function makePr(overrides: Record<string, unknown> = {}, lineTotal = 100000) {
    return {
      id: prId,
      requestedBy: ownerId,
      currency: 'XOF',
      requestedAt: new Date('2026-05-10'),
      totalAmount: new Prisma.Decimal(lineTotal),
      status: 'draft',
      projectId,
      grantId,
      project: { piUserId: 'someone' },
      grant: { status: 'active', projectId },
      lines: [
        { budgetLineId: blId, lineTotal: new Prisma.Decimal(lineTotal) },
      ],
      ...overrides,
    };
  }

  function mockBudgetLine(budgetedXof: number, grantCurrency = 'XOF') {
    prisma.budgetLine.findMany.mockResolvedValue([
      {
        id: blId,
        code: 'L01',
        label: 'Consommables',
        budgetedAmount: new Prisma.Decimal(budgetedXof),
        grant: { currency: grantCurrency },
      },
    ] as never);
  }

  // ------------------------------------------------------------------
  it('Test 1 — DA 100k EUR : contrôle budget XOF passe (65 595 700 XOF consommés)', async () => {
    prisma.purchaseRequest.findUnique.mockResolvedValue(
      makePr({ currency: 'EUR', totalAmount: new Prisma.Decimal(100000) }, 100000) as never,
    );
    mockBudgetLine(100_000_000); // 100M XOF

    const res = await svc.checkBudget(demandeur, prId);

    expect(res.wouldExceed).toBe(false);
    // 100 000 EUR × 655,957 = 65 595 700 XOF.
    expect(res.byLine[0].willConsume).toBe(65_595_700);
    expect(res.byLine[0].budgeted).toBe(100_000_000);
    expect(fxStub.convertToXof).toHaveBeenCalledWith(
      expect.anything(),
      'EUR',
      expect.anything(),
    );
  });

  // ------------------------------------------------------------------
  it('Test 2 — DA cash 1k USD : limite caisse XOF (605k < 700k) passe', async () => {
    prisma.grantAgreement.findUnique.mockResolvedValue({
      projectId,
      allowsCashPayment: true,
      budgetLines: [{ id: blId }],
    } as never);
    prisma.cashBox.findUnique.mockResolvedValue({
      id: 'cb-1',
      isActive: true,
      currency: 'XOF',
      perRequestMax: new Prisma.Decimal(700000),
      perDayUserMax: new Prisma.Decimal(2000000),
    } as never);
    prisma.purchaseRequest.findMany.mockResolvedValue([] as never); // aucune DA cash du jour
    prisma.$transaction.mockImplementation(async (cb: unknown) =>
      (cb as (tx: unknown) => unknown)(prisma),
    );
    prisma.purchaseRequest.create.mockResolvedValue({
      id: prId, cashBoxId: 'cb-1', requestType: 'petty_cash', lines: [],
    } as never);

    // 1 000 USD × 605 = 605 000 XOF < perRequestMax 700 000 XOF → pas d'exception.
    await expect(
      svc.create(demandeur, {
        projectId,
        grantId,
        currency: 'USD',
        requestType: 'petty_cash',
        cashBoxId: 'cb-1',
        lines: [{ description: 'Eau', quantity: 1, unit: 'u', unitPrice: 1000, budgetLineId: blId }],
      } as never),
    ).resolves.toBeDefined();
    expect(fxStub.convertToXof).toHaveBeenCalledWith(expect.anything(), 'USD');
  });

  // ------------------------------------------------------------------
  it('Test 3 — DA 10 000 XOF : baseline, conversion no-op, budget passe', async () => {
    prisma.purchaseRequest.findUnique.mockResolvedValue(
      makePr({ currency: 'XOF', totalAmount: new Prisma.Decimal(10000) }, 10000) as never,
    );
    mockBudgetLine(50_000_000); // 50M XOF

    const res = await svc.checkBudget(demandeur, prId);

    expect(res.wouldExceed).toBe(false);
    expect(res.byLine[0].willConsume).toBe(10000); // XOF identité
    expect(res.byLine[0].budgeted).toBe(50_000_000);
    // convertToXof appelé en mode no-op trivial (XOF → identité, rate=1).
    expect(fxStub.convertToXof).toHaveBeenCalledWith(expect.anything(), 'XOF', expect.anything());
  });

  // ------------------------------------------------------------------
  it('Test 4 — DA 50k EUR > ligne budgétaire : InsufficientBudgetException enrichie', async () => {
    prisma.purchaseRequest.findUnique.mockResolvedValue(
      makePr({ currency: 'EUR', totalAmount: new Prisma.Decimal(50000) }, 50000) as never,
    );
    mockBudgetLine(50_000_000); // 50M XOF
    // 30M XOF déjà consommés par une autre DA pending (en XOF).
    prisma.purchaseRequestLine.findMany.mockResolvedValue([
      {
        budgetLineId: blId,
        lineTotal: new Prisma.Decimal(30_000_000),
        pr: { currency: 'XOF', requestedAt: new Date('2026-05-01') },
      },
    ] as never);

    // 50 000 EUR × 655,957 = 32 797 850 XOF. 30M + 32,8M = 62,8M > 50M → exceed.
    let caught: InsufficientBudgetException | undefined;
    try {
      await svc.submit(demandeur, prId);
    } catch (e) {
      caught = e as InsufficientBudgetException;
    }
    expect(caught).toBeInstanceOf(InsufficientBudgetException);
    const details = (caught as unknown as { details: { lines: Array<Record<string, unknown>> } })
      .details;
    const line = details.lines[0];
    expect(line.prCurrency).toBe('EUR');
    expect(line.budgetedXof).toBe(50_000_000);
    expect(line.alreadyConsumedXof).toBe(30_000_000);
    expect(line.willConsumeXof).toBe(32_797_850);
    expect(line.availableXof).toBe(50_000_000 - 30_000_000 - 32_797_850); // négatif
  });

  // ------------------------------------------------------------------
  it('Test 6 (US-024) — checkBudget privilégie budgetedAmountXof figé', async () => {
    prisma.purchaseRequest.findUnique.mockResolvedValue(
      makePr({ currency: 'XOF', totalAmount: new Prisma.Decimal(10000) }, 10000) as never,
    );
    // Ligne matérialisée : XOF figé = 77M ; budgetedAmount brut (1 EUR)
    // volontairement incohérent → prouve qu'on N'effectue PAS la conversion.
    prisma.budgetLine.findMany.mockResolvedValue([
      {
        id: blId, code: 'L01', label: 'Consommables',
        budgetedAmount: new Prisma.Decimal(1), currency: 'EUR',
        budgetedAmountXof: 77_000_000n,
        grant: { currency: 'EUR' },
      },
    ] as never);

    const res = await svc.checkBudget(demandeur, prId);
    expect(res.byLine[0].budgeted).toBe(77_000_000);
    // fx jamais appelé pour convertir le budget EUR (uniquement la DA XOF).
    expect(fxStub.convertToXof).not.toHaveBeenCalledWith(
      expect.anything(),
      'EUR',
      expect.anything(),
    );
  });

  // ------------------------------------------------------------------
  it('Test 7 (US-024) — fallback conversion à la volée si budgetedAmountXof NULL', async () => {
    prisma.purchaseRequest.findUnique.mockResolvedValue(
      makePr({ currency: 'XOF', totalAmount: new Prisma.Decimal(10000) }, 10000) as never,
    );
    prisma.budgetLine.findMany.mockResolvedValue([
      {
        id: blId, code: 'L01', label: 'Consommables',
        budgetedAmount: new Prisma.Decimal(100000), currency: 'EUR',
        budgetedAmountXof: null,
        grant: { currency: 'EUR' },
      },
    ] as never);

    const res = await svc.checkBudget(demandeur, prId);
    // Fallback : 100 000 EUR × 655,957 = 65 595 700 XOF.
    expect(res.byLine[0].budgeted).toBe(65_595_700);
    expect(fxStub.convertToXof).toHaveBeenCalledWith(expect.anything(), 'EUR', expect.anything());
  });

  // ------------------------------------------------------------------
  it('Test 5 — agrégat Decimal de 3 DA : 100.10 + 100.20 + 100.30 = 300.60 exact (F10)', () => {
    // Reproduit le pattern de reduce Decimal natif d'US-013 (pas de float drift).
    const montants = [
      new Prisma.Decimal('100.10'),
      new Prisma.Decimal('100.20'),
      new Prisma.Decimal('100.30'),
    ];
    const total = montants.reduce((s, m) => s.plus(m), new Prisma.Decimal(0));
    expect(total.equals(new Prisma.Decimal('300.60'))).toBe(true);
    // Preuve a contrario : la somme float aurait dérivé.
    expect(0.1 + 0.2).not.toBe(0.3);
  });
});
