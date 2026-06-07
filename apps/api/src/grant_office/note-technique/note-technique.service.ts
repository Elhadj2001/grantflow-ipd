import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityNotFoundException } from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { CreateNoteTechniqueDto } from './dto/create-note-technique.dto';
import type { UpdateNoteTechniqueDto } from './dto/update-note-technique.dto';

const INCLUDE = {
  overheadRule: true,
  budgetLines: { include: { budgetLine: true } },
} as const;

/**
 * CRUD basique des Notes Techniques (ADR-006). SCAFFOLDING US-033 :
 * création en `draft` + édition du draft uniquement. Les transitions de
 * statut (GO→DAF→validated_daf→active→superseded) et la matérialisation
 * budgétaire à l'activation sont l'objet de Sprint S5 — volontairement
 * absentes ici.
 */
@Injectable()
export class NoteTechniqueService {
  private readonly logger = new Logger(NoteTechniqueService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Convertit le BigInt XOF en number pour une sérialisation JSON sûre. */
  private serialize<T extends { ownFundsContributionXof: bigint }>(nt: T) {
    return { ...nt, ownFundsContributionXof: Number(nt.ownFundsContributionXof) };
  }

  async list(filter: { grantId?: string; status?: string }) {
    const rows = await this.prisma.noteTechnique.findMany({
      where: {
        deletedAt: null,
        ...(filter.grantId ? { grantId: filter.grantId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: INCLUDE,
      orderBy: [{ grantId: 'asc' }, { version: 'desc' }],
    });
    return rows.map((r) => this.serialize(r));
  }

  async findById(id: string) {
    const nt = await this.prisma.noteTechnique.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!nt) {
      throw new EntityNotFoundException('NoteTechnique', { id });
    }
    return this.serialize(nt);
  }

  async create(actor: AuthenticatedUser, dto: CreateNoteTechniqueDto) {
    const draftedByUserId = await this.resolveAppUserId(actor);
    const nt = await this.prisma.noteTechnique.create({
      data: {
        grantId: dto.grantId,
        status: 'draft',
        draftedByUserId,
        budgetCode: dto.budgetCode,
        reportingFinalDate: dto.reportingFinalDate,
        reportingIntermediateDates: dto.reportingIntermediateDates,
        ownFundsContributionXof: BigInt(dto.ownFundsContributionXof),
        ownFundsContributionCurrency: dto.ownFundsContributionCurrency ?? null,
        overheadRuleId: dto.overheadRuleId ?? null,
        singleActorAuthorized: dto.singleActorAuthorized,
        singleActorJustification: dto.singleActorJustification ?? null,
        notes: dto.notes ?? null,
      },
      include: INCLUDE,
    });
    this.logger.log(
      { event: 'note_technique_created', id: nt.id, grantId: nt.grantId, actorId: actor.id },
      'note technique created (draft)',
    );
    return this.serialize(nt);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateNoteTechniqueDto) {
    const existing = await this.prisma.noteTechnique.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      throw new EntityNotFoundException('NoteTechnique', { id });
    }
    // US-033 : édition autorisée uniquement en draft (transitions = Sprint S5).
    if (existing.status !== 'draft') {
      throw new ConflictException(
        `Note Technique ${id} en statut '${existing.status}' — édition possible uniquement en 'draft'.`,
      );
    }
    const nt = await this.prisma.noteTechnique.update({
      where: { id },
      data: {
        ...(dto.budgetCode !== undefined ? { budgetCode: dto.budgetCode } : {}),
        ...(dto.reportingFinalDate !== undefined ? { reportingFinalDate: dto.reportingFinalDate } : {}),
        ...(dto.reportingIntermediateDates !== undefined
          ? { reportingIntermediateDates: dto.reportingIntermediateDates }
          : {}),
        ...(dto.ownFundsContributionXof !== undefined
          ? { ownFundsContributionXof: BigInt(dto.ownFundsContributionXof) }
          : {}),
        ...(dto.ownFundsContributionCurrency !== undefined
          ? { ownFundsContributionCurrency: dto.ownFundsContributionCurrency }
          : {}),
        ...(dto.overheadRuleId !== undefined ? { overheadRuleId: dto.overheadRuleId } : {}),
        ...(dto.singleActorAuthorized !== undefined
          ? { singleActorAuthorized: dto.singleActorAuthorized }
          : {}),
        ...(dto.singleActorJustification !== undefined
          ? { singleActorJustification: dto.singleActorJustification }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
      include: INCLUDE,
    });
    this.logger.log({ event: 'note_technique_updated', id, actorId: actor.id }, 'note technique draft updated');
    return this.serialize(nt);
  }

  /** Bridge Keycloak sub → auth.app_user.id (par e-mail). Null si inconnu. */
  private async resolveAppUserId(actor: AuthenticatedUser): Promise<string | null> {
    if (!actor.email) return null;
    const u = await this.prisma.appUser.findUnique({
      where: { email: actor.email },
      select: { id: true },
    });
    return u?.id ?? null;
  }
}
