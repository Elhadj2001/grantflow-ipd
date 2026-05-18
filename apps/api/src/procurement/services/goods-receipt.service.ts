import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PoStatus, GrStatus } from '@prisma/client';
import type { GoodsReceipt, GoodsReceiptLine } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { Role } from '../../auth/types/roles';
import {
  BatchInfoRequiredException,
  ColdChainBrokenException,
  EntityNotFoundException,
  GrAlreadyCompleteException,
  GrEmptyLinesException,
  GrLineNotFoundException,
  GrNotCancellableException,
  GrNotEditableException,
  GrNotRejectableException,
  GrQtyExceedsOrderException,
  PoNotReceivableException,
  PrNotOwnedException,
  RejectionReasonMissingException,
} from '../../common/exceptions/business.exception';
import type {
  CancelGrDto,
  CreateGrFromPoDto,
  RejectGrDto,
  UpdateGrDto,
  UpdateGrLinesDto,
} from '../dto/create-gr.dto';
import type { GrQueryDto } from '../dto/gr-query.dto';

const ENTITY_NAME = 'GoodsReceipt';

/**
 * Rôles qui voient tous les GR (pas seulement ceux liés à leurs DAs).
 * Le MAGASINIER fait partie de cette liste : c'est son métier.
 */
const FULL_VIEW_ROLES: ReadonlyArray<Role> = [
  'MAGASINIER',
  'ACHETEUR',
  'CONTROLEUR',
  'DAF',
  'COMPTABLE',
  'TRESORIER',
  'BAILLEUR',
  'SUPER_ADMIN',
];

/** Statuts du PO qui autorisent la création d'un GR. */
const RECEIVABLE_PO_STATUSES: PoStatus[] = [
  PoStatus.sent,
  PoStatus.acknowledged,
  PoStatus.partially_received,
];

