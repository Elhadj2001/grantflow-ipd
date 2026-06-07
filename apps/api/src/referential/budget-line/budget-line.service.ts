import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BudgetLine } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma/prisma.service';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  BudgetLineHasUsageException,
  BudgetLinesExceedGrantException,
  DuplicateCodeException,
  EntityNotFoundException,
  InvalidGlAccountException,
} from '../../common/exceptions/business.exception';
import type { CreateBudgetLineDto } from './dto/create-budget-line.dto';
import { CreateBudgetLineSchema } from './dto/create-budget-line.dto';
import type { UpdateBudgetLineDto } from './dto/update-budget-line.dto';

const ENTITY_NAME = 'BudgetLine';
const PG_UNIQUE_VIOLATION = 'P2002';

export interface BulkImportResult {
  created: number;
  errors: Array<{ row: number; message: string }>;
}

@Injectable()
export class BudgetLineService {
  private readonly logger = new Logger(BudgetLineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: ExchangeRateService,
  ) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  async listByGrant(grantId: string): Promise<{ data: BudgetLine[]; total: number }> {
    await this.ensureGrantExists(grantId);
    const data = await this.prisma.budgetLine.findMany({
      where: { grantId, isActive: true },
      orderBy: { code: 'asc' },
    });
    return { data, total: data.length };
  }

  async findOne(grantId: string, id: string): Promise<BudgetLine> {
    await this.ensureGrantExists(grantId);
    const line = await this.prisma.budgetLine.findFirst({ where: { id, grantId } });
    if (!line) throw new EntityNotFoundException(ENTITY_NAME, { id, grantId });
    return line;
  }

  // ------------------------------------------------------------------
  // Write (unit)
  // ------------------------------------------------------------------

