import { Injectable, Logger } from '@nestjs/common';
import { Prisma, InvoiceStatus } from '@prisma/client';
import type { Invoice, InvoiceLine } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/services/storage.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { Role } from '../../auth/types/roles';
import {
  EntityNotFoundException,
  InvoiceDuplicateNumberException,
  InvoiceNoPoLinkedException,
  InvoiceNotCapturableException,
  InvoiceNotEditableException,
  InvoiceNotRejectableException,
  MatchingForceReasonRequiredException,
  PrNotOwnedException,
} from '../../common/exceptions/business.exception';
import type {
  CreateInvoiceManualDto,
  ForceMatchDto,
  RejectInvoiceDto,
  UpdateInvoiceDto,
  UploadHintDto,
  InvoiceQueryDto,
} from '../dto/invoice.dto';
import { OcrService, type OcrResult } from './ocr.service';
import { MatchingService, type MatchOutcome } from './matching.service';
import { PostingService, type CancelPostingResult, type PostInvoiceResult } from '../../accounting/services/posting.service';

const ENTITY_NAME = 'Invoice';
const INVOICE_BUCKET = 'grantflow-invoices';

/**
 * Rôles avec lecture complète (toutes les factures). Les ACHETEUR voient
 * les factures liées à leurs BC (via po.buyer_id), DEMANDEUR/PI celles
 * liées à leurs DAs (via po.prLinks).
 */
const FULL_VIEW_ROLES: ReadonlyArray<Role> = [
  'COMPTABLE',
  'TRESORIER',
  'CONTROLEUR',
  'DAF',
  // Sprint F-RBAC-LISTES : BAILLEUR retiré (aligné sur l'@Roles du
  // controller qui bloque l'endpoint pour ce rôle).
  'SUPER_ADMIN',
];

/** Statuts qui permettent encore d'éditer le payload. */
const EDITABLE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.captured,
  InvoiceStatus.exception_price,
  InvoiceStatus.exception_qty,
];

/** Statuts immuables (la facture est consommée par le pipeline en aval). */
const IMMUTABLE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.paid,
  InvoiceStatus.archived,
];

export interface InvoiceWithLines extends Invoice {
  lines: InvoiceLine[];
}

export interface UploadCaptureResult {
  invoice: InvoiceWithLines;
  ocr: OcrResult;
  pdfObjectKey: string;
}

export interface PaginatedInvoices {
  data: Invoice[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
    private readonly matching: MatchingService,
    private readonly posting: PostingService,
  ) {}

  // ------------------------------------------------------------------
  // Upload + capture OCR
  // ------------------------------------------------------------------

