import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FinancialStatement } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/services/storage.service';
import {
  FinancialStatementFileNotGeneratedException,
  FinancialStatementLockedException,
  FinancialStatementNotFoundException,
  PeriodNotFoundException,
} from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { isBailleurOnly } from '../../auth/types/rbac-helpers';
import {
  FinancialStatementGeneratorService,
  type StatementResult,
  type StatementType,
} from './financial-statement-generator.service';
import { StatementRenderService } from './statement-render.service';

export const STATEMENTS_BUCKET = 'grantflow-reports';

export interface StatementActor {
  id: string;
  email: string;
  fullName?: string;
}

/**
 * Orchestre la production d'un état financier (TER, BILAN, RESULTAT) :
 *   1. Vérifie la période existe.
 *   2. Génère le snapshot via FinancialStatementGeneratorService.
 *   3. Vérifie l'équilibre (assertBalanced) — refuse de sauver un état
 *      faux.
 *   4. Rend les fichiers PDF + Excel via StatementRenderService.
 *   5. Stocke les fichiers MinIO et persiste dans
 *      reporting.financial_statement + financial_statement_line.
 *   6. (lock) verrouille le statement — interdit la régénération
 *      et la suppression si la période est aussi close (trigger DB).
 *
 * Idempotent : un appel répété sur (period, type) écrase l'ancien
 * statement (sauf s'il est `locked` → 409).
 */
