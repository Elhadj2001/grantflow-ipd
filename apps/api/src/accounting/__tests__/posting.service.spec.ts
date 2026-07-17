import { Prisma, JournalType, EntryStatus, PoStatus } from '@prisma/client';
import type { PurchaseOrder } from '@prisma/client';
import { PostingService } from '../services/posting.service';
import { ExchangeRateService } from '../../referential/exchange-rate/exchange-rate.service';
import { createPrismaMock, type PrismaMock } from '../../test-utils/prisma-mock';
import { useFakeDate, restoreRealDate } from '../../test-utils/fake-time';
import { NoOpenFiscalPeriodException, EntityNotFoundException } from '../../common/exceptions/business.exception';

/**
 * Tests unitaires PostingService.
 *
 * Couverture :
 *  - createCommitmentEntry : équilibre 801 debit = 802 credit
 *  - Numéro d'écriture : OD-YYYY-NNNN
 *  - Imputation analytique recopiée depuis la PR liée
 *  - Période fiscale : préférence month > quarter > year
 *  - Période fiscale absente → NoOpenFiscalPeriodException
 *  - reverseCommitmentEntry : crée entrée inverse + chaîne reversedById
 *  - reverseCommitmentEntry sur entry inexistante → 404
 *  - listEntriesForPo : filtre source_type/source_id
 */