  async create(grantId: string, dto: CreateBudgetLineDto): Promise<BudgetLine> {
    const grant = await this.ensureGrantExists(grantId);

    if (dto.defaultAccount) {
      await this.assertGlAccountExists(dto.defaultAccount);
    }

    const amount = this.toNumber(dto.budgetedAmount);
    await this.assertGrantNotOverflowed(grantId, grant.amount, amount);

    const xof = await this.buildXofMaterialization(amount, grant.currency);
    try {
      return await this.prisma.budgetLine.create({
        data: {
          grantId,
          code: dto.code,
          label: dto.label,
          budgetedAmount: new Prisma.Decimal(amount),
          defaultAccount: dto.defaultAccount ?? null,
          isOverheadEligible: dto.isOverheadEligible,
          budgetedAmountXof: xof.budgetedAmountXof,
          fxRate: xof.fxRate,
          fxRateDate: xof.fxRateDate,
          currency: xof.currency,
        },
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  async replace(grantId: string, id: string, dto: CreateBudgetLineDto): Promise<BudgetLine> {
    const grant = await this.ensureGrantExists(grantId);
    await this.findOne(grantId, id);

    if (dto.defaultAccount) await this.assertGlAccountExists(dto.defaultAccount);

    const amount = this.toNumber(dto.budgetedAmount);
    await this.assertGrantNotOverflowed(grantId, grant.amount, amount, id);

    const xof = await this.buildXofMaterialization(amount, grant.currency);
    try {
      return await this.prisma.budgetLine.update({
        where: { id },
        data: {
          code: dto.code,
          label: dto.label,
          budgetedAmount: new Prisma.Decimal(amount),
          defaultAccount: dto.defaultAccount ?? null,
          isOverheadEligible: dto.isOverheadEligible,
          budgetedAmountXof: xof.budgetedAmountXof,
          fxRate: xof.fxRate,
          fxRateDate: xof.fxRateDate,
          currency: xof.currency,
        },
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code);
    }
  }

  async update(grantId: string, id: string, dto: UpdateBudgetLineDto): Promise<BudgetLine> {
    const grant = await this.ensureGrantExists(grantId);
    const existing = await this.findOne(grantId, id);

    if (dto.defaultAccount) await this.assertGlAccountExists(dto.defaultAccount);

    if (dto.budgetedAmount !== undefined) {
      const next = this.toNumber(dto.budgetedAmount);
      await this.assertGrantNotOverflowed(grantId, grant.amount, next, id);
    }

    const data: Prisma.BudgetLineUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.budgetedAmount !== undefined) {
      const next = this.toNumber(dto.budgetedAmount);
      data.budgetedAmount = new Prisma.Decimal(next);
      // US-024 : le montant budgété change → on re-fige l'équivalent XOF et
      // le taux à la date de modification.
      const xof = await this.buildXofMaterialization(next, grant.currency);
      data.budgetedAmountXof = xof.budgetedAmountXof;
      data.fxRate = xof.fxRate;
      data.fxRateDate = xof.fxRateDate;
      data.currency = xof.currency;
    }
    if (dto.defaultAccount !== undefined) {
      data.defaultAccountRef = dto.defaultAccount === null
        ? { disconnect: true }
        : { connect: { code: dto.defaultAccount } };
    }
    if (dto.isOverheadEligible !== undefined) data.isOverheadEligible = dto.isOverheadEligible;

    try {
      return await this.prisma.budgetLine.update({ where: { id }, data });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.code ?? existing.code);
    }
  }

  async softDelete(grantId: string, id: string): Promise<BudgetLine> {
    const line = await this.findOne(grantId, id);
    if (!line.isActive) throw new AlreadyInactiveException(ENTITY_NAME, id);

    const [prCount, poCount, jlCount] = await Promise.all([
      this.prisma.purchaseRequestLine.count({ where: { budgetLineId: id } }),
      this.prisma.purchaseOrderLine.count({ where: { budgetLineId: id } }),
      this.prisma.journalLine.count({ where: { budgetLineId: id } }),
    ]);
    if (prCount + poCount + jlCount > 0) {
      throw new BudgetLineHasUsageException(id, {
        purchaseRequestLines: prCount,
        purchaseOrderLines: poCount,
        journalLines: jlCount,
      });
    }

    return this.prisma.budgetLine.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async restore(grantId: string, id: string): Promise<BudgetLine> {
    const line = await this.findOne(grantId, id);
    if (line.isActive) throw new AlreadyActiveException(ENTITY_NAME, id);
    return this.prisma.budgetLine.update({
      where: { id },
      data: { isActive: true },
    });
  }

  // ------------------------------------------------------------------
  // Bulk import (xlsx)
  // ------------------------------------------------------------------

  /**
   * Lit un xlsx (premier onglet) avec colonnes attendues :
   *   code | label | budgeted_amount | default_account | is_overhead_eligible
   *
   * Stratégie : si une seule ligne échoue à la validation OU si la somme
   * dépasse `grant.amount`, on rollback (transaction Prisma) et on renvoie
   * 4xx avec le détail des erreurs. Aucune ligne créée si l'import n'est
   * pas 100% propre — cohérent avec la sémantique "import = atomique".
   */
  async bulkImportFromBuffer(grantId: string, buffer: Buffer): Promise<BulkImportResult> {
    const grant = await this.ensureGrantExists(grantId);

    const wb = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = wb.SheetNames[0];
    if (!firstSheetName) {
      return { created: 0, errors: [{ row: 0, message: 'Empty workbook' }] };
    }
    const sheet = wb.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

    const errors: BulkImportResult['errors'] = [];
    const validRows: CreateBudgetLineDto[] = [];

    rows.forEach((raw, idx) => {
      // idx 0-based → row 1-based dans le fichier (sans le header).
      const rowNum = idx + 2;
      const candidate = {
        code: typeof raw.code === 'string' ? raw.code.trim() : raw.code,
        label: typeof raw.label === 'string' ? raw.label.trim() : raw.label,
        budgetedAmount: raw.budgeted_amount,
        defaultAccount:
          raw.default_account === null || raw.default_account === ''
            ? undefined
            : String(raw.default_account).trim(),
        isOverheadEligible:
          raw.is_overhead_eligible === null || raw.is_overhead_eligible === undefined
            ? true
            : Boolean(raw.is_overhead_eligible),
      };
      const parsed = CreateBudgetLineSchema.safeParse(candidate);
      if (!parsed.success) {
        const msg = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        errors.push({ row: rowNum, message: msg });
        return;
      }
      validRows.push(parsed.data);
    });

    if (errors.length > 0) {
      return { created: 0, errors };
    }

    // Vérifie la somme totale (lignes existantes actives + nouvelles).
    // Somme + comparaison de plafond en Prisma.Decimal (F10) ; tolérance
    // 0.0001 historique conservée (comportement identique) en Decimal exact.
    const existingTotal = await this.sumActiveBudgetedAmount(grantId);
    const newTotal = validRows.reduce(
      (s, r) => s.plus(this.toNumber(r.budgetedAmount)),
      new Prisma.Decimal(0),
    );
    const grantAmount = new Prisma.Decimal(grant.amount);
    const grandTotal = existingTotal.plus(newTotal);
    if (grandTotal.greaterThan(grantAmount.plus('0.0001'))) {
      throw new BudgetLinesExceedGrantException(
        grantId,
        grantAmount.toNumber(),
        Number(grandTotal.toFixed(2)),
      );
    }

    // Transaction tout-ou-rien.
    let created = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const row of validRows) {
          if (row.defaultAccount) {
            const acc = await tx.glAccount.findUnique({
              where: { code: row.defaultAccount },
              select: { code: true },
            });
            if (!acc) throw new InvalidGlAccountException(row.defaultAccount);
          }
          const xof = await this.buildXofMaterialization(
            this.toNumber(row.budgetedAmount),
            grant.currency,
          );
          await tx.budgetLine.create({
            data: {
              grantId,
              code: row.code,
              label: row.label,
              budgetedAmount: new Prisma.Decimal(this.toNumber(row.budgetedAmount)),
              defaultAccount: row.defaultAccount ?? null,
              isOverheadEligible: row.isOverheadEligible,
              budgetedAmountXof: xof.budgetedAmountXof,
              fxRate: xof.fxRate,
              fxRateDate: xof.fxRateDate,
              currency: xof.currency,
            },
          });
          created += 1;
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === PG_UNIQUE_VIOLATION) {
        return {
          created: 0,
          errors: [{ row: 0, message: `Duplicate code in grant: ${e.meta?.target ?? 'unknown'}` }],
        };
      }
      throw e;
    }

    return { created, errors: [] };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async ensureGrantExists(
    grantId: string,
  ): Promise<{ amount: Prisma.Decimal; currency: string }> {
    const grant = await this.prisma.grantAgreement.findUnique({
      where: { id: grantId },
      select: { amount: true, currency: true },
    });
    if (!grant) throw new EntityNotFoundException('Grant', { id: grantId });
    return grant;
  }

  /**
   * US-024 (ADR-005) — fige l'équivalent XOF + le taux de change au
   * paramétrage de la ligne budgétaire. La conversion devient une référence
   * comptable stable (les contrôles budgétaires en aval s'appuient dessus,
   * cf. computeBudgetUsageByLine), indépendante des variations de taux
   * ultérieures. `currency` = devise du budget, héritée du grant tant que la
   * Note Technique (Sprint S4) ne la porte pas. XOF → no-op identité.
   */
  private async buildXofMaterialization(
    amount: number,
    currency: string,
  ): Promise<{
    budgetedAmountXof: bigint;
    fxRate: Prisma.Decimal;
    fxRateDate: Date;
    currency: string;
  }> {
    const conv = await this.fx.convertToXof(amount, currency, new Date());
    return {
      budgetedAmountXof: BigInt(Math.round(conv.xofAmount)),
      fxRate: new Prisma.Decimal(conv.fxRate),
      fxRateDate: conv.fxRateDate,
      currency,
    };
  }

  private async assertGlAccountExists(code: string): Promise<void> {
    const acc = await this.prisma.glAccount.findUnique({
      where: { code },
      select: { code: true },
    });
    if (!acc) throw new InvalidGlAccountException(code);
  }

  /**
   * Vérifie que la somme(budgetedAmount) des lignes actives reste ≤ grant.amount.
   * `ignoreLineId` exclut la ligne en cours de modification (sinon on
   * doublerait son montant en update).
   */
  private async assertGrantNotOverflowed(
    grantId: string,
    grantAmount: Prisma.Decimal,
    nextAmount: number,
    ignoreLineId?: string,
  ): Promise<void> {
    // Somme + comparaison de plafond en Prisma.Decimal (F10). On conserve la
    // tolérance 0.0001 historique (comportement identique) appliquée en
    // Decimal exact, puis on ne convertit en number qu'à la frontière de
    // l'exception (qui attend des number d'affichage).
    const existing = await this.sumActiveBudgetedAmount(grantId, ignoreLineId);
    const total = existing.plus(nextAmount);
    const gAmount = new Prisma.Decimal(grantAmount);
    if (total.greaterThan(gAmount.plus('0.0001'))) {
      throw new BudgetLinesExceedGrantException(
        grantId,
        gAmount.toNumber(),
        Number(total.toFixed(2)),
      );
    }
  }

  /**
   * Somme exacte des budgetedAmount des lignes actives, retournée en
   * Prisma.Decimal (F10) pour permettre des comparaisons de plafond sans
   * perte de précision float64.
   */
  private async sumActiveBudgetedAmount(
    grantId: string,
    ignoreLineId?: string,
  ): Promise<Prisma.Decimal> {
    const agg = await this.prisma.budgetLine.aggregate({
      where: {
        grantId,
        isActive: true,
        ...(ignoreLineId ? { id: { not: ignoreLineId } } : {}),
      },
      _sum: { budgetedAmount: true },
    });
    return new Prisma.Decimal(agg._sum.budgetedAmount ?? 0);
  }

  private toNumber(v: string | number): number {
    return typeof v === 'number' ? v : parseFloat(v);
  }

  private handlePrismaWriteError(e: unknown, code: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === PG_UNIQUE_VIOLATION) {
      throw new DuplicateCodeException(ENTITY_NAME, code);
    }
    this.logger.error({ err: e, code }, 'budget-line write error (rethrow)');
    throw e instanceof Error ? e : new Error(String(e));
  }
}
