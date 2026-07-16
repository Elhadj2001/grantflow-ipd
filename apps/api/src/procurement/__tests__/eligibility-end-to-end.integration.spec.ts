import { Prisma } from '@prisma/client';
import { PurchaseRequestService } from '../purchase-request.service';
import { ExchangeRateService } from '../../referential/exchange-rate/exchange-rate.service';
import { EligibilityEngineService } from '../../grant_office/eligibility/eligibility-engine.service';
import {
  EligibilityContextBuilder,
  type EligibilityPrInput,
} from '../../grant_office/eligibility/eligibility-context-builder.service';
import type { EligibilityContext } from '../../grant_office/eligibility/eligibility-context';
import { NotFoundException } from '@nestjs/common';
import { NatureAllowedRule } from '../../grant_office/eligibility/rules/nature-allowed.rule';
import { DateWindowRule } from '../../grant_office/eligibility/rules/date-window.rule';
import { LineNotExceededRule } from '../../grant_office/eligibility/rules/line-not-exceeded.rule';
import { LineNatureCoherentRule } from '../../grant_office/eligibility/rules/line-nature-coherent.rule';
import { NotPasteurParisReimbursedRule } from '../../grant_office/eligibility/rules/not-pasteur-paris-reimbursed.rule';
import { NoCrossProjectDuplicateRule } from '../../grant_office/eligibility/rules/no-cross-project-duplicate.rule';
import { PeriodNotClosedRule } from '../../grant_office/eligibility/rules/period-not-closed.rule';
import { EligibilityValidationException } from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { createPrismaMock, type PrismaMock } from '../../test-utils/prisma-mock';

/**
 * US-050 — Tests d'intégration end-to-end de l'EligibilityEngine au niveau
 * PurchaseRequestService.submit(), couvrant le catalogue PPT IPD slide 7
 * « à ne pas faire » (ADR-007, règle d'or n°8).
 *
 * PORTÉE DE L'INTÉGRATION : seuls Prisma (mockDeep via createPrismaMock) et
 * ExchangeRateService sont mockés. Le moteur (EligibilityEngineService), les
 * 7 règles concrètes et le builder de contexte (EligibilityContextBuilder)
 * sont les VRAIES implémentations, traversées par le VRAI submit(). C'est la
 * preuve cliquable que GRANTFLOW IPD enforce ce qui était impossible à
 * enforce dans le couple Excel + Sage.
 *
 * NOTE matérialisation (US-049) — état Sprint S6 :
 *   - PPT-4 (ligne↔nature)   : ✅ RÉSOLU (US-055 + US-056) — le builder lit
 *     ref.budget_line.category en DIRECT (fallback proxy si NULL) → blocage
 *     réel via submit() (cf. test PPT-4 + PPT-4bis).
 *   - PPT-5 (Pasteur Paris)  : pr.pasteurParisReimbursed non transporté par
 *     runEligibilityGate (lecture défensive US-045) — TODO US-057.
 *   - PPT-6 (doublon facture): pr.supplierInvoiceNumber idem (US-046) —
 *     TODO US-057.
 * Pour PPT-5/6, on (a) documente le no-op courant via submit() et (b) PROUVE
 * la mécanique de blocage/warning en invoquant le VRAI moteur sur un
 * contexte matérialisé.
 */
