import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BudgetLine } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma/prisma.service';
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

  constructor(private readonly prisma: PrismaService) {}

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

    try {
      return await this.prisma.budgetLine.create({
        data: {
          grantId,
          code: dto.code,
          label: dto.label,
          budgetedAmount: new Prisma.Decimal(amount),
          defaultAccount: dto.defaultAccount ?? null,
          isOverheadEligible: dto.isOverheadEligible,
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

    try {
      return await this.prisma.budgetLine.update({
        where: { id },
        data: {
          code: dto.code,
          label: dto.label,
          budgetedAmount: new Prisma.Decimal(amount),
          defaultAccount: dto.defaultAccount ?? null,
          isOverheadEligible: dto.isOverheadEligible,
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
      data.budgetedAmount = new Prisma.Decimal(this.toNumber(dto.budgetedAmount));
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
    const existingTotal = await this.sumActiveBudgetedAmount(grantId);
    const newTotal = validRows.reduce((s, r) => s + this.toNumber(r.budgetedAmount), 0);
    const grantAmount = Number(grant.amount);
    if (existingTotal + newTotal > grantAmount + 0.0001) {
      throw new BudgetLinesExceedGrantException(
        grantId,
        grantAmount,
        Number((existingTotal + newTotal).toFixed(2)),
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
          await tx.budgetLine.create({
            data: {
              grantId,
              code: row.code,
              label: row.label,
              budgetedAmount: new Prisma.Decimal(this.toNumber(row.budgetedAmount)),
              defaultAccount: row.defaultAccount ?? null,
              isOverheadEligible: row.isOverheadEligible,
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

  private async ensureGrantExists(grantId: string): Promise<{ amount: Prisma.Decimal }> {
    const grant = await this.prisma.grantAgreement.findUnique({
      where: { id: grantId },
      select: { amount: true },
    });
    if (!grant) throw new EntityNotFoundException('Grant', { id: grantId });
    return grant;
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
    const existing = await this.sumActiveBudgetedAmount(grantId, ignoreLineId);
    const total = existing + nextAmount;
    const gAmount = Number(grantAmount);
    if (total > gAmount + 0.0001) {
      throw new BudgetLinesExceedGrantException(
        grantId,
        gAmount,
        Number(total.toFixed(2)),
      );
    }
  }

  private async sumActiveBudgetedAmount(grantId: string, ignoreLineId?: string): Promise<number> {
    const agg = await this.prisma.budgetLine.aggregate({
      where: {
        grantId,
        isActive: true,
        ...(ignoreLineId ? { id: { not: ignoreLineId } } : {}),
      },
      _sum: { budgetedAmount: true },
    });
    return Number(agg._sum.budgetedAmount ?? 0);
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
