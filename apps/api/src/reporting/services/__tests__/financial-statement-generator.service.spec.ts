import { FinancialStatementGeneratorService } from '../financial-statement-generator.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { FinancialStatementNotBalancedException } from '../../../common/exceptions/business.exception';

describe('FinancialStatementGeneratorService', () => {
  let prisma: { $queryRaw: jest.Mock };
  let svc: FinancialStatementGeneratorService;
  const period = { id: 'p1', code: '2026-01' };

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    svc = new FinancialStatementGeneratorService(prisma as unknown as PrismaService);
  });

  // ---- balanced helper (charges 6 / produits 7 / 689 / 789 / 401 / 521 / 12)
  const balancedBookSet = [
    // Actif / dépôt banque (5xx débiteur)
    { account_code: '521', account_label: 'Banque', account_class: '5', total_debit: 2000, total_credit: 0, balance: 2000 },
    // Charge personnel
    { account_code: '661', account_label: 'Rémunérations', account_class: '6', total_debit: 500, total_credit: 0, balance: 500 },
    // Dotation fonds dédiés
    { account_code: '689', account_label: 'Dotations FD', account_class: '6', total_debit: 300, total_credit: 0, balance: 300 },
    // Produit subvention (créditeur → balance = -1500 par sens d-c)
    { account_code: '754', account_label: 'Subventions', account_class: '7', total_debit: 0, total_credit: 1500, balance: -1500 },
    // Reprise fonds (créditeur)
    { account_code: '789', account_label: 'Reprises FD', account_class: '7', total_debit: 0, total_credit: 200, balance: -200 },
    // Passif fonds dédiés (1xx créditeur)
    { account_code: '19', account_label: 'Fonds dédiés', account_class: '1', total_debit: 0, total_credit: 800, balance: -800 },
    // Passif fournisseurs (créditeur)
    { account_code: '401', account_label: 'Fournisseurs', account_class: '4', total_debit: 0, total_credit: 300, balance: -300 },
  ];

  // ----------------------------------------------------------------- generateTer

  describe('generateTer', () => {
    it('groups EMPLOIS = charges 6 + reprise 789, RESSOURCES = produits 7 + dotation 689', async () => {
      const r = svc.generateTer(period, balancedBookSet as never);
      const emplois = r.lines.filter((l) => l.section === 'EMPLOIS');
      const ressources = r.lines.filter((l) => l.section === 'RESSOURCES');
      const emploisCodes = emplois.map((l) => l.accountCode).sort();
      expect(emploisCodes).toEqual(['661', '789']);
      const ressourcesCodes = ressources.map((l) => l.accountCode).sort();
      expect(ressourcesCodes).toEqual(['689', '754']);
    });

    it('shows 689 as RESSOURCES (positive)', async () => {
      const r = svc.generateTer(period, balancedBookSet as never);
      const dotation = r.lines.find((l) => l.accountCode === '689');
      expect(dotation?.section).toBe('RESSOURCES');
      expect(dotation?.balance).toBe(300);
    });

    it('shows 789 as EMPLOIS with reprise label', async () => {
      const r = svc.generateTer(period, balancedBookSet as never);
      const reprise = r.lines.find((l) => l.accountCode === '789');
      expect(reprise?.section).toBe('EMPLOIS');
      expect(reprise?.label).toContain('reprise');
      expect(reprise?.balance).toBe(200);
    });

    it('marks balanced=true when emplois = ressources', async () => {
      // EMPLOIS = 500 (661) + 200 (789) = 700
      // RESSOURCES = 1500 (754) + 300 (689) = 1800
      // Pas équilibré dans ce dataset — on construit un dataset équilibré
      const balanced = [
        { account_code: '661', account_label: 'X', account_class: '6', total_debit: 100, total_credit: 0, balance: 100 },
        { account_code: '754', account_label: 'Y', account_class: '7', total_debit: 0, total_credit: 100, balance: -100 },
      ];
      const r = svc.generateTer(period, balanced as never);
      expect(r.totals.balanced).toBe(true);
      expect(r.totals.leftTotal).toBe(100);
      expect(r.totals.rightTotal).toBe(100);
    });

    it('marks balanced=false when difference > tolerance', async () => {
      const r = svc.generateTer(period, balancedBookSet as never);
      expect(r.totals.balanced).toBe(false);
      expect(r.totals.leftTotal).not.toBe(r.totals.rightTotal);
    });

    it('returns type=TER and propagates periodId', async () => {
      const r = svc.generateTer(period, balancedBookSet as never);
      expect(r.type).toBe('TER');
      expect(r.periodId).toBe('p1');
    });
  });

  // ----------------------------------------------------------------- generateBilan

  describe('generateBilan', () => {
    it('classifies 5xx débiteur as ACTIF, 1xx + 401 créditeur as PASSIF', async () => {
      const r = svc.generateBilan(period, balancedBookSet as never);
      const actif = r.lines.filter((l) => l.section === 'ACTIF').map((l) => l.accountCode);
      const passif = r.lines.filter((l) => l.section === 'PASSIF').map((l) => l.accountCode);
      expect(actif).toContain('521');
      expect(passif).toContain('19');
      expect(passif).toContain('401');
    });

    it('appends résultat net to PASSIF (12)', async () => {
      const r = svc.generateBilan(period, balancedBookSet as never);
      const r12 = r.lines.find((l) => l.accountCode === '12');
      expect(r12).toBeDefined();
      // résultat = produits (1500+200=1700) - charges (500+300=800) = +900
      expect(r12?.balance).toBe(900);
    });

    it('computes totalActif / totalPassif / resultatNet in totals', async () => {
      const r = svc.generateBilan(period, balancedBookSet as never);
      expect(r.totals.totalActif).toBeDefined();
      expect(r.totals.totalPassif).toBeDefined();
      expect(r.totals.resultatNet).toBe(900);
    });
  });

  // ----------------------------------------------------------------- generateResultat

  describe('generateResultat', () => {
    it('lists all 6x as CHARGES (including 689)', async () => {
      const r = svc.generateResultat(period, balancedBookSet as never);
      const charges = r.lines.filter((l) => l.section === 'CHARGES').map((l) => l.accountCode);
      expect(charges).toContain('661');
      expect(charges).toContain('689');
    });

    it('lists all 7x as PRODUITS (including 789)', async () => {
      const r = svc.generateResultat(period, balancedBookSet as never);
      const produits = r.lines.filter((l) => l.section === 'PRODUITS').map((l) => l.accountCode);
      expect(produits).toContain('754');
      expect(produits).toContain('789');
    });

    it('always balanced=true (résultat is the balancing figure)', async () => {
      const r = svc.generateResultat(period, balancedBookSet as never);
      expect(r.totals.balanced).toBe(true);
    });

    it('resultatNet = produits - charges', async () => {
      const r = svc.generateResultat(period, balancedBookSet as never);
      expect(r.totals.resultatNet).toBe(900);
    });

    it('returns no line when 0 amount', async () => {
      const r = svc.generateResultat(period, [
        { account_code: '661', account_label: 'X', account_class: '6', total_debit: 0, total_credit: 0, balance: 0 },
      ] as never);
      expect(r.lines).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------------- assertBalanced

  describe('assertBalanced', () => {
    it('throws FinancialStatementNotBalancedException for unbalanced TER', () => {
      const r = svc.generateTer(period, balancedBookSet as never);
      expect(() => svc.assertBalanced(r)).toThrow(FinancialStatementNotBalancedException);
    });

    it('does not throw for RESULTAT (always balanced)', () => {
      const r = svc.generateResultat(period, balancedBookSet as never);
      expect(() => svc.assertBalanced(r)).not.toThrow();
    });

    it('does not throw for balanced TER (within 1 XOF tolerance)', () => {
      const balanced = [
        { account_code: '661', account_label: 'X', account_class: '6', total_debit: 100, total_credit: 0, balance: 100 },
        { account_code: '754', account_label: 'Y', account_class: '7', total_debit: 0, total_credit: 100.5, balance: -100.5 },
      ];
      const r = svc.generateTer(period, balanced as never);
      expect(() => svc.assertBalanced(r)).not.toThrow();
    });
  });

  // ----------------------------------------------------------------- generate (dispatcher)

  describe('generate (dispatcher)', () => {
    it('dispatches TER / BILAN / RESULTAT', async () => {
      prisma.$queryRaw.mockResolvedValue(balancedBookSet);
      const t = await svc.generate('TER', period);
      const b = await svc.generate('BILAN', period);
      const r = await svc.generate('RESULTAT', period);
      expect(t.type).toBe('TER');
      expect(b.type).toBe('BILAN');
      expect(r.type).toBe('RESULTAT');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    });
  });

  // ----------------------------------------------------------------- loadBalances

  describe('loadBalances', () => {
    it('returns rows from $queryRaw filtered by period_id', async () => {
      prisma.$queryRaw.mockResolvedValue(balancedBookSet);
      const r = await svc.loadBalances('p1');
      expect(r).toEqual(balancedBookSet);
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });
});