describe('EligibilityEngine integration — PPT IPD slide 7 coverage (US-050)', () => {
  let service: PurchaseRequestService;
  let prisma: PrismaMock;
  let fx: { convertToXof: jest.Mock };
  let engine: EligibilityEngineService;
  let builder: EligibilityContextBuilder;

  // Identifiants stables (le service les traite comme opaques côté mock).
  const ownerId = 'usr-owner';
  const projectId = 'prj-1';
  const grantId = 'grt-1';
  const blId = 'bl-1';
  const prId = 'pr-1';
  const natureId = 'nat-1';

  const demandeur: AuthenticatedUser = {
    id: 'kc-owner',
    email: 'owner@x',
    fullName: 'Owner',
    roles: ['DEMANDEUR'],
  };

  /** Règle d'éligibilité paramétrable (1 entrée par nature). */
  interface RuleFixture {
    expenseNatureId: string;
    maxPerRequestXof: bigint | null;
    maxPerYearXof: bigint | null;
    excluded: boolean;
  }

  /** Paramètres d'un scénario de soumission. Tout est optionnel (défauts = cas nominal vert). */
  interface SubmitCfg {
    currency?: string;
    totalAmount?: number;
    lineTotal?: number;
    requestedAt?: string;
    expenseNatureCode?: string;
    natureCategory?: string;
    /**
     * US-056 : catégorie portée par ref.budget_line.category (US-055).
     * null (défaut) = donnée historique → fallback proxy nature (US-049).
     */
    budgetLineCategory?: string | null;
    grantStart?: string;
    grantEnd?: string;
    activeNoteTechnique?: boolean;
    eligibilityRules?: RuleFixture[];
    budgetedAmountXof?: bigint;
    periodOpen?: boolean;
    invoiceDupes?: number;
    /** Champs additionnels posés sur la DA chargée (ex. flags défensifs). */
    prExtra?: Record<string, unknown>;
  }

  /**
   * Configure tous les mocks Prisma + fx pour un submit() complet et renvoie
   * l'id de la DA. Le contrôle budgétaire (budgetLine.findMany +
   * budgetedAmountXof) est volontairement large → la gate budgétaire passe et
   * c'est bien l'éligibilité qui décide.
   */
  function configureSubmit(cfg: SubmitCfg = {}): string {
    const requestedAt = new Date(cfg.requestedAt ?? '2026-06-15');
    const pr = {
      id: prId,
      prNumber: 'DA-2026-0001',
      requestedBy: ownerId,
      requestedAt,
      status: 'draft',
      projectId,
      grantId,
      currency: cfg.currency ?? 'XOF',
      totalAmount: new Prisma.Decimal(cfg.totalAmount ?? 100_000),
      requestType: 'standard',
      expenseNatureCode: cfg.expenseNatureCode ?? 'OFFICE_SUPPLIES',
      grant: { status: 'active', projectId },
      lines: [
        {
          id: 'l1',
          prId,
          lineNumber: 1,
          budgetLineId: blId,
          lineTotal: new Prisma.Decimal(cfg.lineTotal ?? cfg.totalAmount ?? 100_000),
        },
      ],
      ...cfg.prExtra,
    };
    const budgetedXof = cfg.budgetedAmountXof ?? 100_000_000_000n;

    prisma.purchaseRequest.findUnique.mockResolvedValue(pr as never);
    prisma.appUser.findUnique.mockResolvedValue({ id: ownerId } as never);

    // Contrôle budgétaire (US-010) — large par défaut.
    prisma.budgetLine.findMany.mockResolvedValue([
      {
        id: blId,
        code: 'L01',
        label: 'Ligne budgétaire',
        budgetedAmount: new Prisma.Decimal(1),
        budgetedAmountXof: budgetedXof,
        currency: 'XOF',
        grant: { currency: 'XOF' },
      },
    ] as never);
    prisma.purchaseRequestLine.findMany.mockResolvedValue([] as never);
    prisma.purchaseOrderLine.findMany.mockResolvedValue([] as never);

    // Lookups du builder (US-049).
    prisma.grantAgreement.findUnique.mockResolvedValue({
      id: grantId,
      currency: 'XOF',
      startDate: new Date(cfg.grantStart ?? '2026-01-01'),
      endDate: new Date(cfg.grantEnd ?? '2026-12-31'),
    } as never);
    prisma.noteTechnique.findFirst.mockResolvedValue(
      cfg.activeNoteTechnique === false
        ? (null as never)
        : ({ id: 'nt-1', overheadRuleId: null, singleActorAuthorized: false } as never),
    );
    prisma.eligibilityRule.findMany.mockResolvedValue((cfg.eligibilityRules ?? []) as never);
    prisma.budgetLine.findUnique.mockResolvedValue({
      id: blId,
      budgetedAmountXof: budgetedXof,
      currency: 'XOF',
      // US-056 : null (défaut) = ligne historique → fallback proxy nature.
      category: cfg.budgetLineCategory ?? null,
    } as never);
    prisma.expenseNature.findUnique.mockResolvedValue({
      id: natureId,
      code: cfg.expenseNatureCode ?? 'OFFICE_SUPPLIES',
      category: cfg.natureCategory ?? 'functioning',
    } as never);

    // Règle période (US-047).
    prisma.fiscalPeriod.findFirst.mockResolvedValue(
      cfg.periodOpen === false
        ? (null as never)
        : ({ id: 'fp-1', code: '2026-06' } as never),
    );
    // Règle doublon facture (US-046).
    prisma.invoice.findMany.mockResolvedValue(
      Array.from({ length: cfg.invoiceDupes ?? 0 }, (_, i) => ({
        id: `inv-${i}`,
        invoiceNumber: 'INV-DUP',
      })) as never,
    );

    // Persistance.
    prisma.purchaseRequest.update.mockResolvedValue({ ...pr, status: 'pending_pi' } as never);
    prisma.approvalStep.create.mockResolvedValue({} as never);

    return prId;
  }

  /** Capture l'EligibilityValidationException levée par submit(). */
  async function captureBlock(p: Promise<unknown>): Promise<EligibilityValidationException> {
    try {
      await p;
    } catch (e) {
      if (e instanceof EligibilityValidationException) return e;
      throw e;
    }
    throw new Error('EligibilityValidationException attendue, aucune exception levée');
  }

  /** Contexte d'éligibilité nominal (pour les preuves moteur directes). */
  function makeContext(): EligibilityContext {
    return {
      pr: {
        id: prId,
        grantId,
        budgetLineId: blId,
        totalAmount: new Prisma.Decimal(100_000),
        totalAmountXof: 100_000,
        currency: 'XOF',
        expenseNatureCode: 'OFFICE_SUPPLIES',
        requestedById: ownerId,
        requestedAt: new Date('2026-06-15'),
      },
      actor: { id: 'kc-owner', roles: ['DEMANDEUR'] },
      grant: {
        id: grantId,
        currency: 'XOF',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
      activeNoteTechnique: { id: 'nt-1', overheadRuleId: null, singleActorAuthorized: false },
      eligibilityRules: [],
      budgetLine: { id: blId, budgetedAmountXof: 100_000_000_000n, currency: 'XOF', category: 'functioning' },
      expenseNature: { id: natureId, code: 'OFFICE_SUPPLIES', category: 'functioning' },
      now: new Date('2026-06-15'),
    };
  }

  beforeEach(() => {
    prisma = createPrismaMock();

    // Stub fx déterministe : XOF→identité, EUR→parité BCEAO, USD→605.
    fx = {
      convertToXof: jest.fn(async (amount: number | Prisma.Decimal, currency: string) => {
        const n = Number(amount);
        const base = { fxRateDate: new Date('2026-06-15'), isIndicativeFallback: false };
        if (currency === 'XOF') return { xofAmount: Math.round(n), fxRate: 1, ...base };
        if (currency === 'EUR') return { xofAmount: Math.round(n * 655.957), fxRate: 655.957, ...base };
        if (currency === 'USD') return { xofAmount: Math.round(n * 605), fxRate: 605, ...base };
        throw new Error(`stub fx : devise non gérée ${currency}`);
      }),
    };
    const fxService = fx as unknown as ExchangeRateService;

    // VRAIES implémentations : moteur + 7 règles + builder.
    engine = new EligibilityEngineService([
      new NatureAllowedRule(),
      new DateWindowRule(),
      new LineNotExceededRule(),
      new LineNatureCoherentRule(),
      new NotPasteurParisReimbursedRule(),
      new NoCrossProjectDuplicateRule(prisma),
      new PeriodNotClosedRule(prisma),
    ]);
    builder = new EligibilityContextBuilder(prisma, fxService);
    service = new PurchaseRequestService(prisma, fxService, engine, builder);
  });

  // ====================================================================
  describe('Catalogue PPT slide 7 « à ne pas faire »', () => {
    it('PPT-1 — « Imputer des dépenses inéligibles » → ELIG_NATURE_NOT_ALLOWED bloque', async () => {
      const id = configureSubmit({
        currency: 'USD',
        totalAmount: 50_000,
        expenseNatureCode: 'PERSONNEL_INTERNATIONAL',
        natureCategory: 'personnel',
        eligibilityRules: [
          { expenseNatureId: natureId, maxPerRequestXof: null, maxPerYearXof: null, excluded: true },
        ],
      });

      const err = await captureBlock(service.submit(demandeur, id));
      expect(err.blockedVerdicts.map((v) => v.code)).toContain('ELIG_NATURE_NOT_ALLOWED');
      // DA non avancée : ni update de statut, ni étape d'approbation.
      expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
      expect(prisma.approvalStep.create).not.toHaveBeenCalled();
    });

    it('PPT-2 — « Imputer des dépenses hors période de la convention » → ELIG_DATE_OUT_OF_WINDOW', async () => {
      const id = configureSubmit({
        requestedAt: '2025-12-31',
        grantStart: '2026-01-01',
        grantEnd: '2026-12-31',
      });

      const err = await captureBlock(service.submit(demandeur, id));
      expect(err.blockedVerdicts.map((v) => v.code)).toContain('ELIG_DATE_OUT_OF_WINDOW');
      expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
    });

    it('PPT-3 — « Dépasser les lignes budgétaires » → ELIG_LINE_BUDGET_EXCEEDED', async () => {
      const id = configureSubmit({
        currency: 'XOF',
        totalAmount: 5_000_000,
        lineTotal: 5_000_000,
        // Plafond éligibilité par requête = 1 000 000 XOF (≠ solde de ligne,
        // volontairement large → c'est le plafond conventionnel qui bloque).
        eligibilityRules: [
          { expenseNatureId: natureId, maxPerRequestXof: 1_000_000n, maxPerYearXof: null, excluded: false },
        ],
      });

      const err = await captureBlock(service.submit(demandeur, id));
      expect(err.blockedVerdicts.map((v) => v.code)).toContain('ELIG_LINE_BUDGET_EXCEEDED');
      expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
    });

    it('PPT-4 — « Imputer sur la mauvaise ligne » : BLOQUE via submit() (US-055+US-056, gate ACTIVÉE)', async () => {
      // Ligne budgétaire category='equipment' (ref.budget_line.category,
      // US-055) + nature 'functioning' → lecture DIRECTE par le builder
      // (US-056) → LineNatureCoherentRule bloque END-TO-END.
      const id = configureSubmit({
        expenseNatureCode: 'OFFICE_SUPPLIES',
        natureCategory: 'functioning',
        budgetLineCategory: 'equipment',
      });

      const err = await captureBlock(service.submit(demandeur, id));
      expect(err.blockedVerdicts.map((v) => v.code)).toContain('ELIG_LINE_NATURE_INCOHERENT');
      expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
    });

    it('PPT-4bis — budget_line.category NULL (donnée historique) : fallback proxy US-049, la DA passe', async () => {
      // Rétrocompat : ligne pré-US-055 (category NULL) → le builder retombe
      // sur la catégorie de la nature (toujours cohérente → jamais bloquant),
      // avec WARN us049_proxy_fallback_used. Comportement identique à avant.
      const id = configureSubmit({
        expenseNatureCode: 'LAB_EQUIPMENT_PCR',
        natureCategory: 'equipment',
        budgetLineCategory: null,
      });
      const res = await service.submit(demandeur, id);
      expect(res.pr.status).toBe('pending_pi');
    });

    it('PPT-5 — « Imputer une dépense remboursée Pasteur Paris » : preuve moteur (flag non transporté par submit — TODO S6)', async () => {
      // (a) Via submit() : pr.pasteurParisReimbursed n'est pas transporté par
      //     runEligibilityGate → no-op → la DA passe (documenté).
      const id = configureSubmit({ prExtra: { pasteurParisReimbursed: true } });
      const res = await service.submit(demandeur, id);
      expect(res.pr.status).toBe('pending_pi');

      // (b) Preuve de la mécanique réelle : contexte avec le flag matérialisé.
      prisma.fiscalPeriod.findFirst.mockResolvedValue({ id: 'fp-1', code: '2026-06' } as never);
      const ctx = makeContext();
      (ctx.pr as { pasteurParisReimbursed?: boolean }).pasteurParisReimbursed = true;
      const verdict = await engine.validate(ctx);
      expect(verdict.ok).toBe(false);
      expect(verdict.blockedVerdicts.map((v) => v.code)).toContain('ELIG_PASTEUR_PARIS_REIMBURSED');
    });

    it('PPT-6 — « Imputer la même facture sur plusieurs projets » : preuve moteur (n° facture non transporté par submit — TODO S6)', async () => {
      // (a) Via submit() : pr.supplierInvoiceNumber non transporté → no-op →
      //     la DA passe sans warning (documenté).
      const id = configureSubmit({ prExtra: { supplierInvoiceNumber: 'INV-DUP' }, invoiceDupes: 2 });
      const res = await service.submit(demandeur, id);
      expect(res.pr.status).toBe('pending_pi');
      expect(res.warnings).toEqual([]);

      // (b) Preuve de la mécanique réelle : contexte avec n° de facture +
      //     doublon en base → warning NON bloquant.
      prisma.fiscalPeriod.findFirst.mockResolvedValue({ id: 'fp-1', code: '2026-06' } as never);
      prisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-A', invoiceNumber: 'INV-DUP' },
      ] as never);
      const ctx = makeContext();
      (ctx.pr as { supplierInvoiceNumber?: string }).supplierInvoiceNumber = 'INV-DUP';
      const verdict = await engine.validate(ctx);
      expect(verdict.ok).toBe(true); // warning ≠ blocage
      expect(verdict.warnings.map((v) => v.code)).toContain('ELIG_CROSS_PROJECT_DUPLICATE');
    });

    it('PPT-7 — « Imputer sur période close » → ELIG_PERIOD_CLOSED', async () => {
      const id = configureSubmit({
        requestedAt: '2025-12-15',
        // Fenêtre convention élargie pour ISOLER le motif période (la date
        // tombe dans la convention mais dans une période fiscale close).
        grantStart: '2025-01-01',
        grantEnd: '2026-12-31',
        periodOpen: false,
      });

      const err = await captureBlock(service.submit(demandeur, id));
      expect(err.blockedVerdicts.map((v) => v.code)).toContain('ELIG_PERIOD_CLOSED');
      expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
    });
  });

  // ====================================================================
  describe('Scénarios combinés et nominaux', () => {
    it('COMBO-1 — cas nominal vert : 100 000 EUR éligible → DA soumise, aucun warning', async () => {
      const id = configureSubmit({
        currency: 'EUR',
        totalAmount: 100_000, // = 65 595 700 XOF
        expenseNatureCode: 'OFFICE_SUPPLIES',
        natureCategory: 'functioning',
        requestedAt: '2026-06-15',
        eligibilityRules: [
          { expenseNatureId: natureId, maxPerRequestXof: 100_000_000_000n, maxPerYearXof: null, excluded: false },
        ],
        periodOpen: true,
      });

      const res = await service.submit(demandeur, id);
      expect(res.pr.status).toBe('pending_pi');
      expect(res.warnings).toEqual([]); // aucun verdict bloquant ni warning ⇒ tous OK
      expect(prisma.purchaseRequest.update).toHaveBeenCalled();
      expect(prisma.approvalStep.create).toHaveBeenCalled();
      // Conversion XOF effectuée pour la valorisation EUR (ADR-005).
      expect(fx.convertToXof).toHaveBeenCalledWith(expect.anything(), 'EUR', expect.anything());
    });

    it('COMBO-2 — blocages cumulés : nature exclue + date hors fenêtre + plafond dépassé → 3 verdicts', async () => {
      const id = configureSubmit({
        currency: 'XOF',
        totalAmount: 5_000_000,
        lineTotal: 5_000_000,
        requestedAt: '2025-12-31', // hors fenêtre 2026
        grantStart: '2026-01-01',
        grantEnd: '2026-12-31',
        eligibilityRules: [
          { expenseNatureId: natureId, maxPerRequestXof: 1_000_000n, maxPerYearXof: null, excluded: true },
        ],
        periodOpen: true, // on isole les 3 motifs voulus (la période ne bloque pas)
      });

      const err = await captureBlock(service.submit(demandeur, id));
      const codes = err.blockedVerdicts.map((v) => v.code);
      expect(err.blockedVerdicts).toHaveLength(3);
      expect(codes).toEqual(
        expect.arrayContaining([
          'ELIG_NATURE_NOT_ALLOWED',
          'ELIG_DATE_OUT_OF_WINDOW',
          'ELIG_LINE_BUDGET_EXCEEDED',
        ]),
      );
      // Le message cite les 3 codes.
      expect(err.message).toContain('ELIG_NATURE_NOT_ALLOWED');
      expect(err.message).toContain('ELIG_DATE_OUT_OF_WINDOW');
      expect(err.message).toContain('ELIG_LINE_BUDGET_EXCEEDED');
      expect(prisma.purchaseRequest.update).not.toHaveBeenCalled();
    });

    it('COMBO-3 — warning sans blocage : doublon facture inter-projet (preuve moteur, DA persistable)', async () => {
      // Le canal warning de submit() est déjà prouvé non bloquant par COMBO-1
      // (warnings flue dans { pr, warnings } sans empêcher la persistance).
      // Ici on prouve qu'un doublon facture produit un WARNING (pas un
      // blocage) via le vrai moteur — donc la DA RESTERA persistable une fois
      // pr.supplierInvoiceNumber matérialisé (TODO S6).
      prisma.fiscalPeriod.findFirst.mockResolvedValue({ id: 'fp-1', code: '2026-06' } as never);
      prisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-A', invoiceNumber: 'INV-DUP' },
        { id: 'inv-B', invoiceNumber: 'INV-DUP' },
      ] as never);
      const ctx = makeContext();
      (ctx.pr as { supplierInvoiceNumber?: string }).supplierInvoiceNumber = 'INV-DUP';

      const verdict = await engine.validate(ctx);
      expect(verdict.ok).toBe(true); // non bloquant → submit() persisterait la DA
      expect(verdict.blockedVerdicts).toEqual([]);
      expect(verdict.warnings).toHaveLength(1);
      expect(verdict.warnings[0].code).toBe('ELIG_CROSS_PROJECT_DUPLICATE');
    });
  });

  // ====================================================================
  //  Garde-fous de chargement du contexte (EligibilityContextBuilder)
  // ====================================================================
  describe('EligibilityContextBuilder — garde-fous de chargement', () => {
    const actor = { id: 'kc-owner', roles: ['DEMANDEUR'] };

    function prInput(over: Partial<EligibilityPrInput> = {}): EligibilityPrInput {
      return {
        id: prId,
        grantId,
        budgetLineId: blId,
        totalAmount: new Prisma.Decimal(100_000),
        currency: 'XOF',
        expenseNatureCode: 'OFFICE_SUPPLIES',
        requestedById: ownerId,
        requestedAt: new Date('2026-06-15'),
        ...over,
      };
    }

    it('convention introuvable → NotFoundException', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue(null as never);
      await expect(builder.build(prInput(), actor)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ligne budgétaire introuvable → NotFoundException', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({
        id: grantId,
        currency: 'XOF',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      } as never);
      prisma.noteTechnique.findFirst.mockResolvedValue(null as never);
      prisma.eligibilityRule.findMany.mockResolvedValue([] as never);
      prisma.budgetLine.findUnique.mockResolvedValue(null as never);
      await expect(builder.build(prInput(), actor)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('nature de dépense introuvable → NotFoundException', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({
        id: grantId,
        currency: 'XOF',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      } as never);
      prisma.noteTechnique.findFirst.mockResolvedValue(null as never);
      prisma.eligibilityRule.findMany.mockResolvedValue([] as never);
      prisma.budgetLine.findUnique.mockResolvedValue({
        id: blId,
        budgetedAmountXof: 100n,
        currency: 'XOF',
      } as never);
      prisma.expenseNature.findUnique.mockResolvedValue(null as never);
      await expect(builder.build(prInput(), actor)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sans Note Technique active + sans requestedAt : contexte construit (fallback horloge, NT null, proxy catégorie)', async () => {
      prisma.grantAgreement.findUnique.mockResolvedValue({
        id: grantId,
        currency: 'XOF',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      } as never);
      prisma.noteTechnique.findFirst.mockResolvedValue(null as never);
      prisma.eligibilityRule.findMany.mockResolvedValue([] as never);
      prisma.budgetLine.findUnique.mockResolvedValue({
        id: blId,
        budgetedAmountXof: 100_000n,
        currency: 'XOF',
      } as never);
      prisma.expenseNature.findUnique.mockResolvedValue({
        id: natureId,
        code: 'OFFICE_SUPPLIES',
        category: 'functioning',
      } as never);

      // requestedAt omis → branche `?? new Date()` de la conversion fx.
      const ctx = await builder.build(prInput({ requestedAt: undefined }), actor);

      expect(ctx.activeNoteTechnique).toBeNull();
      expect(ctx.pr.totalAmountXof).toBe(100_000); // converti XOF (identité)
      // Proxy documenté US-049 : budgetLine.category = expenseNature.category.
      expect(ctx.budgetLine.category).toBe('functioning');
      expect(ctx.expenseNature.category).toBe('functioning');
    });
  });
});
