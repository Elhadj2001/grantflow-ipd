import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { GrantAgreement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AlreadyActiveException,
  AlreadyInactiveException,
  DuplicateCodeException,
  EntityNotFoundException,
  GrantHasTransactionsException,
  InactiveDonorException,
  InactiveProjectException,
} from '../../common/exceptions/business.exception';
import type { CreateGrantDto } from './dto/create-grant.dto';
import type { UpdateGrantDto } from './dto/update-grant.dto';
import type { GrantQueryDto } from './dto/grant-query.dto';

const ENTITY_NAME = 'Grant';
const PG_UNIQUE_VIOLATION = 'P2002';

const CLOSED_STATUS = 'closed';
const SUSPENDED_STATUS = 'suspended';
const ACTIVE_STATUS = 'active';

export interface PaginatedGrants {
  data: GrantAgreement[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface DashboardBudgetLineEntry {
  budgetLineId: string;
  code: string;
  label: string;
  budgeted: number;
  engaged: number;
  consumed: number;
  available: number;
  utilization: number;
}

export interface GrantDashboard {
  grantRef: string;
  totalBudgeted: number;
  totalEngaged: number;
  totalConsumed: number;
  totalAvailable: number;
  utilization: number;
  byBudgetLine: DashboardBudgetLineEntry[];
  monthsRemaining: number;
  alerts: string[];
}

/**
 * Forme du résultat de la vue `co.v_budget_tracking` quand on filtre par grant.
 * Pas de typage Prisma direct sur les vues — on encode les colonnes ici.
 */
interface BudgetTrackingRow {
  budget_line_id: string;
  budget_line_code: string;
  budget_line_label: string;
  grant_ref: string;
  project_code: string;
  project_title: string;
  budgeted_amount: Prisma.Decimal;
  engaged_amount: Prisma.Decimal;
  consumed_amount: Prisma.Decimal;
  available_amount: Prisma.Decimal;
}

@Injectable()
export class GrantService {
  private readonly logger = new Logger(GrantService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  async findMany(query: GrantQueryDto): Promise<PaginatedGrants> {
    const where = GrantService.buildWhere(query);
    const orderBy: Prisma.GrantAgreementOrderByWithRelationInput = {
      [query.sort]: query.order,
    };
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.grantAgreement.findMany({ where, orderBy, skip, take: query.pageSize }),
      this.prisma.grantAgreement.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + data.length < total,
    };
  }

  async findOne(id: string): Promise<GrantAgreement & { budgetLineCount: number }> {
    const grant = await this.prisma.grantAgreement.findUnique({
      where: { id },
      include: { _count: { select: { budgetLines: true } } },
    });
    if (!grant) throw new EntityNotFoundException(ENTITY_NAME, { id });
    const { _count, ...rest } = grant;
    return { ...rest, budgetLineCount: _count.budgetLines };
  }

  async findByReference(reference: string): Promise<GrantAgreement & { budgetLineCount: number }> {
    const grant = await this.prisma.grantAgreement.findUnique({
      where: { reference },
      include: { _count: { select: { budgetLines: true } } },
    });
    if (!grant) throw new EntityNotFoundException(ENTITY_NAME, { reference });
    const { _count, ...rest } = grant;
    return { ...rest, budgetLineCount: _count.budgetLines };
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  async create(dto: CreateGrantDto): Promise<GrantAgreement> {
    await this.assertDonorAndProjectActive(dto.donorId, dto.projectId);
    try {
      return await this.prisma.grantAgreement.create({
        data: {
          reference: dto.reference,
          donorId: dto.donorId,
          projectId: dto.projectId,
          amount: new Prisma.Decimal(dto.amount),
          currency: dto.currency,
          overheadRate: new Prisma.Decimal(dto.overheadRate),
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          status: dto.status,
          signedAt: dto.signedAt ? new Date(dto.signedAt) : null,
          notes: dto.notes ?? null,
        },
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.reference);
    }
  }

  async replace(id: string, dto: CreateGrantDto): Promise<GrantAgreement> {
    await this.ensureExists(id);
    await this.assertDonorAndProjectActive(dto.donorId, dto.projectId);
    try {
      return await this.prisma.grantAgreement.update({
        where: { id },
        data: {
          reference: dto.reference,
          donorId: dto.donorId,
          projectId: dto.projectId,
          amount: new Prisma.Decimal(dto.amount),
          currency: dto.currency,
          overheadRate: new Prisma.Decimal(dto.overheadRate),
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          status: dto.status,
          signedAt: dto.signedAt ? new Date(dto.signedAt) : null,
          notes: dto.notes ?? null,
        },
      });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.reference);
    }
  }

  async update(id: string, dto: UpdateGrantDto): Promise<GrantAgreement> {
    await this.ensureExists(id);

    // Si on touche aux FK on revalide leur état.
    if (dto.donorId !== undefined || dto.projectId !== undefined) {
      const existing = await this.prisma.grantAgreement.findUniqueOrThrow({ where: { id } });
      await this.assertDonorAndProjectActive(
        dto.donorId ?? existing.donorId,
        dto.projectId ?? existing.projectId,
      );
    }

    const data: Prisma.GrantAgreementUpdateInput = {};
    if (dto.reference !== undefined) data.reference = dto.reference;
    if (dto.donorId !== undefined) data.donor = { connect: { id: dto.donorId } };
    if (dto.projectId !== undefined) data.project = { connect: { id: dto.projectId } };
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.overheadRate !== undefined) data.overheadRate = new Prisma.Decimal(dto.overheadRate);
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.signedAt !== undefined) {
      data.signedAt = dto.signedAt === null ? null : new Date(dto.signedAt);
    }
    if (dto.notes !== undefined) data.notes = dto.notes;

    try {
      return await this.prisma.grantAgreement.update({ where: { id }, data });
    } catch (e) {
      this.handlePrismaWriteError(e, dto.reference ?? '(unchanged)');
    }
  }

  /**
   * Soft delete (clôture). Refus si des écritures sont déjà enregistrées
   * (table `gl.journal_line` référence ce grant). Préserve la traçabilité
   * comptable demandée par CLAUDE.md §2 règle 1.
   */
  async softDelete(id: string): Promise<GrantAgreement> {
    const grant = await this.ensureExists(id);
    if (grant.status === CLOSED_STATUS) {
      throw new AlreadyInactiveException(ENTITY_NAME, id);
    }

    const txCount = await this.prisma.journalLine.count({ where: { grantId: id } });
    if (txCount > 0) {
      throw new GrantHasTransactionsException(id, txCount);
    }

    return this.prisma.grantAgreement.update({
      where: { id },
      data: { status: CLOSED_STATUS },
    });
  }

  async suspend(id: string): Promise<GrantAgreement> {
    const grant = await this.ensureExists(id);
    if (grant.status === SUSPENDED_STATUS) {
      throw new AlreadyInactiveException(ENTITY_NAME, id);
    }
    if (grant.status === CLOSED_STATUS) {
      // On ne suspend pas un grant déjà fermé.
      throw new AlreadyInactiveException(ENTITY_NAME, id);
    }
    return this.prisma.grantAgreement.update({
      where: { id },
      data: { status: SUSPENDED_STATUS },
    });
  }

  async reactivate(id: string): Promise<GrantAgreement> {
    const grant = await this.ensureExists(id);
    if (grant.status === ACTIVE_STATUS) {
      throw new AlreadyActiveException(ENTITY_NAME, id);
    }
    return this.prisma.grantAgreement.update({
      where: { id },
      data: { status: ACTIVE_STATUS },
    });
  }

  // ------------------------------------------------------------------
  // Dashboard
  // ------------------------------------------------------------------

  async dashboard(id: string): Promise<GrantDashboard> {
    const grant = await this.ensureExists(id);

    // 1) Lignes budgétaires + suivi via la vue Postgres si dispo,
    //    sinon fallback Prisma (utilisé en CI vierge ou DB jeune).
    let rows: BudgetTrackingRow[] = [];
    try {
      rows = await this.prisma.$queryRaw<BudgetTrackingRow[]>`
        SELECT bl.id AS budget_line_id,
               bl.code AS budget_line_code,
               bl.label AS budget_line_label,
               v.grant_ref,
               v.project_code,
               v.project_title,
               v.budgeted_amount,
               v.engaged_amount,
               v.consumed_amount,
               v.available_amount
        FROM co.v_budget_tracking v
        JOIN ref.budget_line bl ON bl.id = v.budget_line_id
        WHERE bl.grant_id = ${id}::uuid
      `;
    } catch (e) {
      this.logger.warn({ err: e }, 'v_budget_tracking unavailable, fallback to Prisma aggregate');
      rows = await this.dashboardFallback(id);
    }

    const byBudgetLine: DashboardBudgetLineEntry[] = rows.map((r) => {
      const budgeted = Number(r.budgeted_amount);
      const engaged = Number(r.engaged_amount);
      const consumed = Number(r.consumed_amount);
      const available = budgeted - engaged;
      return {
        budgetLineId: r.budget_line_id,
        code: r.budget_line_code,
        label: r.budget_line_label,
        budgeted,
        engaged,
        consumed,
        available,
        utilization: budgeted > 0 ? engaged / budgeted : 0,
      };
    });

    const totalBudgeted = byBudgetLine.reduce((s, l) => s + l.budgeted, 0);
    const totalEngaged = byBudgetLine.reduce((s, l) => s + l.engaged, 0);
    const totalConsumed = byBudgetLine.reduce((s, l) => s + l.consumed, 0);
    const totalAvailable = totalBudgeted - totalEngaged;
    const utilization = totalBudgeted > 0 ? totalEngaged / totalBudgeted : 0;

    // 2) Mois restants jusqu'à endDate (clamp à 0).
    const now = new Date();
    const months =
      (grant.endDate.getFullYear() - now.getFullYear()) * 12 +
      (grant.endDate.getMonth() - now.getMonth());
    const monthsRemaining = Math.max(0, months);

    // 3) Alertes basiques : lignes >90% utilisées + échéance proche (<60j).
    const alerts: string[] = [];
    for (const l of byBudgetLine) {
      if (l.utilization >= 0.9) {
        alerts.push(`${l.code} à ${Math.round(l.utilization * 100)}% utilisé`);
      }
    }
    const daysRemaining = Math.ceil(
      (grant.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysRemaining > 0 && daysRemaining < 60) {
      alerts.push(`Échéance bailleur dans ${daysRemaining} jour${daysRemaining > 1 ? 's' : ''}`);
    }

    return {
      grantRef: grant.reference,
      totalBudgeted,
      totalEngaged,
      totalConsumed,
      totalAvailable,
      utilization,
      byBudgetLine,
      monthsRemaining,
      alerts,
    };
  }

  /**
   * Calcul équivalent en TypeScript (cas où la vue Postgres est absente,
   * ex. CI sur base vierge créée par `prisma db push`).
   */
  private async dashboardFallback(grantId: string): Promise<BudgetTrackingRow[]> {
    const lines = await this.prisma.budgetLine.findMany({ where: { grantId } });
    return lines.map((bl) => ({
      budget_line_id: bl.id,
      budget_line_code: bl.code,
      budget_line_label: bl.label,
      grant_ref: '',
      project_code: '',
      project_title: '',
      budgeted_amount: bl.budgetedAmount,
      engaged_amount: new Prisma.Decimal(0),
      consumed_amount: new Prisma.Decimal(0),
      available_amount: bl.budgetedAmount,
    }));
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async ensureExists(id: string): Promise<GrantAgreement> {
    const grant = await this.prisma.grantAgreement.findUnique({ where: { id } });
    if (!grant) throw new EntityNotFoundException(ENTITY_NAME, { id });
    return grant;
  }

  /**
   * Garde-fou métier : on n'attache pas un grant à un donor inactif
   * ni à un projet suspendu/clos. Sinon les contrôles budgétaires
   * descendants (DA, BC) feraient référence à un référentiel mort.
   */
  private async assertDonorAndProjectActive(donorId: string, projectId: string): Promise<void> {
    const [donor, project] = await Promise.all([
      this.prisma.donor.findUnique({ where: { id: donorId }, select: { isActive: true } }),
      this.prisma.project.findUnique({ where: { id: projectId }, select: { status: true } }),
    ]);

    if (!donor) throw new EntityNotFoundException('Donor', { id: donorId });
    if (!donor.isActive) throw new InactiveDonorException(donorId);

    if (!project) throw new EntityNotFoundException('Project', { id: projectId });
    if (project.status !== ACTIVE_STATUS) {
      throw new InactiveProjectException(projectId, project.status);
    }
  }

  private handlePrismaWriteError(e: unknown, reference: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === PG_UNIQUE_VIOLATION) {
      throw new DuplicateCodeException(ENTITY_NAME, reference);
    }
    this.logger.error({ err: e, reference }, 'grant write error (rethrow)');
    throw e instanceof Error ? e : new Error(String(e));
  }

  static buildWhere(query: GrantQueryDto): Prisma.GrantAgreementWhereInput {
    const where: Prisma.GrantAgreementWhereInput = {};

    if (query.donorId) where.donorId = query.donorId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.status) where.status = query.status;
    if (query.currency) where.currency = query.currency;

    if (query.startsAfter) where.startDate = { gte: new Date(query.startsAfter) };
    if (query.endsBefore) where.endDate = { lte: new Date(query.endsBefore) };

    if (query.q) {
      const needle = query.q.trim();
      where.OR = [
        { reference: { contains: needle, mode: 'insensitive' } },
        { notes: { contains: needle, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}