describe('PostingService', () => {
  // US-062 (fix F22) : horloge figée → numéros de séquence YYYY-NNNN et
  // horodatages par défaut déterministes, indépendants de la date d'exécution.
  beforeAll(() => useFakeDate('2026-06-15'));
  afterAll(() => restoreRealDate());

  let prisma: PrismaMock;
  let svc: PostingService;

  /**
   * Projection typée des lignes passées à `journalLine.createMany`. Évite le
   * TS7053 / l'union large de `Prisma.JournalLineCreateManyInput[]` quand on
   * lit `createMany.mock.calls[0][0].data` (les délégués deep-mock sont typés
   * d'après le client Prisma réel).
   */
  type LineArg = {
    accountCode: string;
    debit: number;
    credit: number;
    currency: string;
    debitTxAmount: Prisma.Decimal | number | null;
    creditTxAmount: Prisma.Decimal | number | null;
    fx_rate: number | null;
    fx_rate_date: Date | null;
    projectId: string | null;
    grantId: string | null;
    budgetLineId: string | null;
  };
  const linesOf = (calls: unknown[][]): LineArg[] =>
    (calls[0][0] as { data: LineArg[] }).data;

  /** Projection typée des `data` passées à `journalEntry.create`. */
  type EntryArg = {
    entryNumber: string;
    journal: JournalType;
    periodId: string;
    label: string;
    sourceType: string;
    sourceId: string;
  };
  const entryDataOf = (calls: unknown[][]): EntryArg =>
    (calls[0][0] as { data: EntryArg }).data;

  const poId = 'po000000-0000-0000-0000-000000000001';
  const prId = 'pr000000-0000-0000-0000-000000000002';
  const supplierId = 'sup00000-0000-0000-0000-000000000003';
  const projectId = 'prj00000-0000-0000-0000-000000000004';
  const grantId = 'grt00000-0000-0000-0000-000000000005';
  const blId = 'bl100000-0000-0000-0000-000000000006';
  const periodMonth = { id: 'per-month', periodType: 'month', isClosed: false };
  const periodQuarter = { id: 'per-quarter', periodType: 'quarter', isClosed: false };
  const periodYear = { id: 'per-year', periodType: 'year', isClosed: false };

  const actor = { id: 'usr-1', email: 'a@x', fullName: 'A' };

  function makePo(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder & { prLinks: Array<{ prId: string }> } {
    return {
      id: poId,
      poNumber: 'BC-2026-0001',
      prId,
      supplierId,
      orderDate: new Date('2026-05-15T00:00:00Z'),
      expectedDate: null,
      status: PoStatus.draft,
      totalHt: new Prisma.Decimal('500000'),
      totalVat: new Prisma.Decimal('0'),
      totalTtc: new Prisma.Decimal('500000'),
      currency: 'XOF',
      incoterm: null,
      deliveryAddress: null,
      buyerId: null,
      sentAt: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      cancelledAt: null,
      cancellationReason: null,
      pdfObjectKey: null,
      emailSentAt: null,
      emailSentTo: null,
      createdAt: new Date(),
      ...overrides,
      prLinks: [{ prId }],
    } as PurchaseOrder & { prLinks: Array<{ prId: string }> };
  }

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.fiscalPeriod.findMany.mockResolvedValue([periodMonth, periodQuarter, periodYear] as never);
    prisma.purchaseRequest.findUnique.mockResolvedValue({
      projectId,
      grantId,
      costCenterId: null,
      activityId: null,
      lines: [{ budgetLineId: blId }],
    } as never);
    prisma.supplier.findUnique.mockResolvedValue({ name: 'ACME Lab Supplies' } as never);
    prisma.$executeRawUnsafe.mockResolvedValue(1 as never);
    // US-099 : settleClass8ResidualTx interroge les lignes 801 du BC —
    // défaut [] = résidu nul = pas d'OD de solde (comportement historique).
    prisma.journalLine.findMany.mockResolvedValue([] as never);
    // US-020 (F18) : ExchangeRateService stub déterministe. XOF = identité ;
    // EUR = parité fixe BCEAO 655,957 ; USD = taux indicatif 600 (fallback).
    const fx = {
      convertToXof: jest.fn(
        async (amount: number | { toString(): string }, currency: string) => {
          const n = Number(amount);
          const fxRateDate = new Date('2026-06-15');
          if (currency === 'EUR') {
            return { xofAmount: Math.round(n * 655.957), fxRate: 655.957, fxRateDate, isIndicativeFallback: false };
          }
          if (currency === 'USD') {
            return { xofAmount: Math.round(n * 600), fxRate: 600, fxRateDate, isIndicativeFallback: true };
          }
          return { xofAmount: Math.round(n), fxRate: 1, fxRateDate, isIndicativeFallback: false };
        },
      ),
    };
    svc = new PostingService(prisma, fx as unknown as ExchangeRateService);
  });

  // ------------------------------------------------------------------
  describe('createCommitmentEntry', () => {
    it('creates a balanced entry : 801 debit = 802 credit', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', entryNumber: 'OD-2026-0001', lines: [] } as never);
      await svc.createCommitmentEntry(makePo(), actor);

      const lines = linesOf(prisma.journalLine.createMany.mock.calls);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({ accountCode: '801', debit: 500000, credit: 0 });
      expect(lines[1]).toMatchObject({ accountCode: '802', debit: 0, credit: 500000 });
    });

    // ----- F18 (US-020) : engagement classe 8 multidevise -----
    it('F18 — BC EUR converti en XOF (parité BCEAO 655,957) + taux stocké', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] } as never);
      await svc.createCommitmentEntry(
        makePo({ totalHt: new Prisma.Decimal('100000'), currency: 'EUR' }),
        actor,
      );
      const lines = linesOf(prisma.journalLine.createMany.mock.calls);
      // 100 000 EUR × 655,957 = 65 595 700 XOF
      expect(lines[0]).toMatchObject({ accountCode: '801', debit: 65595700, credit: 0, currency: 'EUR' });
      expect(lines[1]).toMatchObject({ accountCode: '802', debit: 0, credit: 65595700, currency: 'EUR' });
      expect(lines[0].fx_rate).toBe(655.957);
      expect(lines[0].fx_rate_date).toBeInstanceOf(Date);
      // montant transactionnel brut conservé (Règle d'or n°4)
      expect(Number(lines[0].debitTxAmount)).toBe(100000);
      expect(Number(lines[1].creditTxAmount)).toBe(100000);
    });

    it('F18 — BC XOF : no-op identité (fx_rate=1, pas de debit/credit_tx_amount)', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] } as never);
      await svc.createCommitmentEntry(
        makePo({ totalHt: new Prisma.Decimal('1000000'), currency: 'XOF' }),
        actor,
      );
      const lines = linesOf(prisma.journalLine.createMany.mock.calls);
      expect(lines[0]).toMatchObject({ accountCode: '801', debit: 1000000, credit: 0, currency: 'XOF' });
      expect(lines[1]).toMatchObject({ accountCode: '802', debit: 0, credit: 1000000, currency: 'XOF' });
      expect(lines[0].fx_rate).toBe(1);
      expect(lines[0].debitTxAmount).toBeNull();
      expect(lines[1].creditTxAmount).toBeNull();
    });

    it('F18 — BC USD converti via taux indicatif (stub 600)', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] } as never);
      await svc.createCommitmentEntry(
        makePo({ totalHt: new Prisma.Decimal('1000'), currency: 'USD' }),
        actor,
      );
      const lines = linesOf(prisma.journalLine.createMany.mock.calls);
      // 1 000 USD × 600 = 600 000 XOF
      expect(lines[0]).toMatchObject({ accountCode: '801', debit: 600000, credit: 0, currency: 'USD' });
      expect(lines[0].fx_rate).toBe(600);
      expect(Number(lines[0].debitTxAmount)).toBe(1000);
    });

    it('formats entry number as OD-YYYY-NNNN', async () => {
      const year = new Date().getFullYear();
      // Le générateur lit le dernier numéro via findFirst (MAX), plus count().
      // 0004 existant → la prochaine pièce est 0005.
      prisma.journalEntry.findFirst.mockResolvedValue({ entryNumber: `OD-${year}-0004` } as never);
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] } as never);
      await svc.createCommitmentEntry(makePo(), actor);
      const createArgs = entryDataOf(prisma.journalEntry.create.mock.calls);
      expect(createArgs.entryNumber).toBe(`OD-${year}-0005`);
      expect(createArgs.journal).toBe(JournalType.OD);
    });

    it('copies analytical imputation (project, grant, budget_line) from linked PR', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] } as never);
      await svc.createCommitmentEntry(makePo(), actor);
      const lines = linesOf(prisma.journalLine.createMany.mock.calls);
      expect(lines[0]).toMatchObject({ projectId, grantId, budgetLineId: blId });
      expect(lines[1]).toMatchObject({ projectId, grantId, budgetLineId: blId });
    });

    it('promotes entry to posted with postedBy/postedAt', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
      prisma.journalEntry.update.mockResolvedValue({
        id: 'je-1',
        entryNumber: 'OD-2026-0001',
        status: EntryStatus.posted,
        lines: [],
      } as never);
      await svc.createCommitmentEntry(makePo(), actor);
      const updateArgs = prisma.journalEntry.update.mock.calls[0][0] as {
        data: { status: EntryStatus; postedBy: string; postedAt: Date };
      };
      expect(updateArgs.data).toMatchObject({
        status: EntryStatus.posted,
        postedBy: actor.id,
      });
      expect(updateArgs.data.postedAt).toBeInstanceOf(Date);
    });

    it('prefers month period over quarter/year', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] } as never);
      await svc.createCommitmentEntry(makePo(), actor);
      const createArgs = entryDataOf(prisma.journalEntry.create.mock.calls);
      expect(createArgs.periodId).toBe(periodMonth.id);
    });

    it('falls back to quarter then year when month period is missing', async () => {
      prisma.fiscalPeriod.findMany.mockResolvedValue([periodQuarter, periodYear] as never);
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] } as never);
      await svc.createCommitmentEntry(makePo(), actor);
      expect(entryDataOf(prisma.journalEntry.create.mock.calls).periodId).toBe(periodQuarter.id);
    });

    it('throws NoOpenFiscalPeriodException when no period covers the date', async () => {
      prisma.fiscalPeriod.findMany.mockResolvedValue([] as never);
      await expect(svc.createCommitmentEntry(makePo(), actor)).rejects.toBeInstanceOf(
        NoOpenFiscalPeriodException,
      );
    });

    it('label includes po number + supplier name', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] } as never);
      await svc.createCommitmentEntry(makePo(), actor);
      const label = entryDataOf(prisma.journalEntry.create.mock.calls).label;
      expect(label).toContain('BC-2026-0001');
      expect(label).toContain('ACME Lab Supplies');
    });

    it('uses sourceType=purchase_order + sourceId=po.id', async () => {
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-1' } as never);
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-1', lines: [] } as never);
      await svc.createCommitmentEntry(makePo(), actor);
      const data = entryDataOf(prisma.journalEntry.create.mock.calls);
      expect(data.sourceType).toBe('purchase_order');
      expect(data.sourceId).toBe(poId);
    });
  });

  // ------------------------------------------------------------------
  describe('reverseCommitmentEntry', () => {
    it('creates inverse entry (debit↔credit swapped)', async () => {
      const original = {
        id: 'je-1',
        entryNumber: 'OD-2026-0001',
        lines: [
          {
            id: 'l-1', lineNumber: 1, accountCode: '801', debit: 500000, credit: 0,
            currency: 'XOF', label: 'Engagement BC-2026-0001',
            projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null,
          },
          {
            id: 'l-2', lineNumber: 2, accountCode: '802', debit: 0, credit: 500000,
            currency: 'XOF', label: 'Contre-engagement BC-2026-0001',
            projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null,
          },
        ],
      };
      // 1er findFirst : lookup de l'écriture d'origine (hors tx).
      // 2e findFirst : générateur de numéro de pièce (dans tx) → renvoie le
      // dernier numéro existant pour calculer la séquence suivante.
      prisma.journalEntry.findFirst
        .mockResolvedValueOnce(original as never)
        .mockResolvedValueOnce({ entryNumber: 'OD-2026-0001' } as never);
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-2' } as never);
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-2', entryNumber: 'OD-2026-0002', lines: [] } as never);

      await svc.reverseCommitmentEntry(makePo(), actor, 'fournisseur en faillite');

      const newLines = linesOf(prisma.journalLine.createMany.mock.calls);
      expect(newLines[0]).toMatchObject({ accountCode: '801', debit: 0, credit: 500000 });
      expect(newLines[1]).toMatchObject({ accountCode: '802', debit: 500000, credit: 0 });
    });

    it('marks original entry as reversed and chains reversedById', async () => {
      // 1er findFirst : écriture d'origine ; 2e findFirst : générateur de numéro.
      prisma.journalEntry.findFirst
        .mockResolvedValueOnce({
          id: 'je-1',
          lines: [{
            id: 'l-1', lineNumber: 1, accountCode: '801', debit: 500000, credit: 0,
            currency: 'XOF', label: 'Engagement',
            projectId: null, grantId: null, budgetLineId: null, costCenterId: null, activityId: null,
          }],
        } as never)
        .mockResolvedValueOnce({ entryNumber: 'OD-2026-0001' } as never);
      prisma.journalEntry.create.mockResolvedValue({ id: 'je-2' } as never);
      prisma.journalEntry.update
        .mockResolvedValueOnce({ id: 'je-2', entryNumber: 'OD-2026-0002', lines: [] } as never) // posted
        .mockResolvedValueOnce({ id: 'je-1', status: 'reversed' } as never); // original

      await svc.reverseCommitmentEntry(makePo(), actor, 'erreur saisie');

      const lastUpdate = prisma.journalEntry.update.mock.calls[1][0] as {
        where: { id: string };
        data: { reversedById: string; status: EntryStatus };
      };
      expect(lastUpdate.where.id).toBe('je-1');
      expect(lastUpdate.data).toMatchObject({ reversedById: 'je-2', status: EntryStatus.reversed });
    });

    it('throws 404 when no original entry exists', async () => {
      prisma.journalEntry.findFirst.mockResolvedValue(null as never);
      await expect(
        svc.reverseCommitmentEntry(makePo(), actor, 'reason'),
      ).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    // US-099 (F-S8-26, Option A) : un BC annulé APRÈS facturation partielle
    // est sur-extourné (l'inverse reprend l'engagement complet alors que des
    // extournes partielles ont déjà crédité le 801) → OD de solde du résidu,
    // hors résultat (801/802 uniquement, jamais 676/776).
    it('US-099 — annulation après facturation partielle → OD de solde du résidu classe 8', async () => {
      prisma.journalEntry.findFirst
        .mockResolvedValueOnce({
          id: 'je-1',
          entryNumber: 'OD-2026-0001',
          lines: [{
            id: 'l-1', lineNumber: 1, accountCode: '801', debit: 9000000, credit: 0,
            currency: 'USD', label: 'Engagement',
            projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null,
          }],
        } as never)
        .mockResolvedValueOnce({ entryNumber: 'OD-2026-0002' } as never) // n° inverse
        .mockResolvedValueOnce({ entryNumber: 'OD-2026-0003' } as never); // n° OD solde
      prisma.journalEntry.create
        .mockResolvedValueOnce({ id: 'je-2' } as never)
        .mockResolvedValueOnce({ id: 'je-3' } as never);
      prisma.journalEntry.update.mockResolvedValue({ id: 'je-2', entryNumber: 'OD-2026-0002', lines: [] } as never);
      // État simulé du 801 pour ce BC (posted + reversed) : engagement
      // 9 000 000 D, extourne partielle 8 857 500 C, inverse d'annulation
      // 9 000 000 C → résidu = −8 857 500 (sur-extourne).
      prisma.journalLine.findMany.mockResolvedValue([
        { debit: new Prisma.Decimal(9000000), credit: new Prisma.Decimal(0), projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null },
        { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(8857500), projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null },
        { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(9000000), projectId, grantId, budgetLineId: blId, costCenterId: null, activityId: null },
      ] as never);

      await svc.reverseCommitmentEntry(makePo({ currency: 'USD' }), actor, 'annulation');

      const allLines = prisma.journalLine.createMany.mock.calls.flatMap(
        (c) => (c[0] as { data: Array<Record<string, unknown>> }).data,
      );
      const solde801 = allLines.find((l) => String(l.label).startsWith('Solde résidu 801'));
      const solde802 = allLines.find((l) => String(l.label).startsWith('Solde résidu 802'));
      expect(solde801).toBeDefined();
      // Sur-extourne (résidu négatif) → on RE-débite le 801 pour revenir à 0.
      expect(Number(solde801?.debit)).toBe(8857500);
      expect(Number(solde801?.credit)).toBe(0);
      expect(Number(solde802?.credit)).toBe(8857500);
      // OD XOF pur, imputation analytique reprise de l'engagement.
      expect(solde801).toMatchObject({ currency: 'XOF', projectId, grantId, budgetLineId: blId });
      // Aucun compte de résultat mobilisé (ni 676 ni 776).
      expect(allLines.some((l) => l.accountCode === '676' || l.accountCode === '776')).toBe(false);
    });
  });

  describe('listEntriesForPo', () => {
    it('filters by sourceType=purchase_order + sourceId', async () => {
      prisma.journalEntry.findMany.mockResolvedValue([] as never);
      await svc.listEntriesForPo(poId);
      const args = prisma.journalEntry.findMany.mock.calls[0][0] as {
        where: unknown;
        orderBy: unknown;
      };
      expect(args.where).toEqual({ sourceType: 'purchase_order', sourceId: poId });
      expect(args.orderBy).toEqual({ createdAt: 'asc' });
    });
  });
});