export interface PaginatedGrs {
  data: GoodsReceipt[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface GrWithLines extends GoodsReceipt {
  lines: GoodsReceiptLine[];
}

export interface CompleteGrResult {
  gr: GoodsReceipt;
  poStatus: PoStatus;
  totalReceivedLines: number;
}

export interface PoRemainingLine {
  poLineId: string;
  lineNumber: number;
  description: string;
  unit: string;
  ordered: number;
  received: number;
  remaining: number;
}

@Injectable()
export class GoodsReceiptService {
  private readonly logger = new Logger(GoodsReceiptService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Create
  // ------------------------------------------------------------------

  /**
   * Crée un GR draft à partir d'un PO réceptionnable.
   *
   * Les lignes sont initialisées à `quantity = 0` et seront mises à jour
   * par le magasinier via PATCH /lines au fur et à mesure qu'il vérifie
   * la livraison. Le `complete` final propage `quantity_received` sur le
   * PO et recalcule son statut.
   */
  async createFromPo(
    actor: AuthenticatedUser,
    poId: string,
    dto: CreateGrFromPoDto,
  ): Promise<GrWithLines> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!po) throw new EntityNotFoundException('PurchaseOrder', { id: poId });
    if (!RECEIVABLE_PO_STATUSES.includes(po.status)) {
      throw new PoNotReceivableException(po.id, po.status);
    }

    const receiverId = await this.resolveAppUserId(actor);
    const grNumber = await this.generateGrNumber();

    const created = await this.prisma.$transaction(async (tx) => {
      const gr = await tx.goodsReceipt.create({
        data: {
          grNumber,
          poId: po.id,
          receiptDate: dto.receiptDate ?? new Date(),
          receivedBy: receiverId,
          status: GrStatus.draft,
          deliveryNoteRef: dto.deliveryNoteRef,
          notes: dto.notes,
          coldChainRequired: dto.coldChainRequired ?? false,
          lines: {
            create: po.lines.map((l) => ({
              poLineId: l.id,
              quantity: new Prisma.Decimal(0),
            })),
          },
        },
        include: { lines: true },
      });
      return gr;
    });

    this.logger.log(
      { grId: created.id, grNumber, poId: po.id, lineCount: created.lines.length },
      'goods receipt created from PO',
    );
    return created;
  }

  // ------------------------------------------------------------------
  // Update (header + lines)
  // ------------------------------------------------------------------

  async update(actor: AuthenticatedUser, grId: string, dto: UpdateGrDto): Promise<GrWithLines> {
    const gr = await this.prisma.goodsReceipt.findUnique({
      where: { id: grId },
      include: { lines: true },
    });
    if (!gr) throw new EntityNotFoundException(ENTITY_NAME, { id: grId });
    await this.assertCanRead(actor, gr);
    if (gr.status !== GrStatus.draft) throw new GrNotEditableException(gr.id, gr.status);

    const updated = await this.prisma.goodsReceipt.update({
      where: { id: grId },
      data: {
        receiptDate: dto.receiptDate,
        deliveryNoteRef: dto.deliveryNoteRef ?? null,
        notes: dto.notes ?? null,
        coldChainRequired: dto.coldChainRequired,
        updatedAt: new Date(),
      },
      include: { lines: true },
    });
    return updated;
  }

  /**
   * Patch unitaire ligne par ligne. La validation par ligne :
   *  - `quantity` cumulée (incluant l'historique sur d'autres GR completes
   *    du même PO) ≤ `po_line.quantity` commandée — sinon GR_QTY_EXCEEDS_ORDER
   *  - si `cold_chain_required` du GR, batchNumber + expiryDate doivent être
   *    présents sur les lignes avec quantity > 0 (validation finale au
   *    `complete`, pas ici — la saisie peut être progressive)
   */
  async updateLines(
    actor: AuthenticatedUser,
    grId: string,
    dto: UpdateGrLinesDto,
  ): Promise<GrWithLines> {
    const gr = await this.prisma.goodsReceipt.findUnique({
      where: { id: grId },
      include: {
        lines: { include: { poLine: true } },
      },
    });
    if (!gr) throw new EntityNotFoundException(ENTITY_NAME, { id: grId });
    await this.assertCanRead(actor, gr);
    if (gr.status !== GrStatus.draft) throw new GrNotEditableException(gr.id, gr.status);

    // Map des lignes existantes par id
    const byId = new Map(gr.lines.map((l) => [l.id, l]));

    // Toutes les lignes du patch doivent exister
    for (const patch of dto.lines) {
      if (!byId.has(patch.lineId)) {
        throw new GrLineNotFoundException(grId, patch.lineId);
      }
    }

    // Calcul "déjà reçu ailleurs" pour chaque po_line concernée
    const poLineIds = Array.from(
      new Set(dto.lines.map((p) => byId.get(p.lineId)!.poLineId)),
    );
    const otherCompletedAgg = await this.prisma.goodsReceiptLine.groupBy({
      by: ['poLineId'],
      where: {
        poLineId: { in: poLineIds },
        grId: { not: grId },
        gr: { status: GrStatus.complete },
      },
      _sum: { quantity: true },
    });
    const otherCompleted = new Map<string, number>(
      otherCompletedAgg.map((r) => [r.poLineId, Number(r._sum.quantity ?? 0)]),
    );

    // Validation cumul : nouvelle qty (sur cette ligne) + historique des autres GR complets
    // ≤ qty commandée
    const overflow: Array<Record<string, unknown>> = [];
    for (const patch of dto.lines) {
      if (patch.quantity === undefined) continue;
      const line = byId.get(patch.lineId)!;
      const alreadyElsewhere = otherCompleted.get(line.poLineId) ?? 0;
      const newQty = Number(patch.quantity);
      const ordered = Number(line.poLine.quantity);
      if (alreadyElsewhere + newQty > ordered + 1e-9) {
        overflow.push({
          lineId: line.id,
          poLineId: line.poLineId,
          ordered,
          alreadyReceivedOnOtherGRs: alreadyElsewhere,
          requested: newQty,
        });
      }
    }
    if (overflow.length > 0) throw new GrQtyExceedsOrderException(grId, overflow);

    // Patch atomique
    await this.prisma.$transaction(async (tx) => {
      for (const patch of dto.lines) {
        const data: Prisma.GoodsReceiptLineUpdateInput = {};
        if (patch.quantity !== undefined) data.quantity = new Prisma.Decimal(patch.quantity);
        if (patch.batchNumber !== undefined) data.batchNumber = patch.batchNumber;
        if (patch.expiryDate !== undefined) data.expiryDate = patch.expiryDate;
        if (patch.serialNumbers !== undefined) data.serialNumbers = patch.serialNumbers;
        if (patch.qualityCheck !== undefined) data.qualityCheck = patch.qualityCheck;
        if (patch.coldChainOk !== undefined) data.coldChainOk = patch.coldChainOk;
        await tx.goodsReceiptLine.update({ where: { id: patch.lineId }, data });
      }
      await tx.goodsReceipt.update({
        where: { id: grId },
        data: { updatedAt: new Date() },
      });
    });

    const refreshed = await this.prisma.goodsReceipt.findUniqueOrThrow({
      where: { id: grId },
      include: { lines: true },
    });
    return refreshed;
  }

  // ------------------------------------------------------------------
  // Complete (validation finale + propagation au PO)
  // ------------------------------------------------------------------

  async complete(actor: AuthenticatedUser, grId: string): Promise<CompleteGrResult> {
    const gr = await this.prisma.goodsReceipt.findUnique({
      where: { id: grId },
      include: { lines: { include: { poLine: true } } },
    });
    if (!gr) throw new EntityNotFoundException(ENTITY_NAME, { id: grId });
    await this.assertCanRead(actor, gr);
    if (gr.status === GrStatus.complete) throw new GrAlreadyCompleteException(gr.id);
    if (gr.status !== GrStatus.draft) throw new GrNotEditableException(gr.id, gr.status);

    const receivedLines = gr.lines.filter((l) => Number(l.quantity) > 0);
    if (receivedLines.length === 0) throw new GrEmptyLinesException(gr.id);

    // Conformité biomédicale : si cold_chain_required, exiger batch+expiry
    // sur toutes les lignes reçues, et bloquer si cold_chain_ok=false.
    if (gr.coldChainRequired) {
      const missing = receivedLines.filter(
        (l) => !l.batchNumber || l.batchNumber.trim() === '' || !l.expiryDate,
      );
      if (missing.length > 0) {
        throw new BatchInfoRequiredException(
          gr.id,
          missing.map((l) => ({
            lineId: l.id,
            poLineId: l.poLineId,
            hasBatch: !!l.batchNumber,
            hasExpiry: !!l.expiryDate,
          })),
        );
      }
      const broken = receivedLines.filter((l) => l.coldChainOk === false);
      if (broken.length > 0) {
        throw new ColdChainBrokenException(
          gr.id,
          broken.map((l) => ({
            lineId: l.id,
            poLineId: l.poLineId,
            description: l.poLine.description,
          })),
        );
      }
    }

    // Re-vérification dépassement cumulé (au cas où une autre GR aurait été
    // validée entre la dernière updateLines et le complete)
    const poLineIds = Array.from(new Set(receivedLines.map((l) => l.poLineId)));
    const otherCompletedAgg = await this.prisma.goodsReceiptLine.groupBy({
      by: ['poLineId'],
      where: {
        poLineId: { in: poLineIds },
        grId: { not: grId },
        gr: { status: GrStatus.complete },
      },
      _sum: { quantity: true },
    });
    const otherCompleted = new Map<string, number>(
      otherCompletedAgg.map((r) => [r.poLineId, Number(r._sum.quantity ?? 0)]),
    );
    const overflow: Array<Record<string, unknown>> = [];
    for (const l of receivedLines) {
      const ordered = Number(l.poLine.quantity);
      const total = (otherCompleted.get(l.poLineId) ?? 0) + Number(l.quantity);
      if (total > ordered + 1e-9) {
        overflow.push({
          lineId: l.id,
          poLineId: l.poLineId,
          ordered,
          alreadyReceivedOnOtherGRs: otherCompleted.get(l.poLineId) ?? 0,
          requested: Number(l.quantity),
        });
      }
    }
    if (overflow.length > 0) throw new GrQtyExceedsOrderException(grId, overflow);

    const completerId = await this.resolveAppUserId(actor);
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // 1) Propagation : po_line.quantity_received += gr_line.quantity
      for (const l of receivedLines) {
        await tx.purchaseOrderLine.update({
          where: { id: l.poLineId },
          data: { quantityReceived: { increment: l.quantity } },
        });
      }

      // 2) Recalcule du status du PO
      const refreshedPoLines = await tx.purchaseOrderLine.findMany({
        where: { poId: gr.poId },
        select: { quantity: true, quantityReceived: true },
      });
      const anyReceived = refreshedPoLines.some((l) => Number(l.quantityReceived) > 0);
      const allReceived =
        refreshedPoLines.length > 0 &&
        refreshedPoLines.every(
          (l) => Number(l.quantityReceived) + 1e-9 >= Number(l.quantity),
        );

      const newPoStatus: PoStatus = allReceived
        ? PoStatus.received
        : anyReceived
          ? PoStatus.partially_received
          : PoStatus.acknowledged; // ne devrait pas arriver (receivedLines>0)

      await tx.purchaseOrder.update({
        where: { id: gr.poId },
        data: { status: newPoStatus },
      });

      // 3) GR → complete
      const completed = await tx.goodsReceipt.update({
        where: { id: gr.id },
        data: {
          status: GrStatus.complete,
          completedAt: now,
          completedBy: completerId,
          updatedAt: now,
        },
      });

      return { completed, newPoStatus };
    });

