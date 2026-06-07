import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EntityNotFoundException,
  NoteTechniqueInvalidTransitionException,
  NoteTechniqueRejectionReasonRequiredException,
} from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { CreateNoteTechniqueDto } from './dto/create-note-technique.dto';
import type { UpdateNoteTechniqueDto } from './dto/update-note-technique.dto';

const INCLUDE = {
  overheadRule: true,
  budgetLines: { include: { budgetLine: true } },
} as const;

/**
 * Statuts du workflow Note Technique (ADR-006). State machine US-051 :
 *   draft → pending_daf → validated_daf → active → superseded
 *                ↘ (reject) draft
 */
const NT_STATUS = {
  DRAFT: 'draft',
  PENDING_DAF: 'pending_daf',
  VALIDATED_DAF: 'validated_daf',
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
} as const;

/** Longueur minimale d'un motif de rejet DAF (traçabilité de la correction). */
const MIN_REJECTION_REASON_LENGTH = 20;

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

  // ------------------------------------------------------------------
  // Transitions de workflow (US-051, ADR-006) — state machine pure.
  // La Segregation of Duties (drafted_by ≠ validated_by, ADR-009) et la
  // matérialisation des note_technique_budget_line à l'activation sont
  // l'objet d'US-053/US-056 — volontairement absentes ici.
  // ------------------------------------------------------------------

  /**
   * GO soumet la Note Technique pour validation DAF : `draft → pending_daf`.
   * Pose `submitted_to_daf_at`.
   */
  async submitToDaf(id: string, actor: AuthenticatedUser) {
    const existing = await this.requireNote(id);
    this.assertStatus(existing, NT_STATUS.DRAFT, NT_STATUS.PENDING_DAF);

    const nt = await this.prisma.noteTechnique.update({
      where: { id },
      data: { status: NT_STATUS.PENDING_DAF, submittedToDafAt: new Date() },
      include: INCLUDE,
    });
    this.logTransition(id, NT_STATUS.DRAFT, NT_STATUS.PENDING_DAF, actor);
    return this.serialize(nt);
  }

  /**
   * DAF valide la Note Technique : `pending_daf → validated_daf`.
   * Pose `validated_by_daf_user_id` + `validated_at`.
   */
  async validateAsDaf(id: string, actor: AuthenticatedUser) {
    const existing = await this.requireNote(id);
    this.assertStatus(existing, NT_STATUS.PENDING_DAF, NT_STATUS.VALIDATED_DAF);

    const validatedByDafUserId = await this.resolveAppUserId(actor);
    const nt = await this.prisma.noteTechnique.update({
      where: { id },
      data: {
        status: NT_STATUS.VALIDATED_DAF,
        validatedByDafUserId,
        validatedAt: new Date(),
      },
      include: INCLUDE,
    });
    this.logTransition(id, NT_STATUS.PENDING_DAF, NT_STATUS.VALIDATED_DAF, actor);
    return this.serialize(nt);
  }

  /**
   * DAF retourne la Note Technique pour corrections : `pending_daf → draft`.
   * Le motif (≥ 20 caractères) est obligatoire et journalisé (aucune colonne
   * dédiée au DDL US-030 — la traçabilité passe par le log structuré).
   * Réinitialise `submitted_to_daf_at` (la NT redevient un brouillon).
   */
  async rejectAsDaf(id: string, actor: AuthenticatedUser, reason: string) {
    const existing = await this.requireNote(id);
    this.assertStatus(existing, NT_STATUS.PENDING_DAF, NT_STATUS.DRAFT);

    if (!reason || reason.trim().length < MIN_REJECTION_REASON_LENGTH) {
      throw new NoteTechniqueRejectionReasonRequiredException(id);
    }

    const nt = await this.prisma.noteTechnique.update({
      where: { id },
      data: { status: NT_STATUS.DRAFT, submittedToDafAt: null },
      include: INCLUDE,
    });
    this.logTransition(id, NT_STATUS.PENDING_DAF, NT_STATUS.DRAFT, actor, reason.trim());
    return this.serialize(nt);
  }

  /**
   * GO active la Note Technique validée : `validated_daf → active`.
   *
   * Opération ATOMIQUE (transaction Prisma) : si une autre Note Technique du
   * MÊME grant est déjà `active`, elle est d'abord passée en `superseded`
   * (transition interne) AVANT d'activer la nouvelle, pour respecter l'index
   * UNIQUE partiel `uq_note_technique_active_per_grant` (≤ 1 active par grant,
   * US-031). La nouvelle NT pointe vers l'ancienne via `supersedes_id`.
   */
  async activate(id: string, actor: AuthenticatedUser) {
    const existing = await this.requireNote(id);
    this.assertStatus(existing, NT_STATUS.VALIDATED_DAF, NT_STATUS.ACTIVE);

    const { activated, supersededId } = await this.prisma.$transaction(async (tx) => {
      const currentActive = await tx.noteTechnique.findFirst({
        where: {
          grantId: existing.grantId,
          status: NT_STATUS.ACTIVE,
          deletedAt: null,
          id: { not: id },
        },
        select: { id: true },
      });

      if (currentActive) {
        // Transition interne : ancienne active → superseded (avant activation).
        await tx.noteTechnique.update({
          where: { id: currentActive.id },
          data: { status: NT_STATUS.SUPERSEDED },
        });
      }

      const updated = await tx.noteTechnique.update({
        where: { id },
        data: {
          status: NT_STATUS.ACTIVE,
          activatedAt: new Date(),
          ...(currentActive ? { supersedesId: currentActive.id } : {}),
        },
        include: INCLUDE,
      });

      return { activated: updated, supersededId: currentActive?.id ?? null };
    });

    if (supersededId) {
      this.logTransition(supersededId, NT_STATUS.ACTIVE, NT_STATUS.SUPERSEDED, actor);
    }
    this.logTransition(id, NT_STATUS.VALIDATED_DAF, NT_STATUS.ACTIVE, actor);
    return this.serialize(activated);
  }

  // ------------------------------------------------------------------
  // Helpers de transition
  // ------------------------------------------------------------------

  /** Charge une NT non supprimée ou lève EntityNotFoundException. */
  private async requireNote(id: string) {
    const nt = await this.prisma.noteTechnique.findFirst({ where: { id, deletedAt: null } });
    if (!nt) {
      throw new EntityNotFoundException('NoteTechnique', { id });
    }
    return nt;
  }

  /** Garde de transition : le statut courant doit valoir `expected`. */
  private assertStatus(
    nt: { id: string; status: string },
    expected: string,
    target: string,
  ): void {
    if (nt.status !== expected) {
      throw new NoteTechniqueInvalidTransitionException(nt.id, nt.status, target);
    }
  }

  /** Journalise une transition de workflow (Pino structuré). */
  private logTransition(
    noteId: string,
    from: string,
    to: string,
    actor: AuthenticatedUser,
    reason?: string,
  ): void {
    this.logger.log(
      {
        event: 'note_technique_transition',
        noteId,
        from,
        to,
        actorId: actor.id,
        ...(reason ? { reason } : {}),
      },
      `note technique ${noteId} transition ${from} → ${to}`,
    );
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
