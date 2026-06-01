import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrStatus, PoStatus } from '@prisma/client';
import type { PurchaseRequest, PurchaseRequestLine } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import type { Role } from '../auth/types/roles';
import {
  BudgetLineNotInGrantException,
  CashBoxInactiveException,
  CashBoxRequiredException,
  CashLimitPerDayExceededException,
  CashLimitPerRequestExceededException,
  CashPaymentNotAllowedException,
  EntityNotFoundException,
  GrantNotActiveException,
  InsufficientBudgetException,
  PrNotDeletableException,
  PrNotEditableException,
  PrNotOwnedException,
  ProjectGrantMismatchException,
} from '../common/exceptions/business.exception';
import { CreatePurchaseRequestDto } from './dto/create-pr.dto';
import type { UpdatePurchaseRequestDto } from './dto/update-pr.dto';
import type { PurchaseRequestQueryDto } from './dto/pr-query.dto';
import type { CheckBudgetLineDto, CheckBudgetResponseDto } from './dto/check-budget.dto';
import { canActorViewPr, ACHETEUR_VISIBLE_STATUSES } from './helpers/pr-visibility.helper';

const ENTITY_NAME = 'PurchaseRequest';

/**
 * Rôles qui voient toutes les DA, indépendamment de l'auteur. DEMANDEUR
 * et PI sont limités à leurs propres DA (ownership-scoped).
 */
const FULL_VIEW_ROLES: ReadonlyArray<Role> = [
  'CONTROLEUR',
  'DAF',
  'COMPTABLE',
  'TRESORIER',
  'SUPER_ADMIN',
];

/** Statuts PR considérés "ouverts" → consomment du budget (engagement). */
const PENDING_STATUSES: PrStatus[] = [
  PrStatus.submitted,
  PrStatus.pending_pi,
  PrStatus.pending_cg,
  PrStatus.pending_daf,
  PrStatus.approved,
];

/** Statuts PO ouverts → engagent du budget. */
const OPEN_PO_STATUSES: PoStatus[] = [
  PoStatus.draft,
  PoStatus.sent,
  PoStatus.acknowledged,
  PoStatus.partially_received,
  PoStatus.received,
  PoStatus.invoiced,
];

const ACTIVE_GRANT_STATUS = 'active';
const DRAFT_STATUS = 'draft';
/**
 * Au sprint 2.1, submit() passait en 'submitted'. Au sprint 2.2, le moteur
 * d'approbation prend le relais : `submit()` enchaîne directement sur la
 * 1ère étape (`pending_pi` pour les DA standard).
 */
const PENDING_PI_STATUS = 'pending_pi';
const PENDING_CAISSIER_STATUS = 'pending_caissier';
const CANCELLED_STATUS = 'cancelled';