    this.logger.log(
      {
        grId: gr.id,
        grNumber: gr.grNumber,
        poId: gr.poId,
        newPoStatus: result.newPoStatus,
        completedLines: receivedLines.length,
      },
      'goods receipt completed',
    );

    return {
      gr: result.completed,
      poStatus: result.newPoStatus,
      totalReceivedLines: receivedLines.length,
    };
  }

  // ------------------------------------------------------------------
  // Cancel / Reject
  // ------------------------------------------------------------------

  async cancel(
    actor: AuthenticatedUser,
    grId: string,
    dto: CancelGrDto,
  ): Promise<GoodsReceipt> {
    const gr = await this.prisma.goodsReceipt.findUnique({ where: { id: grId } });
    if (!gr) throw new EntityNotFoundException(ENTITY_NAME, { id: grId });
    await this.assertCanRead(actor, gr);
    if (gr.status !== GrStatus.draft) throw new GrNotCancellableException(gr.id, gr.status);

    const appUserId = await this.resolveAppUserId(actor);
    const cancelled = await this.prisma.goodsReceipt.update({
      where: { id: grId },
      data: {
        status: GrStatus.cancelled,
        cancelledAt: new Date(),
        cancelledReason: dto.reason,
        cancelledBy: appUserId,
        updatedAt: new Date(),
      },
    });

    this.logger.log(
      { grId, grNumber: gr.grNumber, reason: dto.reason },
      'goods receipt cancelled',
    );
    return cancelled;
  }

  async reject(
    actor: AuthenticatedUser,
    grId: string,
    dto: RejectGrDto,
  ): Promise<GoodsReceipt> {
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new RejectionReasonMissingException();
    }
    const gr = await this.prisma.goodsReceipt.findUnique({ where: { id: grId } });
    if (!gr) throw new EntityNotFoundException(ENTITY_NAME, { id: grId });
    await this.assertCanRead(actor, gr);
    if (gr.status !== GrStatus.draft) throw new GrNotRejectableException(gr.id, gr.status);

    const appUserId = await this.resolveAppUserId(actor);
    const rejected = await this.prisma.goodsReceipt.update({
      where: { id: grId },
      data: {
        status: GrStatus.rejected,
        rejectedReason: dto.reason,
        rejectedAt: new Date(),
        rejectedBy: appUserId,
        updatedAt: new Date(),
      },
    });

    this.logger.warn(
      { grId, grNumber: gr.grNumber, reason: dto.reason },
      'goods receipt rejected (delivery refused)',
    );
    return rejected;
  }

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  async findMany(actor: AuthenticatedUser, query: GrQueryDto): Promise<PaginatedGrs> {
    const scopedUserId = this.hasFullView(actor) ? null : await this.resolveAppUserId(actor);

    const where: Prisma.GoodsReceiptWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.poId) where.poId = query.poId;
    if (query.q) {
      where.OR = [
        { grNumber: { contains: query.q.trim(), mode: 'insensitive' } },
        { deliveryNoteRef: { contains: query.q.trim(), mode: 'insensitive' } },
      ];
    }
    if (query.fromDate || query.toDate) {
      where.receiptDate = {};
      if (query.fromDate) where.receiptDate.gte = new Date(query.fromDate);
      if (query.toDate) where.receiptDate.lte = new Date(query.toDate);
    }
    if (scopedUserId) {
      // DEMANDEUR / PI : seulement les GR sur des PO liés à leurs DAs
      where.po = { prLinks: { some: { pr: { requestedBy: scopedUserId } } } };
    }

    const orderBy: Prisma.GoodsReceiptOrderByWithRelationInput = { [query.sort]: query.order };
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.goodsReceipt.findMany({ where, orderBy, skip, take: query.pageSize }),
      this.prisma.goodsReceipt.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + data.length < total,
    };
  }

  async findOne(actor: AuthenticatedUser, grId: string): Promise<GrWithLines> {
    const gr = await this.prisma.goodsReceipt.findUnique({
      where: { id: grId },
      include: { lines: true },
    });
    if (!gr) throw new EntityNotFoundException(ENTITY_NAME, { id: grId });
    await this.assertCanRead(actor, gr);
    return gr;
  }

  /**
   * Génère un PDF d'étiquettes QR pour le GR (sprint F-MAG).
   *
   * Le service `GrLabelsService` est passé en argument pour éviter
   * une dépendance circulaire / un nouveau provider à enregistrer.
   * Le contrôleur fournit l'instance via DI.
   */
  async buildLabelsPdf(
    actor: AuthenticatedUser,
    grId: string,
    format: 'grid-4x4' | 'individual',
    cartonCountPerLine: number,
    labelsSvc: {
      generate: (payload: import('./gr-labels.service').GrLabelsPayload, format: 'grid-4x4' | 'individual') => Promise<Buffer>;
    },
  ): Promise<Buffer> {
    const gr = await this.findOne(actor, grId);
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: gr.poId },
      include: { lines: { orderBy: { lineNumber: 'asc' } }, supplier: true },
    });
    if (!po) throw new EntityNotFoundException('PurchaseOrder', { id: gr.poId });

    // Map poLineId → description (les lignes GR référencent poLineId)
    const poLineMap = new Map(po.lines.map((l) => [l.id, l]));

    return labelsSvc.generate(
      {
        grId: gr.id,
        grNumber: gr.grNumber,
        poNumber: po.poNumber,
        supplierName: po.supplier.name,
        receiptDate: gr.receiptDate ?? new Date(),
        cartonCountPerLine,
        lines: gr.lines.map((l, idx) => {
          const poLine = poLineMap.get(l.poLineId);
          return {
            lineId: l.id,
            lineNumber: poLine?.lineNumber ?? idx + 1,
            description: poLine?.description ?? '—',
            batchNumber: l.batchNumber,
            expiryDate: l.expiryDate,
            coldChainRequired: gr.coldChainRequired,
          };
        }),
      },
      format,
    );
  }

  // ------------------------------------------------------------------
  // PO views
  // ------------------------------------------------------------------

  async listForPo(actor: AuthenticatedUser, poId: string): Promise<GoodsReceipt[]> {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new EntityNotFoundException('PurchaseOrder', { id: poId });
    await this.assertCanRead(actor, { id: po.id, poId: po.id });
    return this.prisma.goodsReceipt.findMany({
      where: { poId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remainingForPo(actor: AuthenticatedUser, poId: string): Promise<PoRemainingLine[]> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!po) throw new EntityNotFoundException('PurchaseOrder', { id: poId });
    await this.assertCanRead(actor, { id: po.id, poId: po.id });

    return po.lines.map((l) => {
      const ordered = Number(l.quantity);
      const received = Number(l.quantityReceived);
      return {
        poLineId: l.id,
        lineNumber: l.lineNumber,
        description: l.description,
        unit: l.unit,
        ordered,
        received,
        remaining: Math.max(0, ordered - received),
      };
    });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Lecture : full-view OR auteur d'une DA liée au PO.
   * Réponse 404 (obscurité OWASP) si pas accessible.
   *
   * On accepte un objet partiel (`id` du GR + `poId` du parent) ou un GR
   * complet : le check remonte au PO puis aux DAs liées.
   */
  private async assertCanRead(
    actor: AuthenticatedUser,
    gr: { id: string; poId: string },
  ): Promise<void> {
    if (this.hasFullView(actor)) return;
    const appUserId = await this.resolveAppUserId(actor);
    const link = await this.prisma.purchaseOrderPr.findFirst({
      where: { poId: gr.poId, pr: { requestedBy: appUserId } },
      select: { poId: true },
    });
    if (!link) throw new PrNotOwnedException('hidden');
  }

  private hasFullView(actor: AuthenticatedUser): boolean {
    return actor.roles.some((r) => FULL_VIEW_ROLES.includes(r));
  }

  /**
   * Bridge Keycloak.sub → auth.app_user.id (alignement sprint 2.1).
   * Crée l'app_user au vol si absent.
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
    return created.id;
  }

  /**
   * Numéro GR : `GR-YYYY-NNNN`. Advisory lock pour éviter les collisions
   * sous concurrence (création parallèle par plusieurs magasiniers).
   */
  private async generateGrNumber(): Promise<string> {
    const year = new Date().getFullYear();
    return this.prisma.$transaction(async (tx) => {
      const lockKey = this.hashToBigInt(`gr_seq_${year}`);
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
      // MAX au lieu de COUNT : resilient aux trous
      const last = await tx.goodsReceipt.findFirst({
        where: { grNumber: { startsWith: `GR-${year}-` } },
        orderBy: { grNumber: 'desc' },
        select: { grNumber: true },
      });
      const lastSeq = last ? parseInt(last.grNumber.split('-')[2] ?? '0', 10) : 0;
      const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
      return `GR-${year}-${String(next).padStart(4, '0')}`;
    });
  }

  private hashToBigInt(s: string): bigint {
    let h = 0n;
    for (let i = 0; i < s.length; i += 1) {
      h = (h * 31n + BigInt(s.charCodeAt(i))) & 0x7fffffffffffffffn;
    }
    return h;
  }
}
