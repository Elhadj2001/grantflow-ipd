import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, PoStatus, PrStatus } from '@prisma/client';
import type { PurchaseOrder, PurchaseOrderLine, PurchaseRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { Role } from '../../auth/types/roles';
import {
  EntityNotFoundException,
  PoCurrencyMismatchException,
  PoNotAcknowledgeableException,
  PoNotCancellableException,
  PoNotEditableException,
  PoNotSendableException,
  PoNoPdfException,
  PrAlreadyHasPoException,
  PrListEmptyException,
  PrNotApprovedException,
  PrNotOwnedException,
  PrTypePettyCashNoPoException,
  SupplierInactiveException,
  PoNotSentForSimulationException,
} from '../../common/exceptions/business.exception';
import { MailService } from '../../common/services/mail.service';
import { StorageService } from '../../common/services/storage.service';
import { PostingService } from '../../accounting/services/posting.service';
import { maskEmail } from '../../common/utils/mask-email.util';
import { SupplierInvoicePdfService } from './supplier-invoice-pdf.service';
import { InvoiceService } from '../../invoicing/services/invoice.service';
import type {
  AcknowledgePoDto,
  CancelPoDto,
  CreatePoFromMultiplePrsDto,
  CreatePoFromPrDto,
  UpdatePoDto,
} from '../dto/create-po.dto';
import type { PoQueryDto } from '../dto/po-query.dto';
import { PoPdfService } from './po-pdf.service';

const ENTITY_NAME = 'PurchaseOrder';
const PO_BUCKET = 'grantflow-pos';
/** Bucket des factures (réutilisé par le simulateur F-INVOICE-SIM). */
const INVOICE_BUCKET = 'grantflow-invoices';
/** Taux de TVA standard Sénégal (18 %) pour la facture simulée. */
const SIM_VAT_RATE = 0.18;

/**
 * Rôles qui voient tous les BCs (pas seulement ceux liés à leurs DAs).
 *
 * Sprint F-RBAC-LISTES :
 *   - BAILLEUR RETIRÉ : il n'a aucun usage métier des BCs (pas de page UI,
 *     pas de workflow associé). L'@Roles du controller le rejette en 403
 *     dès l'entrée — mais on aligne aussi le filtre service pour éviter
 *     toute dérive si un nouvel endpoint sans @Roles était ajouté.
 *   - MAGASINIER AJOUTÉ : doit voir tous les BCs en statut sent /
 *     acknowledged / partially_received pour planifier les réceptions.
 *     Sans cette inclusion, le filtre "lié à mes DAs" renvoie zéro
 *     (le magasinier ne crée pas de DA).
 */
const FULL_VIEW_ROLES: ReadonlyArray<Role> = [
  'ACHETEUR',
  'MAGASINIER',
  'CONTROLEUR',
  'DAF',
  'COMPTABLE',
  'TRESORIER',
  'SUPER_ADMIN',
];

/** Statuts considérés "actifs" (bloquent un nouveau lien PR→PO). */
const ACTIVE_PO_STATUSES: PoStatus[] = [
  PoStatus.draft,
  PoStatus.sent,
  PoStatus.acknowledged,
  PoStatus.partially_received,
  PoStatus.received,
  PoStatus.invoiced,
];

export interface PaginatedPos {
  data: PurchaseOrder[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface PoWithLines extends PurchaseOrder {
  lines: PurchaseOrderLine[];
  prIds: string[];
}

export interface SendResult {
  po: PurchaseOrder;
  pdfObjectKey: string;
  /** SMTP a-t-il accepté l'envoi ? */
  emailDelivered: boolean;
  /**
   * Sprint F-PO-EMAIL : alias lisible pour le frontend.
   * `true` ⇔ `emailDelivered === true`. Si `false`, voir `emailSkippedReason`
   * pour distinguer « pas d'adresse fournisseur » d'« erreur SMTP ».
   */
  emailDispatched: boolean;
  /**
   * Raison du non-envoi quand `emailDispatched === false`.
   * - `'no-contact-email'` : le fournisseur n'a pas de contactEmail (skip).
   * - `'smtp-error'`       : SMTP a échoué (cf. emailError pour le détail).
   * - `null`               : envoi réussi.
   */
  emailSkippedReason: 'no-contact-email' | 'smtp-error' | null;
  /**
   * Sprint F-PO-EMAIL : e-mail MASQUÉ du destinataire si l'envoi a réussi
   * (`a*****@biomed-sn.demo`). null sinon. Le frontend peut l'afficher
   * directement dans le toast sans avoir à recharger la fiche fournisseur.
   */
  emailDispatchedTo: string | null;
  emailMessageId: string | null;
  emailError: string | null;
  commitmentEntryId: string;
  commitmentEntryNumber: string;
}

/**
 * Sprint F-INVOICE-SIM — résultat du simulateur de facture (mode démo).
 * Union discriminée par `mode`.
 */
export type SimulateInvoiceResult =
  | { mode: 'download'; pdfBuffer: Buffer; filename: string }
  | { mode: 'inject'; invoiceId: string; invoiceNumber: string };

@Injectable()
export class PurchaseOrderService {
  private readonly logger = new Logger(PurchaseOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PoPdfService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
    private readonly posting: PostingService,
    // Sprint F-INVOICE-SIM (mode démo) :
    private readonly supplierInvoicePdf: SupplierInvoicePdfService,
    private readonly invoiceSvc: InvoiceService,
  ) {}

  // ------------------------------------------------------------------
  // Create from PR(s)
  // ------------------------------------------------------------------

  /**
   * Crée un BC depuis UNE seule DA approuvée.
   *
   * Pipeline :
   *  1. PR existe et appartient (ou full-view)
   *  2. PR.status === 'approved'
   *  3. PR.requestType !== 'petty_cash'    (paiement caisse, pas de BC)
   *  4. PR n'est pas déjà liée à un PO actif (≠ cancelled/closed)
   *  5. Supplier existe et est actif
   *  6. Numéro BC généré, lignes recopiées, lien purchase_order_pr
   */
  async createFromPr(
    actor: AuthenticatedUser,
    prId: string,
    dto: CreatePoFromPrDto,
  ): Promise<PoWithLines> {
    const pr = await this.prisma.purchaseRequest.findUnique({
      where: { id: prId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!pr) throw new EntityNotFoundException('PurchaseRequest', { id: prId });

    this.assertPrEligibleForPo(pr);
    await this.assertNoActivePoLink(prId);
    const supplier = await this.assertSupplierActive(dto.supplierId);

    const buyerAppUserId = await this.resolveAppUserId(actor);
    const poNumber = await this.generatePoNumber();
    const totalHt = pr.lines.reduce((s, l) => s + Number(l.lineTotal), 0);

    const created = await this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          poNumber,
          prId, // ancien champ 1-1 conservé pour compat
          supplierId: supplier.id,
          orderDate: new Date(),
          expectedDate: dto.expectedDate,
          status: PoStatus.draft,
          totalHt,
          totalVat: 0,
          totalTtc: totalHt, // TVA gérée au sprint AP, sprint 4+
          currency: pr.currency,
          incoterm: dto.incoterm,
          deliveryAddress: dto.deliveryAddress,
          buyerId: buyerAppUserId,
          lines: {
            create: pr.lines.map((l, i) => ({
              lineNumber: i + 1,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unitPrice: l.unitPrice,
              budgetLineId: l.budgetLineId,
              prLineId: l.id,
            })),
          },
          prLinks: {
            create: [{ prId }],
          },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      return po;
    });

    this.logger.log(
      { poId: created.id, poNumber, prId, supplierId: supplier.id, totalHt },
      'purchase order created from PR',
    );
    return { ...created, prIds: [prId] };
  }

  /**
   * Crée un BC en consolidant plusieurs DAs (cas typique : l'acheteur
   * groupe plusieurs petites DAs du même labo vers un même fournisseur).
   *
   * Règles supplémentaires :
   *  - Toutes les DAs en status='approved'
   *  - Toutes du même requestType (forcément standard — petty_cash interdit)
   *  - Même devise (PO_CURRENCY_MISMATCH sinon)
   *  - Aucune DA déjà liée à un PO actif
   *  - Lignes consolidées : fusion par (description, budgetLineId, unitPrice)
   *    sinon lignes séparées (renumérotées séquentiellement)
   */
  async createFromMultiplePrs(
    actor: AuthenticatedUser,
    dto: CreatePoFromMultiplePrsDto,
  ): Promise<PoWithLines> {
    if (!dto.prIds || dto.prIds.length === 0) throw new PrListEmptyException();
    const uniquePrIds = Array.from(new Set(dto.prIds));

    const prs = await this.prisma.purchaseRequest.findMany({
      where: { id: { in: uniquePrIds } },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (prs.length !== uniquePrIds.length) {
      const found = new Set(prs.map((p) => p.id));
      const missing = uniquePrIds.filter((id) => !found.has(id));
      throw new EntityNotFoundException('PurchaseRequest', { ids: missing });
    }

    for (const pr of prs) {
      this.assertPrEligibleForPo(pr);
      await this.assertNoActivePoLink(pr.id);
    }

    const currencies = Array.from(new Set(prs.map((p) => p.currency)));
    if (currencies.length > 1) throw new PoCurrencyMismatchException(currencies);

    const supplier = await this.assertSupplierActive(dto.supplierId);
    const buyerAppUserId = await this.resolveAppUserId(actor);
    const poNumber = await this.generatePoNumber();

    // Consolidation des lignes : on regroupe par signature (budgetLineId,
    // description normalisée, unitPrice). Le but est de ne pas dupliquer
    // "100 boites de gants" venant de 3 DAs différentes.
    const merged = new Map<
      string,
      {
        description: string;
        unit: string;
        unitPrice: Prisma.Decimal;
        budgetLineId: string;
        prLineIds: string[];
        totalQty: Prisma.Decimal;
      }
    >();
    for (const pr of prs) {
      for (const line of pr.lines) {
        const key = `${line.budgetLineId}|${line.description.trim().toLowerCase()}|${line.unitPrice.toString()}`;
        const existing = merged.get(key);
        if (existing) {
          existing.totalQty = new Prisma.Decimal(
            Number(existing.totalQty) + Number(line.quantity),
          );
          existing.prLineIds.push(line.id);
        } else {
          merged.set(key, {
            description: line.description,
            unit: line.unit,
            unitPrice: line.unitPrice,
            budgetLineId: line.budgetLineId,
            prLineIds: [line.id],
            totalQty: new Prisma.Decimal(Number(line.quantity)),
          });
        }
      }
    }

    const consolidatedLines = Array.from(merged.values()).map((m, idx) => ({
      lineNumber: idx + 1,
      description: m.description,
      quantity: m.totalQty,
      unit: m.unit,
      unitPrice: m.unitPrice,
      budgetLineId: m.budgetLineId,
      // On lie au prLine de la 1ʳᵉ DA — l'historique précis est tracé via
      // purchase_order_pr (toutes les DAs liées).
      prLineId: m.prLineIds[0] ?? null,
    }));

    const totalHt = consolidatedLines.reduce(
      (s, l) => s + Number(l.quantity) * Number(l.unitPrice),
      0,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          poNumber,
          prId: uniquePrIds[0], // référence "principale" (compat champ 1-1)
          supplierId: supplier.id,
          orderDate: new Date(),
          expectedDate: dto.expectedDate,
          status: PoStatus.draft,
          totalHt,
          totalVat: 0,
          totalTtc: totalHt,
          currency: prs[0].currency,
          incoterm: dto.incoterm,
          deliveryAddress: dto.deliveryAddress,
          buyerId: buyerAppUserId,
          lines: { create: consolidatedLines },
          prLinks: { create: uniquePrIds.map((id) => ({ prId: id })) },
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      return po;
    });

    this.logger.log(
      { poId: created.id, poNumber, prCount: uniquePrIds.length, totalHt },
      'purchase order created from multiple PRs',
    );
    return { ...created, prIds: uniquePrIds };
  }

  // ------------------------------------------------------------------
  // Update / Cancel
  // ------------------------------------------------------------------

  async update(actor: AuthenticatedUser, poId: string, dto: UpdatePoDto): Promise<PoWithLines> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { lines: { orderBy: { lineNumber: 'asc' } }, prLinks: true },
    });
    if (!po) throw new EntityNotFoundException(ENTITY_NAME, { id: poId });
    await this.assertCanRead(actor, po);
    if (po.status !== PoStatus.draft) throw new PoNotEditableException(po.id, po.status);

    const updated = await this.prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        incoterm: dto.incoterm,
        deliveryAddress: dto.deliveryAddress,
        expectedDate: dto.expectedDate ?? null,
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } }, prLinks: true },
    });
    return { ...updated, prIds: updated.prLinks.map((l) => l.prId) };
  }

  async acknowledge(actor: AuthenticatedUser, poId: string, dto: AcknowledgePoDto): Promise<PurchaseOrder> {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new EntityNotFoundException(ENTITY_NAME, { id: poId });
    await this.assertCanRead(actor, po);
    if (po.status !== PoStatus.sent) throw new PoNotAcknowledgeableException(po.id, po.status);

    return this.prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        status: PoStatus.acknowledged,
        acknowledgedAt: new Date(),
        acknowledgedBy: dto.ackRef,
      },
    });
  }

  /**
   * Annule un BC. Si l'engagement classe 8 a été posté (statut ≥ sent),
   * une écriture inverse est créée pour soldé.
   */
  async cancel(
    actor: AuthenticatedUser,
    poId: string,
    dto: CancelPoDto,
  ): Promise<{ po: PurchaseOrder; reverseEntryId: string | null; reverseEntryNumber: string | null }> {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new EntityNotFoundException(ENTITY_NAME, { id: poId });
    await this.assertCanRead(actor, po);

    const cancellableStatuses: PoStatus[] = [
      PoStatus.draft,
      PoStatus.sent,
      PoStatus.acknowledged,
    ];
    if (!cancellableStatuses.includes(po.status)) {
      throw new PoNotCancellableException(po.id, po.status);
    }

    const needsReverse = po.status === PoStatus.sent || po.status === PoStatus.acknowledged;
    const appUserId = await this.resolveAppUserId(actor);

    const cancelled = await this.prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        status: PoStatus.cancelled,
        cancelledAt: new Date(),
        cancellationReason: dto.reason,
      },
    });

    let reverseEntryId: string | null = null;
    let reverseEntryNumber: string | null = null;
    if (needsReverse) {
      const reverse = await this.posting.reverseCommitmentEntry(
        po,
        { id: appUserId, email: actor.email, fullName: actor.fullName },
        dto.reason,
      );
      reverseEntryId = reverse.id;
      reverseEntryNumber = reverse.entryNumber;
    }

    this.logger.log(
      { poId: po.id, status: 'cancelled', reverseEntryNumber, reason: dto.reason },
      'purchase order cancelled',
    );
    return { po: cancelled, reverseEntryId, reverseEntryNumber };
  }

  // ------------------------------------------------------------------
  // Send + resend
  // ------------------------------------------------------------------

  /**
   * Émet le BC vers le fournisseur :
   *  1. Génère le PDF
   *  2. Upload MinIO (bucket grantflow-pos)
   *  3. Crée l'écriture comptable d'engagement classe 8 (801/802)
   *  4. Envoie l'email (non bloquant — si SMTP down, on log et retry possible)
   *  5. status → sent, sentAt + emailSentAt + pdfObjectKey persistés
   */
  async send(actor: AuthenticatedUser, poId: string): Promise<SendResult> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
        prLinks: { select: { prId: true } },
      },
    });
    if (!po) throw new EntityNotFoundException(ENTITY_NAME, { id: poId });
    await this.assertCanRead(actor, po);
    if (po.status !== PoStatus.draft) throw new PoNotSendableException(po.id, po.status);

    const supplier = await this.assertSupplierActive(po.supplierId);
    const prNumbers = await this.prisma.purchaseRequest.findMany({
      where: { id: { in: po.prLinks.map((l) => l.prId) } },
      select: { prNumber: true },
    });
    const buyer = po.buyerId
      ? await this.prisma.appUser.findUnique({
          where: { id: po.buyerId },
          select: { fullName: true, email: true },
        })
      : null;

    // 1) PDF
    const pdfBuffer = await this.pdf.generate({
      poNumber: po.poNumber,
      orderDate: po.orderDate,
      expectedDate: po.expectedDate ?? null,
      currency: po.currency,
      totalHt: Number(po.totalHt),
      totalVat: Number(po.totalVat),
      totalTtc: Number(po.totalTtc),
      incoterm: po.incoterm,
      deliveryAddress: po.deliveryAddress,
      prNumbers: prNumbers.map((p) => p.prNumber),
      supplier: {
        name: supplier.name,
        code: supplier.code,
        address: supplier.address,
        country: supplier.country,
        contactEmail: this.resolveSupplierEmail(supplier),
        paymentTermsDays: supplier.paymentTermsDays,
      },
      lines: po.lines.map((l) => ({
        lineNumber: l.lineNumber,
        description: l.description,
        quantity: Number(l.quantity),
        unit: l.unit,
        unitPrice: Number(l.unitPrice),
        lineTotal: Number(l.lineTotal),
      })),
      buyer,
      emittedAt: new Date(),
    });

    // 2) MinIO
    const now = new Date();
    const objectKey = `pos/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(
      2,
      '0',
    )}/${po.id}.pdf`;
    await this.storage.putObject({
      bucket: PO_BUCKET,
      objectKey,
      buffer: pdfBuffer,
      contentType: 'application/pdf',
      metadata: { 'x-po-number': po.poNumber, 'x-supplier-code': supplier.code },
    });

    // 3) Écriture comptable d'engagement (classe 8)
    const appUserId = await this.resolveAppUserId(actor);
    const entry = await this.posting.createCommitmentEntry(po, {
      id: appUserId,
      email: actor.email,
      fullName: actor.fullName,
    });

    // 4) Email (BEST-EFFORT — ne fait JAMAIS échouer la transition `sent`
    //    ni l'engagement classe 8 créés en amont)
    const supplierEmail = this.resolveSupplierEmail(supplier);
    let mailResult: { delivered: boolean; messageId: string | null; error: string | null };
    let skippedReason: 'no-contact-email' | 'smtp-error' | null = null;
    if (supplierEmail) {
      const result = await this.mail.send({
        to: supplierEmail,
        subject: `[GRANTFLOW IPD] Bon de commande ${po.poNumber}`,
        text: this.buildEmailText(po, supplier),
        html: this.buildEmailHtml(po, supplier),
        attachments: [
          { filename: `${po.poNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
        ],
      });
      mailResult = { delivered: result.delivered, messageId: result.messageId, error: result.error };
      if (!result.delivered) {
        skippedReason = 'smtp-error';
        // Log e-mail MASQUÉ — pas de PII. Le détail err vient de
        // MailService et reflète l'erreur SMTP (timeout, auth, etc.).
        this.logger.warn(
          { poId: po.id, supplierId: supplier.id, to: maskEmail(supplierEmail), err: result.error },
          'PO email dispatch failed — PO is still in `sent` status (best-effort)',
        );
      } else {
        // Succès : on logue le succès + e-mail masqué pour traçabilité.
        this.logger.log(
          { poId: po.id, supplierId: supplier.id, to: maskEmail(supplierEmail), messageId: result.messageId },
          'PO email dispatched to supplier',
        );
      }
    } else {
      skippedReason = 'no-contact-email';
      this.logger.warn(
        { poId: po.id, supplierId: supplier.id },
        'supplier has no contact email — PO sent without notification',
      );
      mailResult = { delivered: false, messageId: null, error: 'No supplier contact email' };
    }

    // 5) Persist
    const updated = await this.prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: PoStatus.sent,
        sentAt: new Date(),
        pdfObjectKey: objectKey,
        emailSentAt: mailResult.delivered ? new Date() : null,
        emailSentTo: mailResult.delivered ? supplierEmail : null,
      },
    });

    return {
      po: updated,
      pdfObjectKey: objectKey,
      emailDelivered: mailResult.delivered,
      emailDispatched: mailResult.delivered,
      emailSkippedReason: skippedReason,
      emailDispatchedTo: mailResult.delivered && supplierEmail ? maskEmail(supplierEmail) : null,
      emailMessageId: mailResult.messageId,
      emailError: mailResult.error,
      commitmentEntryId: entry.id,
      commitmentEntryNumber: entry.entryNumber,
    };
  }

  /**
   * Re-envoie l'email sans regénérer le PDF ni recréer l'écriture
   * comptable. Utile si SMTP était down au moment du send initial.
   */
  async resend(actor: AuthenticatedUser, poId: string): Promise<{
    delivered: boolean;
    messageId: string | null;
    error: string | null;
    to: string | null;
  }> {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new EntityNotFoundException(ENTITY_NAME, { id: poId });
    await this.assertCanRead(actor, po);
    if (!po.pdfObjectKey) throw new PoNoPdfException(po.id);

    const supplier = await this.prisma.supplier.findUnique({ where: { id: po.supplierId } });
    if (!supplier) throw new EntityNotFoundException('Supplier', { id: po.supplierId });
    const supplierEmail = this.resolveSupplierEmail(supplier);
    if (!supplierEmail) {
      return { delivered: false, messageId: null, error: 'No supplier contact email', to: null };
    }

    const pdf = await this.storage.getObject(PO_BUCKET, po.pdfObjectKey);
    const result = await this.mail.send({
      to: supplierEmail,
      subject: `[GRANTFLOW IPD] Bon de commande ${po.poNumber} (rappel)`,
      text: this.buildEmailText(po, supplier),
      html: this.buildEmailHtml(po, supplier),
      attachments: [
        { filename: `${po.poNumber}.pdf`, content: pdf.buffer, contentType: 'application/pdf' },
      ],
    });

    await this.prisma.purchaseOrder.update({
      where: { id: po.id },
      data: result.delivered
        ? { emailSentAt: new Date(), emailSentTo: supplierEmail }
        : {},
    });

    return {
      delivered: result.delivered,
      messageId: result.messageId,
      error: result.error,
      to: supplierEmail,
    };
  }

  // ------------------------------------------------------------------
  // Sprint F-INVOICE-SIM — Simulateur de facture fournisseur (mode démo)
  // ------------------------------------------------------------------

  /**
   * Génère une facture fournisseur SIMULÉE à partir d'un BC `sent`.
   *
   * ⚠️ Le gating du flag (ENABLE_DEMO_INVOICE_SIMULATOR) est fait par le
   * controller (404 si désactivé). Ici on valide juste les pré-conditions
   * métier : PO existe, accessible en lecture, statut === `sent`.
   *
   * - mode 'download' : renvoie le buffer PDF (l'utilisateur le re-upload
   *   via /invoices/upload → l'OCR Vision s'exécute = effet démo).
   * - mode 'inject' : stocke le PDF + crée une Invoice `captured` avec les
   *   champs déjà remplis (skip OCR, parcours rapide pour les répétitions).
   *
   * Les montants sont recalculés à partir des lignes du BC avec TVA 18 % —
   * HT/TVA/TTC cohérents et alignés sur le BC (matching 3-way garanti).
   */
  async simulateInvoice(
    actor: AuthenticatedUser,
    poId: string,
    mode: 'download' | 'inject',
  ): Promise<SimulateInvoiceResult> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!po) throw new EntityNotFoundException(ENTITY_NAME, { id: poId });
    await this.assertCanRead(actor, po);
    if (po.status !== PoStatus.sent) {
      throw new PoNotSentForSimulationException(po.id, po.status);
    }
    const supplier = await this.assertSupplierActive(po.supplierId);

    // Séquence pour le n° de facture (évite les collisions sur re-simulation).
    const existingCount = await this.prisma.invoice.count({
      where: {
        supplierId: po.supplierId,
        invoiceNumber: { startsWith: `FAC-SIM-${po.poNumber}-` },
      },
    });
    const seq = existingCount + 1;
    const invoiceNumber = `FAC-SIM-${po.poNumber}-${seq}`;

    // Montants : HT = somme des lignes du BC, TVA 18 %, TTC = HT + TVA.
    const lines = po.lines.map((l) => ({
      lineNumber: l.lineNumber,
      description: l.description,
      quantity: Number(l.quantity),
      unit: l.unit,
      unitPrice: Number(l.unitPrice),
      lineTotal: Number(l.lineTotal),
    }));
    const totalHt = lines.reduce((s, l) => s + l.lineTotal, 0);
    const totalVat = Math.round(totalHt * SIM_VAT_RATE * 100) / 100;
    const totalTtc = Math.round((totalHt + totalVat) * 100) / 100;

    const invoiceDate = new Date();
    const dueDate = new Date(invoiceDate);
    dueDate.setUTCDate(dueDate.getUTCDate() + supplier.paymentTermsDays);

    const pdfBuffer = await this.supplierInvoicePdf.generate({
      invoiceNumber,
      invoiceDate,
      dueDate,
      poNumber: po.poNumber,
      currency: po.currency,
      supplier: {
        name: supplier.name,
        vatNumber: supplier.vatNumber,
        address: supplier.address,
        country: supplier.country,
      },
      lines,
      totalHt,
      totalVat,
      totalTtc,
      vatRate: SIM_VAT_RATE,
      paymentTermsDays: supplier.paymentTermsDays,
    });

    if (mode === 'download') {
      this.logger.log(
        { poId: po.id, mode, invoiceNumber },
        'simulated supplier invoice generated (download mode)',
      );
      return {
        mode: 'download',
        pdfBuffer,
        filename: `${invoiceNumber}.pdf`,
      };
    }

    // mode === 'inject' : stocke le PDF + crée l'Invoice captured.
    const now = new Date();
    const objectKey = `invoices/${now.getUTCFullYear()}/${String(
      now.getUTCMonth() + 1,
    ).padStart(2, '0')}/sim-${randomUUID()}.pdf`;
    await this.storage.putObject({
      bucket: INVOICE_BUCKET,
      objectKey,
      buffer: pdfBuffer,
      contentType: 'application/pdf',
      metadata: { 'x-invoice-number': invoiceNumber, 'x-source': 'demo-simulator' },
    });

    const invoice = await this.invoiceSvc.createFromSimulatedPdf(actor, {
      supplierId: po.supplierId,
      poId: po.id,
      invoiceNumber,
      invoiceDate,
      dueDate,
      currency: po.currency,
      totalHt,
      totalVat,
      totalTtc,
      pdfObjectKey: objectKey,
      lines: lines.map((l) => ({
        lineNumber: l.lineNumber,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
    });

    this.logger.log(
      { poId: po.id, mode, invoiceId: invoice.id, invoiceNumber },
      'simulated supplier invoice injected (captured)',
    );
    return { mode: 'inject', invoiceId: invoice.id, invoiceNumber };
  }

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  async findMany(actor: AuthenticatedUser, query: PoQueryDto): Promise<PaginatedPos> {
    const scopedUserId = this.hasFullView(actor) ? null : await this.resolveAppUserId(actor);

    const where: Prisma.PurchaseOrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.q) {
      where.OR = [
        { poNumber: { contains: query.q.trim(), mode: 'insensitive' } },
        { incoterm: { contains: query.q.trim(), mode: 'insensitive' } },
      ];
    }
    if (query.fromDate || query.toDate) {
      where.orderDate = {};
      if (query.fromDate) where.orderDate.gte = new Date(query.fromDate);
      if (query.toDate) where.orderDate.lte = new Date(query.toDate);
    }
    if (scopedUserId) {
      where.prLinks = { some: { pr: { requestedBy: scopedUserId } } };
    }

    const orderBy: Prisma.PurchaseOrderOrderByWithRelationInput = { [query.sort]: query.order };
    const skip = (query.page - 1) * query.pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({ where, orderBy, skip, take: query.pageSize }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + data.length < total,
    };
  }

  async findOne(actor: AuthenticatedUser, poId: string): Promise<PoWithLines> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
        prLinks: { select: { prId: true } },
      },
    });
    if (!po) throw new EntityNotFoundException(ENTITY_NAME, { id: poId });
    await this.assertCanRead(actor, po);
    return { ...po, prIds: po.prLinks.map((l) => l.prId) };
  }

  async downloadPdf(actor: AuthenticatedUser, poId: string): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw new EntityNotFoundException(ENTITY_NAME, { id: poId });
    await this.assertCanRead(actor, po);
    if (!po.pdfObjectKey) throw new PoNoPdfException(po.id);
    const obj = await this.storage.getObject(PO_BUCKET, po.pdfObjectKey);
    return {
      buffer: obj.buffer,
      contentType: 'application/pdf',
      filename: `${po.poNumber}.pdf`,
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private assertPrEligibleForPo(pr: PurchaseRequest): void {
    if (pr.status !== PrStatus.approved) throw new PrNotApprovedException(pr.id, pr.status);
    if (pr.requestType === 'petty_cash') throw new PrTypePettyCashNoPoException(pr.id);
    // cash_advance peut théoriquement donner lieu à un BC (achat à crédit
    // remboursé via avance) mais le métier dit "rare" — on l'autorise.
  }

  private async assertNoActivePoLink(prId: string): Promise<void> {
    const existing = await this.prisma.purchaseOrderPr.findFirst({
      where: { prId, po: { status: { in: ACTIVE_PO_STATUSES } } },
      select: { poId: true },
    });
    if (existing) throw new PrAlreadyHasPoException(prId, existing.poId);
  }

  private async assertSupplierActive(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new EntityNotFoundException('Supplier', { id: supplierId });
    if (!supplier.isActive) throw new SupplierInactiveException(supplier.id);
    return supplier;
  }

  /**
   * Le modèle Supplier n'expose pas (encore) `contactEmail` directement.
   * On scrute les champs custom : `contactEmail` ajouté par sprint 1.3
   * sinon fallback null. Le service ne crashe pas si absent.
   */
  private resolveSupplierEmail(supplier: { [key: string]: unknown }): string | null {
    const candidate =
      (supplier as Record<string, unknown>).contactEmail ??
      (supplier as Record<string, unknown>).email ??
      null;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
  }

  private buildEmailText(po: PurchaseOrder, supplier: { name: string }): string {
    return [
      `Cher partenaire ${supplier.name},`,
      '',
      `Veuillez trouver ci-joint notre bon de commande ${po.poNumber} d'un montant total de`,
      `${Number(po.totalTtc).toLocaleString('fr-FR')} ${po.currency} (TTC).`,
      '',
      `Nous vous remercions de bien vouloir confirmer la réception et nous indiquer une`,
      `date de livraison prévisionnelle.`,
      '',
      'Cordialement,',
      "Service Achats — Institut Pasteur de Dakar",
    ].join('\n');
  }

  private buildEmailHtml(po: PurchaseOrder, supplier: { name: string }): string {
    return `<!doctype html><html><body>
<p>Cher partenaire <strong>${supplier.name}</strong>,</p>
<p>Veuillez trouver ci-joint notre <strong>bon de commande ${po.poNumber}</strong>
d'un montant total de <strong>${Number(po.totalTtc).toLocaleString('fr-FR')} ${po.currency}</strong> (TTC).</p>
<p>Nous vous remercions de bien vouloir confirmer la réception et nous indiquer
une date de livraison prévisionnelle.</p>
<p>Cordialement,<br/>Service Achats — Institut Pasteur de Dakar</p>
</body></html>`;
  }

  /**
   * Lecture : full-view OR auteur de l'une des DAs liées.
   * Réponse 404 (obscurité OWASP) si pas accessible.
   */
  private async assertCanRead(
    actor: AuthenticatedUser,
    po: { id: string },
  ): Promise<void> {
    if (this.hasFullView(actor)) return;
    const appUserId = await this.resolveAppUserId(actor);
    const link = await this.prisma.purchaseOrderPr.findFirst({
      where: { poId: po.id, pr: { requestedBy: appUserId } },
      select: { poId: true },
    });
    if (!link) throw new PrNotOwnedException('hidden');
  }

  private hasFullView(actor: AuthenticatedUser): boolean {
    return actor.roles.some((r) => FULL_VIEW_ROLES.includes(r));
  }

  /**
   * Bridge Keycloak.sub → auth.app_user.id (cf. sprint 2.1).
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
   * Numéro BC : `BC-YYYY-NNNN`. Verrou advisory pour concurrence.
   */
  private async generatePoNumber(): Promise<string> {
    const year = new Date().getFullYear();
    return this.prisma.$transaction(async (tx) => {
      const lockKey = this.hashToBigInt(`po_seq_${year}`);
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
      // MAX au lieu de COUNT : resilient aux trous
      const last = await tx.purchaseOrder.findFirst({
        where: { poNumber: { startsWith: `BC-${year}-` } },
        orderBy: { poNumber: 'desc' },
        select: { poNumber: true },
      });
      const lastSeq = last ? parseInt(last.poNumber.split('-')[2] ?? '0', 10) : 0;
      const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
      return `BC-${year}-${String(next).padStart(4, '0')}`;
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