export interface PaginatedPrs {
  data: PurchaseRequest[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface PrWithLines extends PurchaseRequest {
  lines: PurchaseRequestLine[];
}

@Injectable()
export class PurchaseRequestService {
  private readonly logger = new Logger(PurchaseRequestService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  async findMany(
    actor: AuthenticatedUser,
    query: PurchaseRequestQueryDto,
  ): Promise<PaginatedPrs> {
    const scopedUserId = this.hasFullView(actor) ? null : await this.resolveAppUserId(actor);
    const where = this.buildWhere(actor, query, scopedUserId);
    const orderBy: Prisma.PurchaseRequestOrderByWithRelationInput = { [query.sort]: query.order };
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.purchaseRequest.findMany({ where, orderBy, skip, take: query.pageSize }),
      this.prisma.purchaseRequest.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + data.length < total,
    };
  }

  async findOne(actor: AuthenticatedUser, prId: string): Promise<PrWithLines> {
    // On inclut `project.piUserId` pour permettre au helper de visibilité
    // d'autoriser le PI rattaché au projet, sans nécessiter un second
    // round-trip. La PR est ensuite renvoyée avec le shape historique
    // (`{...pr, lines}`) — `project` reste un détail interne au scope check.
    const pr = await this.prisma.purchaseRequest.findUnique({
      where: { id: prId },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
        project: { select: { piUserId: true } },
      },
    });
    if (!pr) throw new EntityNotFoundException(ENTITY_NAME, { id: prId });

    const appUserId = await this.resolveAppUserId(actor);
    if (!canActorViewPr(actor, appUserId, pr)) {
      // 404 plutôt que 403 — on ne révèle pas l'existence (OWASP). On garde
      // le code historique `PR_NOT_OWNED` pour ne pas casser les consommateurs
      // qui distinguent "PR inconnue" et "PR non visible".
      throw new PrNotOwnedException('hidden');
    }

    // On ne fuit pas `project` au-delà du scope-check : le contrat retour
    // est `PrWithLines` (sans project) — on déstructure pour rester compatible.
    const { project: _project, ...prWithLines } = pr;
    return prWithLines;
  }

  // ------------------------------------------------------------------
  // Create
  // ------------------------------------------------------------------

  async create(actor: AuthenticatedUser, dto: CreatePurchaseRequestDto): Promise<PrWithLines> {
    const grant = await this.prisma.grantAgreement.findUnique({
      where: { id: dto.grantId },
      include: { budgetLines: { select: { id: true } } },
    });
    if (!grant) throw new EntityNotFoundException('Grant', { id: dto.grantId });

    if (grant.projectId !== dto.projectId) {
      throw new ProjectGrantMismatchException(dto.grantId, dto.projectId, grant.projectId);
    }

    // Chaque ligne doit pointer vers une BL de CE grant.
    const validBlIds = new Set(grant.budgetLines.map((b) => b.id));
    for (const line of dto.lines) {
      if (!validBlIds.has(line.budgetLineId)) {
        throw new BudgetLineNotInGrantException(line.budgetLineId, dto.grantId);
      }
    }

    // Calcul total (côté app — DB ne le calcule que sur PRL via GENERATED).
    const totalAmount = dto.lines.reduce(
      (sum, l) => sum + Number(l.quantity) * Number(l.unitPrice),
      0,
    );

    const appUserId = await this.resolveAppUserId(actor);

    // Vérifications spécifiques cash (petty_cash / cash_advance).
    if (dto.requestType === 'petty_cash' || dto.requestType === 'cash_advance') {
      await this.assertCashInvariants({
        requestType: dto.requestType,
        cashBoxId: dto.cashBoxId,
        grant: { id: grant.id, allowsCashPayment: grant.allowsCashPayment },
        requesterId: appUserId,
        totalAmount,
      });
    }

    const prNumber = await this.generatePrNumber();

    const pr = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaseRequest.create({
        data: {
          prNumber,
          requestedBy: appUserId,
          neededBy: dto.neededBy,
          status: DRAFT_STATUS,
          projectId: dto.projectId,
          grantId: dto.grantId,
          costCenterId: dto.costCenterId,
          activityId: dto.activityId,
          totalAmount,
          currency: dto.currency,
          description: dto.description,
          requestType: dto.requestType,
          cashBoxId: dto.cashBoxId ?? null,
          lines: {
            create: dto.lines.map((line, i) => ({
              lineNumber: i + 1,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitPrice: line.unitPrice,
              budgetLineId: line.budgetLineId,
            })),
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      return created;
    });

    this.logger.log(
      {
        prId: pr.id,
        prNumber,
        actorId: actor.id,
        total: totalAmount,
        currency: dto.currency,
        requestType: dto.requestType,
      },
      'purchase request created',
    );
    return pr;
  }

  /**
   * Invariants métier cash :
   *   1. cashBoxId présent (DTO le force déjà via superRefine, on revérifie ici)
   *   2. cashBox.isActive=true
   *   3. grant.allowsCashPayment=true
   *   4. total ≤ cashBox.perRequestMax
   *   5. (petty_cash uniquement) somme du jour pour ce demandeur sur cette
   *       caisse ≤ cashBox.perDayUserMax
   *
   * cash_advance n'a PAS de plafond/jour (les avances sont moins fréquentes
   * et plus volumineuses, gérées différemment).
   */
  private async assertCashInvariants(args: {
    requestType: 'petty_cash' | 'cash_advance';
    cashBoxId?: string;
    grant: { id: string; allowsCashPayment: boolean };
    requesterId: string;
    totalAmount: number;
  }): Promise<void> {
    if (!args.cashBoxId) throw new CashBoxRequiredException(args.requestType);

    const cashBox = await this.prisma.cashBox.findUnique({ where: { id: args.cashBoxId } });
    if (!cashBox) throw new EntityNotFoundException('CashBox', { id: args.cashBoxId });
    if (!cashBox.isActive) throw new CashBoxInactiveException(cashBox.id);

    if (!args.grant.allowsCashPayment) {
      throw new CashPaymentNotAllowedException(args.grant.id);
    }

    const perReqMax = Number(cashBox.perRequestMax);
    if (args.totalAmount > perReqMax) {
      throw new CashLimitPerRequestExceededException(cashBox.id, args.totalAmount, perReqMax);
    }

    if (args.requestType === 'petty_cash') {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date();
      end.setUTCHours(23, 59, 59, 999);

      const agg = await this.prisma.purchaseRequest.aggregate({
        _sum: { totalAmount: true },
        where: {
          cashBoxId: cashBox.id,
          requestType: 'petty_cash',
          requestedBy: args.requesterId,
          status: {
            in: [
              PrStatus.draft,
              PrStatus.pending_caissier,
              PrStatus.approved,
            ],
          },
          requestedAt: { gte: start, lte: end },
        },
      });
      const todaySpent = Number(agg._sum?.totalAmount ?? 0);
      const perDayMax = Number(cashBox.perDayUserMax);
      if (todaySpent + args.totalAmount > perDayMax) {
        throw new CashLimitPerDayExceededException(
          cashBox.id,
          todaySpent,
          args.totalAmount,
          perDayMax,
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Update / Cancel
  // ------------------------------------------------------------------

  async update(
    actor: AuthenticatedUser,
    prId: string,
    dto: UpdatePurchaseRequestDto,
  ): Promise<PrWithLines> {
    const pr = await this.prisma.purchaseRequest.findUnique({
      where: { id: prId },
      include: { lines: true },
    });
    if (!pr) throw new EntityNotFoundException(ENTITY_NAME, { id: prId });
    await this.assertCanWrite(actor, pr);

    if (pr.status !== DRAFT_STATUS) {
      throw new PrNotEditableException(prId, pr.status);
    }

    // Si l'utilisateur change projectId ou grantId, on revalide la cohérence.
    const nextProjectId = dto.projectId ?? pr.projectId;
    const nextGrantId = dto.grantId ?? pr.grantId;

    if (dto.projectId !== undefined || dto.grantId !== undefined) {
      const grant = await this.prisma.grantAgreement.findUnique({
        where: { id: nextGrantId },
        select: { projectId: true },
      });
      if (!grant) throw new EntityNotFoundException('Grant', { id: nextGrantId });
      if (grant.projectId !== nextProjectId) {
        throw new ProjectGrantMismatchException(nextGrantId, nextProjectId, grant.projectId);
      }
    }

    // Si on remplace les lignes, on revalide leur grant ET on recalcule total.
    let totalAmount = Number(pr.totalAmount);
    if (dto.lines) {
      const validBlIds = new Set(
        (
          await this.prisma.budgetLine.findMany({
            where: { grantId: nextGrantId },
            select: { id: true },
          })
        ).map((b) => b.id),
      );
      for (const line of dto.lines) {
        if (!validBlIds.has(line.budgetLineId)) {
          throw new BudgetLineNotInGrantException(line.budgetLineId, nextGrantId);
        }
      }
      totalAmount = dto.lines.reduce(
        (sum, l) => sum + Number(l.quantity) * Number(l.unitPrice),
        0,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.lines) {
        // Replace-all : drop puis recrée. Plus simple qu'un diff par ID.
        await tx.purchaseRequestLine.deleteMany({ where: { prId } });
      }
      const updated = await tx.purchaseRequest.update({
        where: { id: prId },
        data: {
          neededBy: dto.neededBy,
          description: dto.description,
          projectId: dto.projectId,
          grantId: dto.grantId,
          costCenterId: dto.costCenterId,
          activityId: dto.activityId,
          currency: dto.currency,
          totalAmount,
          updatedAt: new Date(),
          ...(dto.lines && {
            lines: {
              create: dto.lines.map((line, i) => ({
                lineNumber: i + 1,
                description: line.description,
                quantity: line.quantity,
                unit: line.unit,
                unitPrice: line.unitPrice,
                budgetLineId: line.budgetLineId,
              })),
            },
          }),
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      return updated;
    });
  }

  async cancel(actor: AuthenticatedUser, prId: string): Promise<PurchaseRequest> {
    const pr = await this.prisma.purchaseRequest.findUnique({ where: { id: prId } });
    if (!pr) throw new EntityNotFoundException(ENTITY_NAME, { id: prId });
    await this.assertCanWrite(actor, pr);

    if (pr.status !== DRAFT_STATUS) {
      throw new PrNotDeletableException(prId, pr.status);
    }

    return this.prisma.purchaseRequest.update({
      where: { id: prId },
      data: { status: CANCELLED_STATUS },
    });
  }

  // ------------------------------------------------------------------
  // Submit + budget check
  // ------------------------------------------------------------------

  /**
   * Pré-vérification budgétaire, exposée AVANT submit pour permettre au
   * front d'afficher un voyant rouge sans devoir capturer un 409.
   *
   * Lecture seule, ne change pas le status.
   */
  async checkBudget(actor: AuthenticatedUser, prId: string): Promise<CheckBudgetResponseDto> {
    const pr = await this.prisma.purchaseRequest.findUnique({
      where: { id: prId },
      include: {
        lines: true,
        project: { select: { piUserId: true } },
      },
    });
    if (!pr) throw new EntityNotFoundException(ENTITY_NAME, { id: prId });

    const appUserId = await this.resolveAppUserId(actor);
    if (!canActorViewPr(actor, appUserId, pr)) {
      // 404 plutôt que 403 — cohérent avec findOne (cf. helper).
      throw new PrNotOwnedException('hidden');
    }

    const usageByLine = await this.computeBudgetUsageByLine(prId, pr.lines);

    const wouldExceed = usageByLine.some((u) => u.wouldExceed);
    const currentTotal = Number(pr.totalAmount);
    const available = usageByLine.reduce((s, u) => s + u.available, 0);
    const willConsume = usageByLine.reduce((s, u) => s + u.willConsume, 0);

    return {
      prId,
      currentTotal,
      available,
      willConsume,
      wouldExceed,
      byLine: usageByLine,
    };
  }

  /**
   * Soumet la DA. Pipeline :
   *   1. status == 'draft'
   *   2. grant.status == 'active'
   *   3. budget suffisant sur CHAQUE ligne (PR pending + ce PR ≤ budgeted - engaged)
   *   4. crée 1ère approval_step (le workflow vient au sprint 2.2)
   *   5. status → 'submitted'
   */
  async submit(actor: AuthenticatedUser, prId: string): Promise<PurchaseRequest> {
    const pr = await this.prisma.purchaseRequest.findUnique({
      where: { id: prId },
      include: { lines: true, grant: { select: { status: true, projectId: true } } },
    });
    if (!pr) throw new EntityNotFoundException(ENTITY_NAME, { id: prId });
    await this.assertCanWrite(actor, pr);

    if (pr.status !== DRAFT_STATUS) {
      throw new PrNotEditableException(prId, pr.status);
    }
    if (pr.grant.status !== ACTIVE_GRANT_STATUS) {
      throw new GrantNotActiveException(pr.grantId, pr.grant.status);
    }
    // Sanity check : project/grant cohérent (cas où le grant aurait été
    // réaffecté entre create et submit).
    if (pr.grant.projectId !== pr.projectId) {
      throw new ProjectGrantMismatchException(pr.grantId, pr.projectId, pr.grant.projectId);
    }

    const usage = await this.computeBudgetUsageByLine(prId, pr.lines);
    const exceeded = usage.filter((u) => u.wouldExceed);
    if (exceeded.length > 0) {
      throw new InsufficientBudgetException(
        prId,
        exceeded.map((u) => ({ ...u }) as Record<string, unknown>),
      );
    }

    // Routage selon `requestType` :
    //   - standard      → PI (workflow PI/CG/DAF, sprint 2.2)
    //   - petty_cash    → CAISSIER direct (workflow simplifié, sprint 2.3)
    //   - cash_advance  → PI puis CAISSIER (workflow 2 étapes, sprint 2.3)
    const isPetty = pr.requestType === 'petty_cash';
    const firstRole: 'PI' | 'CAISSIER' = isPetty ? 'CAISSIER' : 'PI';
    const nextStatus = isPetty ? PENDING_CAISSIER_STATUS : PENDING_PI_STATUS;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseRequest.update({
        where: { id: prId },
        data: { status: nextStatus, updatedAt: new Date() },
      });
      await tx.approvalStep.create({
        data: {
          entityType: 'purchase_request',
          entityId: prId,
          stepOrder: 1,
          approverRole: firstRole,
          status: 'pending',
        },
      });
      return updated;
    });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Numéro de DA — `DA-YYYY-NNNN` séquentiel par année.
   *
   * Pour éviter une race entre deux POST concurrents qui produiraient le
   * même numéro, on prend un `pg_advisory_xact_lock` indexé par l'année.
   * Le verrou est libéré automatiquement à la fin de la transaction.
   */
  private async generatePrNumber(): Promise<string> {
    const year = new Date().getFullYear();
    return this.prisma.$transaction(async (tx) => {
      const lockKey = this.hashToBigInt(`pr_seq_${year}`);
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
      // MAX au lieu de COUNT : resilient aux trous
      const last = await tx.purchaseRequest.findFirst({
        where: { prNumber: { startsWith: `DA-${year}-` } },
        orderBy: { prNumber: 'desc' },
        select: { prNumber: true },
      });
      const lastSeq = last ? parseInt(last.prNumber.split('-')[2] ?? '0', 10) : 0;
      const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
      return `DA-${year}-${String(next).padStart(4, '0')}`;
    });
  }

  /**
   * Convertit une chaîne en bigint stable, compatible avec
   * `pg_advisory_xact_lock(bigint)`. On évite `hashtext` côté SQL pour
   * pouvoir tester la fonction sans réseau.
   */
  private hashToBigInt(s: string): bigint {
    let h = 0n;
    for (let i = 0; i < s.length; i += 1) {
      h = (h * 31n + BigInt(s.charCodeAt(i))) & 0x7fffffffffffffffn;
    }
    return h;
  }

  /**
   * Calcule, pour chaque ligne de la DA, la situation budgétaire :
   * budgeted, alreadyConsumed (toutes PR pending sauf celle-ci + tous les
   * BC ouverts), willConsume (impact de cette DA), available, wouldExceed.
   */
  private async computeBudgetUsageByLine(
    currentPrId: string,
    lines: PurchaseRequestLine[],
  ): Promise<CheckBudgetLineDto[]> {
    if (lines.length === 0) return [];

    const blIds = Array.from(new Set(lines.map((l) => l.budgetLineId)));

    const budgetLines = await this.prisma.budgetLine.findMany({
      where: { id: { in: blIds } },
      select: { id: true, code: true, label: true, budgetedAmount: true },
    });
    const blMap = new Map(budgetLines.map((b) => [b.id, b]));

    // Agrégat PR pending hors celle-ci.
    const prAgg = await this.prisma.purchaseRequestLine.groupBy({
      by: ['budgetLineId'],
      where: {
        budgetLineId: { in: blIds },
        pr: { status: { in: PENDING_STATUSES }, id: { not: currentPrId } },
      },
      _sum: { lineTotal: true },
    });
    const prByBl = new Map(prAgg.map((a) => [a.budgetLineId, Number(a._sum?.lineTotal ?? 0)]));

    // Agrégat PO ouverts (engagement effectif).
    const poAgg = await this.prisma.purchaseOrderLine.groupBy({
      by: ['budgetLineId'],
      where: {
        budgetLineId: { in: blIds },
        po: { status: { in: OPEN_PO_STATUSES } },
      },
      _sum: { lineTotal: true },
    });
    const poByBl = new Map(poAgg.map((a) => [a.budgetLineId, Number(a._sum?.lineTotal ?? 0)]));

    // Impact de la DA en cours par ligne.
    const willByBl = new Map<string, number>();
    for (const l of lines) {
      willByBl.set(l.budgetLineId, (willByBl.get(l.budgetLineId) ?? 0) + Number(l.lineTotal));
    }

    return blIds.map((blId) => {
      const bl = blMap.get(blId);
      const budgeted = bl ? Number(bl.budgetedAmount) : 0;
      const alreadyConsumed = (prByBl.get(blId) ?? 0) + (poByBl.get(blId) ?? 0);
      const willConsume = willByBl.get(blId) ?? 0;
      const available = budgeted - alreadyConsumed - willConsume;
      return {
        budgetLineId: blId,
        code: bl?.code ?? '?',
        label: bl?.label ?? '?',
        budgeted,
        alreadyConsumed,
        willConsume,
        available,
        wouldExceed: available < 0,
      };
    });
  }

  // ------------------------------------------------------------------
  // RBAC scope
  // ------------------------------------------------------------------

  /**
   * Lecture : SUPER_ADMIN / DAF / CONTROLEUR / COMPTABLE / TRESORIER voient tout.
   * Les autres rôles ne voient que les DA dont `requestedBy = app_user.id`
   * (résolu via l'email Keycloak — cf. `resolveAppUserId`).
   *
   * On répond 404 plutôt que 403 pour ne pas révéler l'existence (OWASP).
   */
  private async assertCanRead(
    actor: AuthenticatedUser,
    pr: { requestedBy: string },
  ): Promise<void> {
    if (this.hasFullView(actor)) return;
    const appUserId = await this.resolveAppUserId(actor);
    if (pr.requestedBy !== appUserId) throw new PrNotOwnedException('hidden');
  }

  /** Écriture : owner OR SUPER_ADMIN. */
  private async assertCanWrite(
    actor: AuthenticatedUser,
    pr: { requestedBy: string },
  ): Promise<void> {
    if (actor.roles.includes('SUPER_ADMIN')) return;
    const appUserId = await this.resolveAppUserId(actor);
    if (pr.requestedBy !== appUserId) throw new PrNotOwnedException('hidden');
  }

  private hasFullView(actor: AuthenticatedUser): boolean {
    return actor.roles.some((r) => FULL_VIEW_ROLES.includes(r));
  }

  /**
   * Résout l'`auth.app_user.id` à partir du `sub` Keycloak.
   *
   * Pourquoi : la table `auth.app_user` a son propre UUID, distinct du
   * `sub` Keycloak — la FK `purchase_request.requested_by` pointe vers le
   * premier. On bridge par e-mail (Keycloak garantit la stabilité du claim
   * `email` quand on n'utilise pas d'IDP fédéré). Si l'utilisateur n'est
   * pas connu côté BD, on le provisionne au vol (cas typique : un user
   * Keycloak avec un nouveau rôle qu'on n'a pas encore reflété en seed).
   *
   * Idéalement la `JwtStrategy` ferait ça une fois pour toute et exposerait
   * `actor.id = app_user.id` directement — à faire dans un sprint dédié.
   */
  private async resolveAppUserId(actor: AuthenticatedUser): Promise<string> {
    const existing = await this.prisma.appUser.findUnique({
      where: { email: actor.email },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.appUser.create({
      data: { email: actor.email, fullName: actor.fullName || actor.email },
      select: { id: true },
    });
    this.logger.log({ email: actor.email, appUserId: created.id }, 'provisioned new app_user on the fly');
    return created.id;
  }

  // ------------------------------------------------------------------
  // Where builder
  // ------------------------------------------------------------------

  private buildWhere(
    actor: AuthenticatedUser,
    query: PurchaseRequestQueryDto,
    scopedUserId: string | null,
  ): Prisma.PurchaseRequestWhereInput {
    const where: Prisma.PurchaseRequestWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.projectId) where.projectId = query.projectId;
    if (query.grantId) where.grantId = query.grantId;

    // Visibility scope (fix `fix-acheteur-visibility-scope`) :
    // - Full-view (CG/DAF/COMPTABLE/TRESORIER/SA) : scopedUserId === null,
    //   pas de filtre ownership.
    // - ACHETEUR : voit ses propres DA + TOUTES les DA en `approved`/`closed`
    //   (parcours P2P : transformer la DA approuvée en BC). Implémenté via
    //   un OR Prisma — combiné avec une éventuelle recherche `q` par AND.
    // - Autres rôles non full-view (DEMANDEUR, PI sans full-view) : restreints
    //   à `requestedBy = self`. Le scope PI (`project.piUserId`) côté liste
    //   est out-of-scope ici (cf. caveat fix-pr-detail-validator-scope) ;
    //   ces rôles utilisent l'endpoint `pending-my-approval` pour leur queue.
    if (scopedUserId) {
      if (actor.roles.includes('ACHETEUR')) {
        where.OR = [
          { requestedBy: scopedUserId },
          { status: { in: [...ACHETEUR_VISIBLE_STATUSES] } },
        ];
      } else {
        where.requestedBy = scopedUserId;
      }
    } else if (query.requestedBy) {
      where.requestedBy = query.requestedBy;
    }

    if (query.fromDate || query.toDate) {
      where.requestedAt = {};
      if (query.fromDate) where.requestedAt.gte = new Date(query.fromDate);
      if (query.toDate) where.requestedAt.lte = new Date(query.toDate);
    }

    if (query.q) {
      const searchClause: Prisma.PurchaseRequestWhereInput[] = [
        { description: { contains: query.q.trim(), mode: 'insensitive' } },
        { prNumber: { contains: query.q.trim(), mode: 'insensitive' } },
      ];
      if (where.OR) {
        // Cas ACHETEUR + recherche : on combine via AND pour ne pas
        // clobber le OR de visibilité (ownership OR statut).
        where.AND = [{ OR: where.OR }, { OR: searchClause }];
        delete where.OR;
      } else {
        where.OR = searchClause;
      }
    }

    return where;
  }
}