  /**
   * Upload d'un PDF facture, extraction OCR, création d'une Invoice en
   * statut `captured`. Si le supplier n'est pas reconnu par l'OCR, l'appel
   * échoue avec EntityNotFound — sinon, l'utilisateur peut le passer
   * en hint (UploadHintDto).
   */
  async uploadAndCapture(
    actor: AuthenticatedUser,
    fileBuffer: Buffer,
    _fileName: string,
    hint?: UploadHintDto,
  ): Promise<UploadCaptureResult> {
    // 1) OCR
    const ocr = await this.ocr.extractFromPdf(fileBuffer);

    // 2) Résoudre supplier : hint > fuzzy sur nom OCR > erreur
    let supplierId = hint?.supplierId;
    if (!supplierId && ocr.fields.supplierName) {
      const found = await this.prisma.supplier.findFirst({
        where: {
          name: { contains: ocr.fields.supplierName, mode: 'insensitive' },
          isActive: true,
        },
        select: { id: true },
      });
      if (found) supplierId = found.id;
    }
    if (!supplierId) {
      throw new EntityNotFoundException('Supplier', {
        hint: 'No supplier hint and OCR could not identify supplier — pass supplierId in form-data',
      });
    }

    // 3) Résoudre PO : hint > poReference OCR > null
    let poId = hint?.poId ?? null;
    if (!poId && ocr.fields.poReference) {
      const po = await this.prisma.purchaseOrder.findFirst({
        where: { poNumber: ocr.fields.poReference.replace(/\s/g, '') },
        select: { id: true },
      });
      if (po) poId = po.id;
    }

    // 4) Numéro facture : OCR ou auto-généré
    const invoiceNumber =
      ocr.fields.invoiceNumber ?? `IMPORT-${new Date().getFullYear()}-${randomUUID().slice(0, 8)}`;
    await this.assertUniqueInvoiceNumber(supplierId, invoiceNumber);

    // 5) Upload MinIO
    const now = new Date();
    const objectKey = `invoices/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.pdf`;
    await this.storage.putObject({
      bucket: INVOICE_BUCKET,
      objectKey,
      buffer: fileBuffer,
      contentType: 'application/pdf',
      metadata: { 'x-invoice-number': invoiceNumber, 'x-supplier-id': supplierId },
    });

    // 6) Persiste l'invoice (captured) — totaux fallback à 0 si OCR n'a rien trouvé
    const totalHt = ocr.fields.totalHt ?? 0;
    const totalVat = ocr.fields.totalVat ?? 0;
    const totalTtc = ocr.fields.totalTtc ?? totalHt + totalVat;
    const invoiceDate = ocr.fields.invoiceDate ?? now;
    const dueDate = ocr.fields.dueDate ?? invoiceDate;

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        supplierId,
        invoiceDate,
        dueDate,
        currency: ocr.fields.currency ?? 'XOF',
        poId,
        totalHt,
        totalVat,
        totalTtc,
        ocrConfidence: ocr.confidence,
        pdfObjectKey: objectKey,
        capturedPayload: ocr.fields as unknown as Prisma.InputJsonValue,
        status: InvoiceStatus.captured,
        lines: ocr.fields.lines && ocr.fields.lines.length > 0
          ? {
              create: ocr.fields.lines.map((l, i) => ({
                lineNumber: i + 1,
                description: l.description,
                quantity: l.quantity ? new Prisma.Decimal(l.quantity) : null,
                unitPrice: l.unitPrice ? new Prisma.Decimal(l.unitPrice) : null,
                lineTotal: new Prisma.Decimal(l.lineTotal ?? 0),
              })),
            }
          : undefined,
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });

    this.logger.log(
      { invoiceId: invoice.id, supplierId, poId, ocrConfidence: ocr.confidence, actor: actor.email },
      'invoice captured from PDF',
    );

    return { invoice, ocr, pdfObjectKey: objectKey };
  }

  // ------------------------------------------------------------------
  // Create manuel
  // ------------------------------------------------------------------

  async createManual(
    actor: AuthenticatedUser,
    dto: CreateInvoiceManualDto,
  ): Promise<InvoiceWithLines> {
    await this.assertUniqueInvoiceNumber(dto.supplierId, dto.invoiceNumber);

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber: dto.invoiceNumber,
        supplierId: dto.supplierId,
        invoiceDate: dto.invoiceDate,
        dueDate: dto.dueDate,
        currency: dto.currency,
        exchangeRate: dto.exchangeRate,
        poId: dto.poId ?? null,
        totalHt: dto.totalHt,
        totalVat: dto.totalVat,
        totalTtc: dto.totalTtc,
        status: InvoiceStatus.captured,
        lines: {
          create: dto.lines.map((l) => ({
            lineNumber: l.lineNumber,
            description: l.description,
            quantity: l.quantity ? new Prisma.Decimal(l.quantity) : null,
            unitPrice: l.unitPrice ? new Prisma.Decimal(l.unitPrice) : null,
            lineTotal: new Prisma.Decimal(l.lineTotal),
            poLineId: l.poLineId,
            taxCodeId: l.taxCodeId,
            glAccount: l.glAccount,
          })),
        },
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });

    this.logger.log(
      { invoiceId: invoice.id, supplierId: dto.supplierId, totalTtc: dto.totalTtc, actor: actor.email },
      'invoice created manually',
    );

    return invoice;
  }

  // ------------------------------------------------------------------
  // Sprint F-INVOICE-SIM — création depuis le simulateur (mode démo, inject)
  // ------------------------------------------------------------------

  /**
   * Crée une Invoice en statut `captured` à partir d'une facture SIMULÉE
   * (le PDF a déjà été généré + stocké en amont). Skip l'OCR : les champs
   * sont fournis directement par le générateur (cohérents avec le BC).
   *
   * ⚠️ Réservé au flux démo (endpoint gated par flag). Le `capturedPayload`
   * porte un marqueur `sourceType: 'DEMO_SIMULATOR'` pour la traçabilité —
   * pas de modification du DDL (champ JSONB existant).
   */
  async createFromSimulatedPdf(
    actor: AuthenticatedUser,
    params: {
      supplierId: string;
      poId: string;
      invoiceNumber: string;
      invoiceDate: Date;
      dueDate: Date;
      currency: string;
      totalHt: number;
      totalVat: number;
      totalTtc: number;
      pdfObjectKey: string;
      lines: Array<{
        lineNumber: number;
        description: string;
        quantity: number | null;
        unitPrice: number | null;
        lineTotal: number;
      }>;
    },
  ): Promise<InvoiceWithLines> {
    await this.assertUniqueInvoiceNumber(params.supplierId, params.invoiceNumber);

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber: params.invoiceNumber,
        supplierId: params.supplierId,
        invoiceDate: params.invoiceDate,
        dueDate: params.dueDate,
        currency: params.currency,
        poId: params.poId,
        totalHt: params.totalHt,
        totalVat: params.totalVat,
        totalTtc: params.totalTtc,
        pdfObjectKey: params.pdfObjectKey,
        // Marqueur de provenance (mode démo) — pas de colonne dédiée.
        capturedPayload: { sourceType: 'DEMO_SIMULATOR' } as Prisma.InputJsonValue,
        status: InvoiceStatus.captured,
        lines: {
          create: params.lines.map((l) => ({
            lineNumber: l.lineNumber,
            description: l.description,
            quantity: l.quantity != null ? new Prisma.Decimal(l.quantity) : null,
            unitPrice: l.unitPrice != null ? new Prisma.Decimal(l.unitPrice) : null,
            lineTotal: new Prisma.Decimal(l.lineTotal),
          })),
        },
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });

    this.logger.log(
      {
        invoiceId: invoice.id,
        supplierId: params.supplierId,
        poId: params.poId,
        source: 'DEMO_SIMULATOR',
        actor: actor.email,
      },
      'invoice created from demo simulator (inject mode)',
    );

    return invoice;
  }

  // ------------------------------------------------------------------
  // Update / Reject
  // ------------------------------------------------------------------

  async update(
    actor: AuthenticatedUser,
    invoiceId: string,
    dto: UpdateInvoiceDto,
  ): Promise<InvoiceWithLines> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new EntityNotFoundException(ENTITY_NAME, { id: invoiceId });
    await this.assertCanRead(actor, invoice);
    if (!EDITABLE_STATUSES.includes(invoice.status)) {
      throw new InvoiceNotEditableException(invoice.id, invoice.status);
    }

    // Si invoice_number ou supplier change, contrôler l'unicité
    if (
      (dto.invoiceNumber && dto.invoiceNumber !== invoice.invoiceNumber) ||
      (dto.supplierId && dto.supplierId !== invoice.supplierId)
    ) {
      const newNumber = dto.invoiceNumber ?? invoice.invoiceNumber;
      const newSupplier = dto.supplierId ?? invoice.supplierId;
      const existing = await this.prisma.invoice.findFirst({
        where: { supplierId: newSupplier, invoiceNumber: newNumber, id: { not: invoiceId } },
        select: { id: true },
      });
      if (existing) throw new InvoiceDuplicateNumberException(newSupplier, newNumber);
    }

    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        invoiceNumber: dto.invoiceNumber,
        supplierId: dto.supplierId,
        invoiceDate: dto.invoiceDate,
        dueDate: dto.dueDate,
        currency: dto.currency,
        exchangeRate: dto.exchangeRate,
        poId: dto.poId,
        totalHt: dto.totalHt,
        totalVat: dto.totalVat,
        totalTtc: dto.totalTtc,
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    return updated;
  }

  async reject(
    actor: AuthenticatedUser,
    invoiceId: string,
    dto: RejectInvoiceDto,
  ): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new EntityNotFoundException(ENTITY_NAME, { id: invoiceId });
    await this.assertCanRead(actor, invoice);
    if (IMMUTABLE_STATUSES.includes(invoice.status)) {
      throw new InvoiceNotRejectableException(invoice.id, invoice.status);
    }

    const rejected = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.rejected,
        rejectionReason: dto.reason,
      },
    });

    this.logger.warn(
      { invoiceId, reason: dto.reason, actor: actor.email },
      'invoice rejected',
    );
    return rejected;
  }

  // ------------------------------------------------------------------
  // Submit + force match
  // ------------------------------------------------------------------

  /**
   * Soumet la facture au matching 3-way. Pré-conditions :
   *  - status='captured'
   *  - po_id renseigné
   *  - totaux > 0
   *
   * Le statut résultant dépend du matching :
   *  - 'matched' si tout dans la tolérance
   *  - 'exception_price' si écart prix
   *  - 'exception_qty' si écart qty ou ligne inexpliquée
   */
  async submitForMatching(
    actor: AuthenticatedUser,
    invoiceId: string,
  ): Promise<{ invoice: Invoice; outcome: MatchOutcome }> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new EntityNotFoundException(ENTITY_NAME, { id: invoiceId });
    await this.assertCanRead(actor, invoice);
    if (invoice.status !== InvoiceStatus.captured) {
      throw new InvoiceNotCapturableException(invoice.id, invoice.status);
    }
    if (!invoice.poId) throw new InvoiceNoPoLinkedException(invoice.id);

    const outcome = await this.matching.matchInvoice(invoiceId);
    const matcherId = await this.resolveAppUserId(actor);
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: outcome.newStatus,
        matchedAt: new Date(),
        matchedBy: matcherId,
        matchSummary: outcome.summary as unknown as Prisma.InputJsonValue,
      },
    });
    return { invoice: updated, outcome };
  }

  /**
   * Force la facture en `matched` malgré une ou plusieurs exceptions.
   * Cas exceptionnel — réservé DAF / SUPER_ADMIN.
   *
   * On laisse les lignes `invoice_match` intactes (avec leurs résultats
   * EXCEPTION_*) — le `match_summary` conserve aussi la trace. Le statut
   * change uniquement sur l'invoice elle-même. L'audit log capture le
   * motif via les intercepteurs standards.
   */
  async forceMatch(
    actor: AuthenticatedUser,
    invoiceId: string,
    dto: ForceMatchDto,
  ): Promise<Invoice> {
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new MatchingForceReasonRequiredException();
    }
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new EntityNotFoundException(ENTITY_NAME, { id: invoiceId });
    await this.assertCanRead(actor, invoice);
    if (
      invoice.status !== InvoiceStatus.exception_price &&
      invoice.status !== InvoiceStatus.exception_qty
    ) {
      throw new InvoiceNotCapturableException(invoice.id, invoice.status);
    }

    const previousSummary = (invoice.matchSummary ?? {}) as Record<string, unknown>;
    const newSummary = {
      ...previousSummary,
      forcedMatch: {
        forcedBy: actor.email,
        forcedAt: new Date().toISOString(),
        reason: dto.reason,
        previousStatus: invoice.status,
      },
    };

    const matcherId = await this.resolveAppUserId(actor);
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.matched,
        matchedAt: new Date(),
        matchedBy: matcherId,
        matchSummary: newSummary as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.warn(
      { invoiceId, reason: dto.reason, actor: actor.email, previousStatus: invoice.status },
      'FORCED_MATCH applied to invoice',
    );
    return updated;
  }

  // ------------------------------------------------------------------
  // Posting (sprint 4.2b)
  // ------------------------------------------------------------------

  /**
   * Comptabilise la facture (post → status='posted'). Délègue à
   * `PostingService.postInvoice` après contrôle d'accès.
   *
   * Pré-conditions effectives (vérifiées dans PostingService) :
   *  - invoice.status === 'matched'
   *  - invoice.poId renseigné
   *  - Période fiscale ouverte à invoice_date
   *  - Tous les comptes 6xx résolvables
   *  - Taux de change disponible si multidevise
   */
  async post(actor: AuthenticatedUser, invoiceId: string): Promise<PostInvoiceResult> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!invoice) throw new EntityNotFoundException(ENTITY_NAME, { id: invoiceId });
    await this.assertCanRead(actor, invoice);
    const appUserId = await this.resolveAppUserId(actor);
    return this.posting.postInvoice(invoice, {
      id: appUserId,
      email: actor.email,
      fullName: actor.fullName,
    });
  }

  /**
   * Annule la comptabilisation (status='posted' → 'matched'). Délègue à
   * `PostingService.cancelPosting`. Réservé DAF/SUPER_ADMIN (vérifié par
   * le contrôleur via @Roles).
   */
  async cancelPosting(
    actor: AuthenticatedUser,
    invoiceId: string,
    reason: string,
  ): Promise<CancelPostingResult> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new EntityNotFoundException(ENTITY_NAME, { id: invoiceId });
    await this.assertCanRead(actor, invoice);
    const appUserId = await this.resolveAppUserId(actor);
    return this.posting.cancelPosting(invoiceId, {
      id: appUserId,
      email: actor.email,
      fullName: actor.fullName,
    }, reason);
  }

  /**
   * Liste toutes les écritures liées à la facture :
   *  - écriture(s) AC (achats)
   *  - écriture(s) OD d'extournement classe 8 référencées dans
   *    match_summary.commitmentReversedEntries
   */
  async listJournalEntries(actor: AuthenticatedUser, invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new EntityNotFoundException(ENTITY_NAME, { id: invoiceId });
    await this.assertCanRead(actor, invoice);

    const acEntries = await this.posting.listEntriesForInvoice(invoiceId);
    const summary = (invoice.matchSummary ?? {}) as Record<string, unknown>;
    const reversalIds = Array.isArray(summary.commitmentReversedEntries)
      ? (summary.commitmentReversedEntries as Array<Record<string, unknown>>)
          .map((e) => e.entryId as string | undefined)
          .filter((id): id is string => !!id)
      : [];
    const reversals =
      reversalIds.length > 0
        ? await this.prisma.journalEntry.findMany({
            where: { id: { in: reversalIds } },
            include: { lines: { orderBy: { lineNumber: 'asc' } } },
            orderBy: { createdAt: 'asc' },
          })
        : [];
    return { acEntries, class8Reversals: reversals };
  }

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  async findMany(actor: AuthenticatedUser, query: InvoiceQueryDto): Promise<PaginatedInvoices> {
    const where: Prisma.InvoiceWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.poId) where.poId = query.poId;
    if (query.q) {
      where.invoiceNumber = { contains: query.q.trim(), mode: 'insensitive' };
    }
    if (query.fromDate || query.toDate) {
      where.invoiceDate = {};
      if (query.fromDate) where.invoiceDate.gte = new Date(query.fromDate);
      if (query.toDate) where.invoiceDate.lte = new Date(query.toDate);
    }

    // RBAC scope
    if (!this.hasFullView(actor)) {
      const appUserId = await this.resolveAppUserId(actor);
      if (this.isAcheteur(actor)) {
        where.po = { buyerId: appUserId };
      } else {
        where.po = { prLinks: { some: { pr: { requestedBy: appUserId } } } };
      }
    }

    const orderBy: Prisma.InvoiceOrderByWithRelationInput = { [query.sort]: query.order };
    const skip = (query.page - 1) * query.pageSize;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({ where, orderBy, skip, take: query.pageSize }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + data.length < total,
    };
  }

  async findOne(actor: AuthenticatedUser, invoiceId: string): Promise<InvoiceWithLines> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!invoice) throw new EntityNotFoundException(ENTITY_NAME, { id: invoiceId });
    await this.assertCanRead(actor, invoice);
    return invoice;
  }

  async findMatchDetails(actor: AuthenticatedUser, invoiceId: string) {
    const invoice = await this.findOne(actor, invoiceId);
    const matches = await this.prisma.invoiceMatch.findMany({
      where: { invoiceLine: { invoiceId } },
      include: { invoiceLine: true, poLine: true, grLine: true },
      orderBy: { invoiceLine: { lineNumber: 'asc' } },
    });
    return { invoice, matches, summary: invoice.matchSummary };
  }

  async findForPo(actor: AuthenticatedUser, poId: string): Promise<Invoice[]> {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new EntityNotFoundException('PurchaseOrder', { id: poId });
    // On délègue l'autorisation au RBAC standard de la facture, l'utilisateur
    // verra seulement les factures auxquelles il a droit.
    if (!this.hasFullView(actor)) {
      const appUserId = await this.resolveAppUserId(actor);
      const reachable = await this.prisma.purchaseOrder.findFirst({
        where: this.isAcheteur(actor)
          ? { id: poId, buyerId: appUserId }
          : { id: poId, prLinks: { some: { pr: { requestedBy: appUserId } } } },
        select: { id: true },
      });
      if (!reachable) throw new PrNotOwnedException('hidden');
    }
    return this.prisma.invoice.findMany({
      where: { poId },
      orderBy: { invoiceDate: 'desc' },
    });
  }

  async downloadPdf(
    actor: AuthenticatedUser,
    invoiceId: string,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new EntityNotFoundException(ENTITY_NAME, { id: invoiceId });
    await this.assertCanRead(actor, invoice);
    if (!invoice.pdfObjectKey) {
      throw new EntityNotFoundException('InvoicePdf', { invoiceId });
    }
    const obj = await this.storage.getObject(INVOICE_BUCKET, invoice.pdfObjectKey);
    return {
      buffer: obj.buffer,
      contentType: 'application/pdf',
      filename: `${invoice.invoiceNumber}.pdf`,
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async assertUniqueInvoiceNumber(supplierId: string, invoiceNumber: string): Promise<void> {
    const existing = await this.prisma.invoice.findFirst({
      where: { supplierId, invoiceNumber },
      select: { id: true },
    });
    if (existing) throw new InvoiceDuplicateNumberException(supplierId, invoiceNumber);
  }

  /**
   * Lecture : full-view OR owner of linked PO (via ACHETEUR.buyerId ou via
   * DEMANDEUR/PI sur prLinks). Réponse 404 (obscurité) si non accessible.
   */
  private async assertCanRead(actor: AuthenticatedUser, invoice: Invoice): Promise<void> {
    if (this.hasFullView(actor)) return;
    if (!invoice.poId) {
      // Facture orpheline : seuls full-view (rejetée plus haut) voient.
      throw new PrNotOwnedException('hidden');
    }
    const appUserId = await this.resolveAppUserId(actor);
    const reachable = await this.prisma.purchaseOrder.findFirst({
      where: this.isAcheteur(actor)
        ? { id: invoice.poId, buyerId: appUserId }
        : { id: invoice.poId, prLinks: { some: { pr: { requestedBy: appUserId } } } },
      select: { id: true },
    });
    if (!reachable) throw new PrNotOwnedException('hidden');
  }

  private hasFullView(actor: AuthenticatedUser): boolean {
    return actor.roles.some((r) => FULL_VIEW_ROLES.includes(r));
  }

  private isAcheteur(actor: AuthenticatedUser): boolean {
    return actor.roles.includes('ACHETEUR');
  }

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
}