@Injectable()
export class FinancialStatementService {
  private readonly logger = new Logger(FinancialStatementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly generator: FinancialStatementGeneratorService,
    private readonly renderer: StatementRenderService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------------
  // Génération / persistence
  // ------------------------------------------------------------------

  async generate(
    actor: StatementActor,
    periodId: string,
    type: StatementType,
  ): Promise<FinancialStatement> {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new PeriodNotFoundException(periodId);

    // Si un statement existant est lock → refus
    const existing = await this.prisma.financialStatement.findUnique({
      where: { periodId_type: { periodId, type } },
    });
    if (existing?.locked) {
      throw new FinancialStatementLockedException(existing.id, type);
    }

    // 1. Génère le snapshot
    const result = await this.generator.generate(type, period);
    this.generator.assertBalanced(result);

    // 2. Rend les fichiers
    const renderInput = {
      statement: result,
      periodCode: period.code,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      generatedAt: new Date(),
      generatedBy: actor.fullName ?? actor.email,
    };
    const pdfBuffer = await this.renderer.renderPdf(renderInput);
    const xlsxBuffer = this.renderer.renderExcel(renderInput);

    const folder = `statements/${period.endDate.getUTCFullYear()}/${String(
      period.endDate.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
    const slug = `${type}-${period.code}-${randomUUID().slice(0, 8)}`;
    const pdfKey = `${folder}/${slug}.pdf`;
    const xlsxKey = `${folder}/${slug}.xlsx`;

    await Promise.all([
      this.storage.putObject({
        bucket: STATEMENTS_BUCKET,
        objectKey: pdfKey,
        buffer: pdfBuffer,
        contentType: 'application/pdf',
        metadata: { 'x-statement-type': type, 'x-period-code': period.code },
      }),
      this.storage.putObject({
        bucket: STATEMENTS_BUCKET,
        objectKey: xlsxKey,
        buffer: xlsxBuffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        metadata: { 'x-statement-type': type, 'x-period-code': period.code },
      }),
    ]);

    // 3. Persiste — upsert + remplacement complet des lignes
    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.financialStatementLine.deleteMany({ where: { statementId: existing.id } });
      }
      const totals = result.totals as unknown as Prisma.InputJsonValue;
      const statement = existing
        ? await tx.financialStatement.update({
            where: { id: existing.id },
            data: {
              generatedAt: renderInput.generatedAt,
              generatedBy: actor.id,
              pdfObjectKey: pdfKey,
              xlsxObjectKey: xlsxKey,
              totals,
            },
          })
        : await tx.financialStatement.create({
            data: {
              periodId,
              type,
              generatedAt: renderInput.generatedAt,
              generatedBy: actor.id,
              pdfObjectKey: pdfKey,
              xlsxObjectKey: xlsxKey,
              totals,
            },
          });
      if (result.lines.length > 0) {
        await tx.financialStatementLine.createMany({
          data: result.lines.map((l) => ({
            statementId: statement.id,
            section: l.section,
            label: l.label,
            accountCode: l.accountCode ?? null,
            debit: new Prisma.Decimal(l.debit.toString()),
            credit: new Prisma.Decimal(l.credit.toString()),
            balance: new Prisma.Decimal(l.balance.toString()),
            sortOrder: l.sortOrder,
          })),
        });
      }
      this.logger.log(
        {
          statementId: statement.id,
          type,
          periodCode: period.code,
          lines: result.lines.length,
          actor: actor.email,
        },
        'financial statement generated',
      );
      return statement;
    });
  }

  async findOne(actor: AuthenticatedUser, statementId: string) {
    const s = await this.prisma.financialStatement.findUnique({
      where: { id: statementId },
      include: { lines: { orderBy: { sortOrder: 'asc' } }, period: true },
    });
    if (!s) throw new FinancialStatementNotFoundException(statementId);
    // Sprint F5b-a Lot 1 : BAILLEUR pur ne voit que les états verrouillés
    // (= validés pour audit externe). 404 plutôt que 403 pour ne pas
    // révéler qu'un état en cours est en train d'être préparé.
    if (isBailleurOnly(actor) && !s.locked) {
      this.logger.warn(
        { statementId, actorEmail: actor.email, locked: s.locked },
        'BAILLEUR-only actor blocked from non-locked financial statement',
      );
      throw new FinancialStatementNotFoundException(statementId);
    }
    return s;
  }

  async list(actor: AuthenticatedUser, periodId?: string, type?: StatementType) {
    // Sprint F5b-a Lot 1 : BAILLEUR pur ne voit QUE les locked=true.
    // Filtre serveur — pas seulement UI.
    const lockedFilter = isBailleurOnly(actor) ? { locked: true } : {};
    return this.prisma.financialStatement.findMany({
      where: { periodId, type, ...lockedFilter },
      orderBy: [{ generatedAt: 'desc' }],
      include: { period: true },
      take: 100,
    });
  }

  // ------------------------------------------------------------------
  // Lock
  // ------------------------------------------------------------------

  async lock(actor: StatementActor, statementId: string): Promise<FinancialStatement> {
    const existing = await this.prisma.financialStatement.findUnique({
      where: { id: statementId },
    });
    if (!existing) throw new FinancialStatementNotFoundException(statementId);
    if (existing.locked) {
      return existing; // idempotent
    }
    const updated = await this.prisma.financialStatement.update({
      where: { id: statementId },
      data: { locked: true, lockedAt: new Date(), lockedBy: actor.id },
    });
    this.logger.warn(
      { statementId, type: existing.type, actor: actor.email },
      'financial statement LOCKED (immutable from now on)',
    );
    return updated;
  }

  // ------------------------------------------------------------------
  // Downloads
  // ------------------------------------------------------------------

  async downloadPdf(statementId: string): Promise<{ buffer: Buffer; filename: string }> {
    const s = await this.prisma.financialStatement.findUnique({
      where: { id: statementId },
      include: { period: true },
    });
    if (!s) throw new FinancialStatementNotFoundException(statementId);
    if (!s.pdfObjectKey) throw new FinancialStatementFileNotGeneratedException(statementId, 'pdf');
    const obj = await this.storage.getObject(STATEMENTS_BUCKET, s.pdfObjectKey);
    return {
      buffer: obj.buffer,
      filename: `${s.type}-${s.period.code}.pdf`,
    };
  }

  async downloadExcel(statementId: string): Promise<{ buffer: Buffer; filename: string }> {
    const s = await this.prisma.financialStatement.findUnique({
      where: { id: statementId },
      include: { period: true },
    });
    if (!s) throw new FinancialStatementNotFoundException(statementId);
    if (!s.xlsxObjectKey)
      throw new FinancialStatementFileNotGeneratedException(statementId, 'xlsx');
    const obj = await this.storage.getObject(STATEMENTS_BUCKET, s.xlsxObjectKey);
    return {
      buffer: obj.buffer,
      filename: `${s.type}-${s.period.code}.xlsx`,
    };
  }

  /**
   * Représentation `StatementResult` reconstruite depuis la BD pour des
   * tests ou des affichages "live preview".
   */
  resultFromPersisted(persisted: {
    id: string;
    type: string;
    periodId: string;
    totals: Prisma.JsonValue;
    lines: Array<{
      section: string;
      label: string;
      accountCode: string | null;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      balance: Prisma.Decimal;
      sortOrder: number;
    }>;
    period: { code: string };
  }): StatementResult {
    const totals = persisted.totals as Record<string, number | boolean>;
    return {
      type: persisted.type as StatementType,
      periodId: persisted.periodId,
      periodCode: persisted.period.code,
      lines: persisted.lines.map((l) => ({
        section: l.section,
        label: l.label,
        accountCode: l.accountCode,
        debit: Number(l.debit),
        credit: Number(l.credit),
        balance: Number(l.balance),
        sortOrder: l.sortOrder,
      })),
      totals: {
        leftTotal: Number(totals.leftTotal ?? 0),
        rightTotal: Number(totals.rightTotal ?? 0),
        balanced: Boolean(totals.balanced),
        ...totals,
      },
    };
  }
}
