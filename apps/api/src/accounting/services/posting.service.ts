import { Injectable, Logger } from '@nestjs/common';
import { JournalType, EntryStatus, InvoiceStatus } from '@prisma/client';
import type {
  BankAccount,
  Invoice,
  JournalEntry,
  JournalLine,
  Payment,
  Prisma,
  PurchaseOrder,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BankAccountWrongClassException,
  EntityNotFoundException,
  ExchangeRateMissingException,
  FxDiffTooLargeException,
  GlAccountNotFoundException,
  InvoiceAlreadyPostedException,
  InvoiceNotPostableException,
  NoOpenFiscalPeriodException,
  PaymentCurrencyMismatchException,
  PeriodClosedException,
  PostingCancelReasonRequiredException,
  PostingHasPaymentException,
} from '../../common/exceptions/business.exception';

/** Comptes utilisés pour l'engagement classe 8. */
export const ACCOUNT_ENGAGEMENT_DONNE = '801';
export const ACCOUNT_CONTRE_ENGAGEMENT = '802';
/** Compte fournisseur (classe 4). */
export const ACCOUNT_SUPPLIERS = '401';
/** TVA déductible (classe 4). */
export const ACCOUNT_VAT_DEDUCTIBLE = '445';
/** Compte de charge fallback si rien n'est résolu ailleurs. */
export const ACCOUNT_FALLBACK_EXPENSE = '605';
/** Pertes / gains de change (sprint 5.2 multidevises). */
export const ACCOUNT_FX_LOSS = '666';
export const ACCOUNT_FX_GAIN = '766';
/**
 * Seuil de sanity (% du montant facture) au-delà duquel un écart de
 * change déclenche FX_DIFF_TOO_LARGE. Vise les erreurs de saisie de
 * taux (typo ×10 ou inversion de paire).
 */
export const FX_DIFF_SAFETY_THRESHOLD_PCT = 10;

/** Type d'écriture émis par ce service — utilisé en `source_type`. */
export const SOURCE_TYPE_PO = 'purchase_order';
export const SOURCE_TYPE_INVOICE = 'invoice';
export const SOURCE_TYPE_PAYMENT = 'payment';

export interface PostingActor {
  id: string;
  email: string;
  fullName?: string;
}

/** Sous-ensemble d'InvoiceLine nécessaire à `postInvoice`. */
export interface InvoiceLineForPosting {
  id: string;
  lineNumber: number;
  description: string;
  lineTotal: Prisma.Decimal | number;
  poLineId: string | null;
  glAccount: string | null;
}

/** Imputation analytique transverse (recopiée sur les journal_lines 6xx). */
interface ImputationSnapshot {
  projectId: string | null;
  grantId: string | null;
  budgetLineId: string | null;
  costCenterId: string | null;
  activityId: string | null;
}

export interface PostInvoiceResult {
  invoice: Invoice;
  acEntryId: string;
  acEntryNumber: string;
  reversalEntryId: string;
  reversalEntryNumber: string;
  exchangeRate: number;
  totalTtcXof: number;
}

export interface CancelPostingResult {
  invoice: Invoice;
  acReverseEntryId: string;
  acReverseEntryNumber: string;
  class8RecreatedEntryId: string | null;
  class8RecreatedEntryNumber: string | null;
}

export interface PostPaymentResult {
  entryId: string;
  entryNumber: string;
  amountXof: number;
  /** Écart de change signé (XOF). Positif = gain (766), négatif = perte (666). */
  fxGainLoss: number;
}

/**
 * Service de comptabilisation.
 *
 * Pour le sprint 3, on ne traite que l'engagement classe 8 lié à un BC.
 * Le service est conçu pour accueillir les autres flux (facturation,
 * paiement, overhead, fonds dédiés) dans les sprints suivants.
 *
 * Invariants enforced ici :
 *  - Une écriture posted est équilibrée (∑debit = ∑credit) — calculé en
 *    application avant de promouvoir l'entry à `posted`, le trigger DB
 *    rejette toute modification ultérieure qui casserait l'équilibre.
 *  - Période fiscale ouverte couvrant la date — sinon le trigger DB
 *    refuse l'INSERT. On pré-cherche la période côté app pour donner un
 *    code d'erreur métier propre (NO_OPEN_FISCAL_PERIOD) au lieu d'un
 *    cryptique 500 PostgreSQL.
 *  - Imputation analytique (project_id / grant_id / budget_line_id /
 *    cost_center_id / activity_id) recopiée de la PR liée pour traçabilité.
 */
@Injectable()
export class PostingService {
  private readonly logger = new Logger(PostingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crée l'écriture d'engagement comptable classe 8 pour un BC envoyé.
   *
   * 2 lignes :
   *   - 801 (Engagements donnés)         debit  = po.totalHt
   *   - 802 (Contre-engagement)          credit = po.totalHt
   *
   * Imputation analytique : recopiée de la 1ʳᵉ DA liée (project, grant,
   * budget line, cost center, activity).
   *
   * @returns la JournalEntry créée (status = posted, lines incluses)
   */
  async createCommitmentEntry(
    po: PurchaseOrder & { prLinks?: Array<{ prId: string }> },
    actor: PostingActor,
  ): Promise<JournalEntry & { lines: JournalLine[] }> {
    const period = await this.findOpenPeriodForDate(po.orderDate);
    const imputation = await this.resolveImputation(po);
    const total = Number(po.totalHt);
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: po.supplierId },
      select: { name: true },
    });
    const supplierName = supplier?.name ?? 'fournisseur inconnu';

    return this.prisma.$transaction(async (tx) => {
      const entryNumber = await this.generateEntryNumber(tx, JournalType.OD);

      // 1) Création en draft (le trigger balance ne se déclenche que sur posted).
      const entry = await tx.journalEntry.create({
        data: {
          entryNumber,
          journal: JournalType.OD,
          entryDate: po.orderDate,
          periodId: period.id,
          label: `Engagement BC ${po.poNumber} - ${supplierName}`,
          sourceType: SOURCE_TYPE_PO,
          sourceId: po.id,
          status: EntryStatus.draft,
        },
      });

      const baseImputation = {
        projectId: imputation.projectId,
        grantId: imputation.grantId,
        budgetLineId: imputation.budgetLineId,
        costCenterId: imputation.costCenterId,
        activityId: imputation.activityId,
      };

      await tx.journalLine.createMany({
        data: [
          {
            entryId: entry.id,
            lineNumber: 1,
            accountCode: ACCOUNT_ENGAGEMENT_DONNE,
            label: `Engagement ${po.poNumber}`,
            debit: total,
            credit: 0,
            currency: po.currency,
            ...baseImputation,
          },
          {
            entryId: entry.id,
            lineNumber: 2,
            accountCode: ACCOUNT_CONTRE_ENGAGEMENT,
            label: `Contre-engagement ${po.poNumber}`,
            debit: 0,
            credit: total,
            currency: po.currency,
            ...baseImputation,
          },
        ],
      });

      // 2) Promotion en posted + posted_by/at.
      const posted = await tx.journalEntry.update({
        where: { id: entry.id },
        data: {
          status: EntryStatus.posted,
          postedAt: new Date(),
          postedBy: actor.id,
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      this.logger.log(
        { entryNumber, poId: po.id, total, currency: po.currency },
        'commitment entry posted',
      );
      return posted;
    });
  }

  /**
   * Extourne l'écriture d'engagement classe 8 d'un BC annulé.
   *
   * Stratégie : on génère une nouvelle entry avec les lignes inversées
   * (801 credit / 802 debit, mêmes montants), on chaîne via `reversedById`
   * sur l'entry d'origine.
   *
   * @returns la nouvelle entry (status = posted)
   */
  async reverseCommitmentEntry(
    po: PurchaseOrder,
    actor: PostingActor,
    reason: string,
  ): Promise<JournalEntry & { lines: JournalLine[] }> {
    const original = await this.prisma.journalEntry.findFirst({
      where: {
        sourceType: SOURCE_TYPE_PO,
        sourceId: po.id,
        status: EntryStatus.posted,
        reversedById: null,
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!original) {
      throw new EntityNotFoundException('JournalEntry', { sourceType: SOURCE_TYPE_PO, sourceId: po.id });
    }

    const today = new Date();
    const period = await this.findOpenPeriodForDate(today);

    return this.prisma.$transaction(async (tx) => {
      const entryNumber = await this.generateEntryNumber(tx, JournalType.OD);

      const reverse = await tx.journalEntry.create({
        data: {
          entryNumber,
          journal: JournalType.OD,
          entryDate: today,
          periodId: period.id,
          label: `Extourne engagement BC ${po.poNumber} - ${reason}`,
          sourceType: SOURCE_TYPE_PO,
          sourceId: po.id,
          status: EntryStatus.draft,
        },
      });

      // Lignes inversées : debit ↔ credit, mêmes comptes, même imputation.
      await tx.journalLine.createMany({
        data: original.lines.map((l) => ({
          entryId: reverse.id,
          lineNumber: l.lineNumber,
          accountCode: l.accountCode,
          label: `Extourne ${l.label ?? ''}`.trim(),
          debit: Number(l.credit),
          credit: Number(l.debit),
          currency: l.currency,
          projectId: l.projectId,
          grantId: l.grantId,
          budgetLineId: l.budgetLineId,
          costCenterId: l.costCenterId,
          activityId: l.activityId,
        })),
      });

      const posted = await tx.journalEntry.update({
        where: { id: reverse.id },
        data: {
          status: EntryStatus.posted,
          postedAt: new Date(),
          postedBy: actor.id,
        },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      // Marquer l'écriture d'origine comme reversed.
      await tx.journalEntry.update({
        where: { id: original.id },
        data: { reversedById: posted.id, status: EntryStatus.reversed },
      });

      this.logger.log(
        { entryNumber, poId: po.id, originalEntry: original.entryNumber, reason },
        'commitment entry reversed',
      );
      return posted;
    });
  }

  /**
   * Liste les écritures comptables liées à un PO (source_type / source_id),
   * lignes incluses.
   */
  async listEntriesForPo(poId: string): Promise<Array<JournalEntry & { lines: JournalLine[] }>> {
    return this.prisma.journalEntry.findMany({
      where: { sourceType: SOURCE_TYPE_PO, sourceId: poId },
      orderBy: { createdAt: 'asc' },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
  }

  /**
   * Liste les écritures liées à une facture (sourceType='invoice') :
   *  - 1 AC (achat) avec lignes 6xx / 445 / 401
   *  - 1 OD d'extournement classe 8 (sourceType='purchase_order' mais
   *    filtré aussi via le `match_summary.commitmentReversedEntries`)
   */
  async listEntriesForInvoice(
    invoiceId: string,
  ): Promise<Array<JournalEntry & { lines: JournalLine[] }>> {
    return this.prisma.journalEntry.findMany({
      where: { sourceType: SOURCE_TYPE_INVOICE, sourceId: invoiceId },
      orderBy: { createdAt: 'asc' },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
  }

  // ------------------------------------------------------------------
  // Sprint 4.2b — postInvoice (classes 4/6/445) + extournement classe 8
  // ------------------------------------------------------------------

  /**
   * Comptabilise une facture `matched` :
   *  - Écriture AC (journal Achats) :
   *      Débit 6xx (charge) par ligne (HT) + imputation analytique
   *      Débit 445 (TVA déductible) si totalVat > 0
   *      Crédit 401 (Fournisseurs) au TTC, auxiliary_code = supplier.code
   *  - Écriture OD d'extournement classe 8 :
   *      Crédit 801 + Débit 802 au montant HT de la facture (partielle)
   *      Si la fraction cumulée atteint 100% (à 0,1% près), marque
   *      l'engagement d'origine comme `reversed`.
   *
   * Multidevises : si invoice.currency ≠ XOF, on cherche un taux dans
   * `ref.exchange_rate` à invoice_date (sinon EXCHANGE_RATE_MISSING),
   * on convertit en XOF pour les colonnes `debit`/`credit`, et on
   * conserve la valeur originale dans `debit_currency`/`credit_currency`.
   * L'écart de change effectif sera capté au paiement (sprint 5).
   *
   * Le statut de la facture passe à `posted`. `postedAt` est mis à jour.
   * Le `match_summary` est enrichi d'un sous-objet `posting` avec entry
   * AC + reversal OD + montants effectifs.
   */
  async postInvoice(
    invoice: Invoice & { lines: Array<InvoiceLineForPosting> },
    actor: PostingActor,
  ): Promise<PostInvoiceResult> {
    // 1) Pré-conditions
    if (invoice.status === InvoiceStatus.posted) {
      throw new InvoiceAlreadyPostedException(invoice.id);
    }
    if (invoice.status !== InvoiceStatus.matched) {
      throw new InvoiceNotPostableException(invoice.id, invoice.status);
    }
    if (!invoice.poId) {
      throw new EntityNotFoundException('PurchaseOrder', { invoiceId: invoice.id });
    }
    if (invoice.lines.length === 0) {
      throw new EntityNotFoundException('InvoiceLine', { invoiceId: invoice.id });
    }

    // 2) Période fiscale ouverte à invoice_date (peut lever PERIOD_CLOSED
    //    ou NO_OPEN_FISCAL_PERIOD)
    const period = await this.findOpenPeriodForDate(invoice.invoiceDate);

    // 3) PO + supplier
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: invoice.poId },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
        prLinks: { select: { prId: true } },
      },
    });
    if (!po) throw new EntityNotFoundException('PurchaseOrder', { id: invoice.poId });

    const supplier = await this.prisma.supplier.findUnique({
      where: { id: invoice.supplierId },
      select: { id: true, code: true, name: true },
    });
    if (!supplier) throw new EntityNotFoundException('Supplier', { id: invoice.supplierId });

    // 4) Imputation analytique héritée de la 1ʳᵉ PR liée
    const imputation = await this.resolveImputation(po);

    // 5) Résolution des comptes 6xx par ligne (priorité :
    //    invoice_line.glAccount > budget_line.default_account > '605')
    const resolved = await this.resolveExpenseAccounts(invoice.lines, po.lines);

    // 6) Taux de change si multidevise
    let exchangeRate = 1;
    if (invoice.currency !== 'XOF') {
      exchangeRate = await this.lookupExchangeRate(invoice.currency, 'XOF', invoice.invoiceDate);
    }

    // 7) Montants effectifs (en XOF pour les colonnes debit/credit)
    const linesHtCurrency = invoice.lines.map((l) => Number(l.lineTotal));
    const totalVatCurrency = Number(invoice.totalVat);
    const totalTtcCurrency = Number(invoice.totalTtc);

    return this.prisma.$transaction(async (tx) => {
      // 8) Numéros de pièces
      const acEntryNumber = await this.generateEntryNumber(tx, JournalType.AC);

      // 9) Écriture AC : debit 6xx (par ligne) + debit 445 + credit 401
      const acEntry = await tx.journalEntry.create({
        data: {
          entryNumber: acEntryNumber,
          journal: JournalType.AC,
          entryDate: invoice.invoiceDate,
          periodId: period.id,
          label: `Facture ${supplier.code} ${invoice.invoiceNumber}`,
          sourceType: SOURCE_TYPE_INVOICE,
          sourceId: invoice.id,
          status: EntryStatus.draft,
        },
      });

      // Préparation des lignes
      const linesData: Prisma.JournalLineCreateManyInput[] = [];
      let lineNumber = 1;
      for (let i = 0; i < invoice.lines.length; i += 1) {
        const il = invoice.lines[i];
        const account = resolved.byLineId.get(il.id)!;
        const amountCurrency = linesHtCurrency[i];
        const amountXof = this.roundXof(amountCurrency * exchangeRate);
        linesData.push({
          entryId: acEntry.id,
          lineNumber,
          accountCode: account,
          label: `${invoice.invoiceNumber} L${il.lineNumber} ${il.description.slice(0, 64)}`,
          debit: amountXof,
          credit: 0,
          currency: invoice.currency,
          debitCurrency: invoice.currency === 'XOF' ? null : amountCurrency,
          creditCurrency: invoice.currency === 'XOF' ? null : 0,
          ...imputation,
        });
        lineNumber += 1;
      }

      // TVA déductible (pas d'imputation analytique par convention SYSCEBNL)
      if (totalVatCurrency > 0) {
        const vatXof = this.roundXof(totalVatCurrency * exchangeRate);
        linesData.push({
          entryId: acEntry.id,
          lineNumber,
          accountCode: ACCOUNT_VAT_DEDUCTIBLE,
          label: `TVA déductible ${invoice.invoiceNumber}`,
          debit: vatXof,
          credit: 0,
          currency: invoice.currency,
          debitCurrency: invoice.currency === 'XOF' ? null : totalVatCurrency,
          creditCurrency: invoice.currency === 'XOF' ? null : 0,
        });
        lineNumber += 1;
      }

      // Contrepartie : 401 Fournisseurs au TTC
      const ttcXof = this.roundXof(totalTtcCurrency * exchangeRate);
      linesData.push({
        entryId: acEntry.id,
        lineNumber,
        accountCode: ACCOUNT_SUPPLIERS,
        auxiliaryCode: supplier.code,
        label: `Fournisseur ${supplier.code} - ${invoice.invoiceNumber}`,
        debit: 0,
        credit: ttcXof,
        currency: invoice.currency,
        debitCurrency: invoice.currency === 'XOF' ? null : 0,
        creditCurrency: invoice.currency === 'XOF' ? null : totalTtcCurrency,
      });

      await tx.journalLine.createMany({ data: linesData });

      // 10) Promotion AC → posted (le trigger valide l'équilibre debit=credit)
      await tx.journalEntry.update({
        where: { id: acEntry.id },
        data: { status: EntryStatus.posted, postedAt: new Date(), postedBy: actor.id },
      });

      // 11) Extournement partiel de l'engagement classe 8
      //     Stratégie : on crée une OD source=purchase_order, sourceId=po.id,
      //     label "Extourne engagement BC X (facture Y)". On cumule les
      //     extournes existants pour savoir si on touche le total (≥ 99,9%).
      const reversal = await this.createPartialClass8ReversalForInvoice(
        tx,
        po,
        invoice,
        actor,
        imputation,
      );

      this.logger.log(
        {
          invoiceId: invoice.id,
          acEntry: acEntryNumber,
          reversalEntry: reversal.entryNumber,
          exchangeRate,
          totalTtcXof: ttcXof,
        },
        'invoice posted (AC entry + class 8 partial reversal)',
      );

      // 12) Mise à jour de la facture (status, postedAt, exchangeRate, match_summary)
      const previousSummary = (invoice.matchSummary ?? {}) as Record<string, unknown>;
      const previousPostings = Array.isArray(previousSummary.commitmentReversedEntries)
        ? (previousSummary.commitmentReversedEntries as unknown[])
        : [];
      const newSummary = {
        ...previousSummary,
        posting: {
          postedAt: new Date().toISOString(),
          postedBy: actor.email,
          acEntryId: acEntry.id,
          acEntryNumber,
          reversalEntryId: reversal.id,
          reversalEntryNumber: reversal.entryNumber,
          exchangeRate,
          totalTtcXof: ttcXof,
        },
        commitmentReversedEntries: [
          ...previousPostings,
          {
            entryId: reversal.id,
            entryNumber: reversal.entryNumber,
            amountReversed: this.roundXof(Number(invoice.totalHt) * exchangeRate),
          },
        ],
      };

      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.posted,
          postedAt: new Date(),
          exchangeRate: invoice.currency === 'XOF' ? null : exchangeRate,
          matchSummary: newSummary as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        invoice: updated,
        acEntryId: acEntry.id,
        acEntryNumber,
        reversalEntryId: reversal.id,
        reversalEntryNumber: reversal.entryNumber,
        exchangeRate,
        totalTtcXof: ttcXof,
      };
    });
  }

  /**
   * Annule la comptabilisation d'une facture (status `posted` → `matched`).
   *
   * Crée :
   *  - 1 écriture AC symétrique (debit 401, crédit 6xx + 445) qui solde
   *    l'écriture d'origine,
   *  - 1 écriture OD qui re-crée l'engagement classe 8 extourné lors du post.
   *
   * Pré-conditions : facture en `posted`, aucun paiement, période ouverte,
   * motif obligatoire.
   *
   * Réservé DAF / SUPER_ADMIN (vérifié par le contrôleur).
   */
  async cancelPosting(
    invoiceId: string,
    actor: PostingActor,
    reason: string,
  ): Promise<CancelPostingResult> {
    if (!reason || reason.trim().length < 5) {
      throw new PostingCancelReasonRequiredException();
    }
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new EntityNotFoundException('Invoice', { id: invoiceId });
    if (invoice.status !== InvoiceStatus.posted) {
      throw new InvoiceNotPostableException(invoice.id, invoice.status);
    }
    // Statuts de paiement intermédiaires : on refuse l'annulation après paiement.
    const paidStatuses: InvoiceStatus[] = [
      InvoiceStatus.partially_paid,
      InvoiceStatus.paid,
      InvoiceStatus.archived,
    ];
    if (paidStatuses.includes(invoice.status)) {
      throw new PostingHasPaymentException(invoice.id, invoice.status);
    }

    const period = await this.findOpenPeriodForDate(new Date());

    const acEntry = await this.prisma.journalEntry.findFirst({
      where: {
        sourceType: SOURCE_TYPE_INVOICE,
        sourceId: invoice.id,
        journal: JournalType.AC,
        status: EntryStatus.posted,
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!acEntry) {
      throw new EntityNotFoundException('JournalEntry', {
        sourceType: SOURCE_TYPE_INVOICE,
        sourceId: invoice.id,
      });
    }

    const summary = (invoice.matchSummary ?? {}) as Record<string, unknown>;
    const commitmentEntries = Array.isArray(summary.commitmentReversedEntries)
      ? (summary.commitmentReversedEntries as Array<Record<string, unknown>>)
      : [];

    return this.prisma.$transaction(async (tx) => {
      // 1) Création de l'écriture AC inverse
      const acReverseNumber = await this.generateEntryNumber(tx, JournalType.AC);
      const acReverse = await tx.journalEntry.create({
        data: {
          entryNumber: acReverseNumber,
          journal: JournalType.AC,
          entryDate: new Date(),
          periodId: period.id,
          label: `Extourne ${acEntry.label} — ${reason.slice(0, 120)}`,
          sourceType: SOURCE_TYPE_INVOICE,
          sourceId: invoice.id,
          status: EntryStatus.draft,
        },
      });
      await tx.journalLine.createMany({
        data: acEntry.lines.map((l) => ({
          entryId: acReverse.id,
          lineNumber: l.lineNumber,
          accountCode: l.accountCode,
          auxiliaryCode: l.auxiliaryCode,
          label: `Extourne ${l.label ?? ''}`.trim().slice(0, 256),
          debit: Number(l.credit),
          credit: Number(l.debit),
          currency: l.currency,
          debitCurrency: l.creditCurrency ?? null,
          creditCurrency: l.debitCurrency ?? null,
          projectId: l.projectId,
          grantId: l.grantId,
          budgetLineId: l.budgetLineId,
          costCenterId: l.costCenterId,
          activityId: l.activityId,
        })),
      });
      await tx.journalEntry.update({
        where: { id: acReverse.id },
        data: { status: EntryStatus.posted, postedAt: new Date(), postedBy: actor.id },
      });
      // Marquer l'AC d'origine comme reversed
      await tx.journalEntry.update({
        where: { id: acEntry.id },
        data: { status: EntryStatus.reversed, reversedById: acReverse.id },
      });

      // 2) Re-création de l'engagement classe 8 (annule l'extournement précédent)
      let class8Recreated: { id: string; entryNumber: string } | null = null;
      for (const entry of commitmentEntries) {
        const prevId = entry.entryId as string | undefined;
        if (!prevId) continue;
        const prev = await tx.journalEntry.findUnique({
          where: { id: prevId },
          include: { lines: true },
        });
        if (!prev || prev.status === EntryStatus.reversed) continue;

        const recreateNumber = await this.generateEntryNumber(tx, JournalType.OD);
        const recreate = await tx.journalEntry.create({
          data: {
            entryNumber: recreateNumber,
            journal: JournalType.OD,
            entryDate: new Date(),
            periodId: period.id,
            label: `Re-engagement BC (annulation comptabilisation facture ${invoice.invoiceNumber})`,
            sourceType: SOURCE_TYPE_PO,
            sourceId: prev.sourceId,
            status: EntryStatus.draft,
          },
        });
        await tx.journalLine.createMany({
          data: prev.lines.map((l) => ({
            entryId: recreate.id,
            lineNumber: l.lineNumber,
            accountCode: l.accountCode,
            label: `Re-engagement ${l.label ?? ''}`.trim().slice(0, 256),
            debit: Number(l.credit),
            credit: Number(l.debit),
            currency: l.currency,
            projectId: l.projectId,
            grantId: l.grantId,
            budgetLineId: l.budgetLineId,
            costCenterId: l.costCenterId,
            activityId: l.activityId,
          })),
        });
        await tx.journalEntry.update({
          where: { id: recreate.id },
          data: { status: EntryStatus.posted, postedAt: new Date(), postedBy: actor.id },
        });
        // Marque l'extournement précédent comme reversed (annulé)
        await tx.journalEntry.update({
          where: { id: prev.id },
          data: { status: EntryStatus.reversed, reversedById: recreate.id },
        });
        class8Recreated = { id: recreate.id, entryNumber: recreateNumber };
      }

      // 3) Facture : status=matched, postedAt=null, summary trace
      const updatedSummary = {
        ...summary,
        postingCancelled: {
          cancelledAt: new Date().toISOString(),
          cancelledBy: actor.email,
          reason,
          acReverseEntryId: acReverse.id,
          acReverseEntryNumber: acReverseNumber,
          class8RecreatedEntryNumber: class8Recreated?.entryNumber ?? null,
        },
      };
      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.matched,
          postedAt: null,
          matchSummary: updatedSummary as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.warn(
        {
          invoiceId,
          acReverseNumber,
          class8RecreatedNumber: class8Recreated?.entryNumber,
          reason,
        },
        'POSTING_CANCELLED on invoice',
      );

      return {
        invoice: updated,
        acReverseEntryId: acReverse.id,
        acReverseEntryNumber: acReverseNumber,
        class8RecreatedEntryId: class8Recreated?.id ?? null,
        class8RecreatedEntryNumber: class8Recreated?.entryNumber ?? null,
      };
    });
  }

  // ------------------------------------------------------------------
  // Sprint 5.1 — postPayment (écriture BQ classe 5)
  // ------------------------------------------------------------------

  /**
   * Comptabilise un paiement émis : crée une écriture journal `BQ` (banque)
   * équilibrée.
   *
   * Mode mono-devise (invoice.currency === payment.currency) :
   *   D 401 (Fournisseurs, auxiliary_code=supplier.code)   payment.amount
   *   C bankAccount.glAccountCode (5xx)                    payment.amount
   *
   * Mode multi-devises (sprint 5.2 — invoice.currency ≠ payment.currency) :
   *   D 401 = originalAmount × invoice.exchangeRate   (XOF — solde le 401
   *           crédité au taux historique lors du postInvoice)
   *   C bank = payment.amount                          (XOF — cash réel sorti)
   *   Si écart (D 401 − C bank > 0) → gain → C 766 (Gains de change)
   *   Si écart < 0 → perte → D 666 (Pertes de change)
   *
   * Pré-conditions :
   *  - facture status ∈ posted / partially_paid
   *  - bankAccount.glAccountCode existe, classe 5, actif
   *  - période fiscale ouverte à payment.paymentDate
   *  - devise paiement = devise bankAccount
   *  - en multi-devises : taux historique de la facture présent
   *    (invoice.exchangeRate non null), sinon EXCHANGE_RATE_FOR_PAYMENT_MISSING
   *
   * Le service NE met PAS à jour la facture (status) — c'est le
   * `PaymentRunService.approve` qui orchestre `posted → partially_paid → paid`
   * en agrégeant les paiements executed.
   */
  async postPayment(
    actor: PostingActor,
    payment: Payment & { invoice: Invoice & { supplier: { code: string; name: string } } },
    bankAccount: BankAccount,
  ): Promise<PostPaymentResult> {
    // 1) Cohérence devise paiement = devise du compte bancaire
    //    (multidevises = invoice currency vs run currency, traité en aval)
    if (payment.currency !== bankAccount.currency) {
      throw new PaymentCurrencyMismatchException(
        payment.invoiceId,
        payment.currency,
        bankAccount.currency,
      );
    }

    // 2) Vérif classe 5 du compte GL (filet de sécurité)
    const gl = await this.prisma.glAccount.findUnique({
      where: { code: bankAccount.glAccountCode },
      select: { code: true, class: true },
    });
    if (!gl) {
      throw new EntityNotFoundException('GlAccount', { code: bankAccount.glAccountCode });
    }
    if (gl.class !== '5') {
      throw new BankAccountWrongClassException(bankAccount.id, gl.code, gl.class);
    }

    // 3) Période fiscale ouverte
    const period = await this.findOpenPeriodForDate(payment.paymentDate);

    const supplier = payment.invoice.supplier;
    const label =
      `Paiement ${supplier.code} - ${payment.invoice.invoiceNumber}`.slice(0, 256);
    const isMultiCurrency =
      payment.originalCurrency != null &&
      payment.originalCurrency !== payment.currency;

    // 4) Calcul des montants comptables — tout en XOF (devise des livres)
    //    Pour sprint 5.2, on suppose bank.currency = XOF (= devise des livres).
    //    Si bank en EUR/USD (cas EUR bailleur), pas d'écart FX généré ici
    //    (à revoir au sprint 6 avec une conversion bank→XOF systématique).
    const bankCreditXof = Number(payment.amount);
    let expectedDebit401Xof = bankCreditXof;
    let fxGainLoss = 0;

    if (isMultiCurrency) {
      // Taux historique de la facture (stocké lors du postInvoice sprint 4.2b)
      const invoiceRate = payment.invoice.exchangeRate != null
        ? Number(payment.invoice.exchangeRate)
        : null;
      if (invoiceRate == null) {
        throw new EntityNotFoundException('Invoice.exchangeRate', {
          invoiceId: payment.invoiceId,
          hint: 'Historical rate required for multi-currency payment posting',
        });
      }
      const originalAmount = payment.originalAmount != null
        ? Number(payment.originalAmount)
        : Number(payment.invoice.totalTtc);
      expectedDebit401Xof = this.roundXof(originalAmount * invoiceRate);
      fxGainLoss = this.roundXof(expectedDebit401Xof - bankCreditXof);

      // Sanity check : écart trop grand → probable erreur de taux saisi
      const threshold = (expectedDebit401Xof * FX_DIFF_SAFETY_THRESHOLD_PCT) / 100;
      if (Math.abs(fxGainLoss) > threshold) {
        throw new FxDiffTooLargeException(
          payment.invoiceId,
          fxGainLoss,
          FX_DIFF_SAFETY_THRESHOLD_PCT,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const entryNumber = await this.generateEntryNumber(tx, JournalType.BQ);

      const entry = await tx.journalEntry.create({
        data: {
          entryNumber,
          journal: JournalType.BQ,
          entryDate: payment.paymentDate,
          periodId: period.id,
          label,
          sourceType: SOURCE_TYPE_PAYMENT,
          sourceId: payment.id,
          status: EntryStatus.draft,
        },
      });

      const lines: Prisma.JournalLineCreateManyInput[] = [
        {
          entryId: entry.id,
          lineNumber: 1,
          accountCode: ACCOUNT_SUPPLIERS,
          auxiliaryCode: supplier.code,
          label: `Solde fournisseur ${supplier.code}`,
          debit: expectedDebit401Xof,
          credit: 0,
          currency: payment.invoice.currency,
        },
        {
          entryId: entry.id,
          lineNumber: 2,
          accountCode: bankAccount.glAccountCode,
          label: `Banque ${bankAccount.code} - ${payment.invoice.invoiceNumber}`,
          debit: 0,
          credit: bankCreditXof,
          currency: payment.currency,
        },
      ];

      if (fxGainLoss > 0) {
        // Gain : 401 > bank — on crédite 766
        lines.push({
          entryId: entry.id,
          lineNumber: 3,
          accountCode: ACCOUNT_FX_GAIN,
          label: `Gain de change ${payment.invoice.invoiceNumber}`,
          debit: 0,
          credit: fxGainLoss,
          currency: 'XOF',
        });
      } else if (fxGainLoss < 0) {
        // Perte : bank > 401 — on débite 666
        lines.push({
          entryId: entry.id,
          lineNumber: 3,
          accountCode: ACCOUNT_FX_LOSS,
          label: `Perte de change ${payment.invoice.invoiceNumber}`,
          debit: Math.abs(fxGainLoss),
          credit: 0,
          currency: 'XOF',
        });
      }

      await tx.journalLine.createMany({ data: lines });

      await tx.journalEntry.update({
        where: { id: entry.id },
        data: { status: EntryStatus.posted, postedAt: new Date(), postedBy: actor.id },
      });

      // Persiste l'écart sur le paiement (audit + reporting)
      if (isMultiCurrency) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { fxGainLoss },
        });
      }

      this.logger.log(
        {
          entryNumber,
          paymentId: payment.id,
          bankCreditXof,
          expectedDebit401Xof,
          fxGainLoss,
          isMultiCurrency,
          bankAccount: bankAccount.code,
        },
        'payment posted (BQ entry)',
      );

      return {
        entryId: entry.id,
        entryNumber,
        amountXof: bankCreditXof,
        fxGainLoss,
      };
    });
  }

  /**
   * Liste les écritures liées à un paiement (sourceType='payment'),
   * lignes incluses — utilisé par l'endpoint /payment-runs/:id/journal-entries.
   */
  async listEntriesForPayment(
    paymentId: string,
  ): Promise<Array<JournalEntry & { lines: JournalLine[] }>> {
    return this.prisma.journalEntry.findMany({
      where: { sourceType: SOURCE_TYPE_PAYMENT, sourceId: paymentId },
      orderBy: { createdAt: 'asc' },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Extournement partiel de l'engagement classe 8 lors d'une facturation.
   * Cumule les extournements précédents pour savoir si la fraction
   * facturée atteint le total (à 0,1% près) — dans ce cas, marque
   * l'engagement d'origine comme `reversed`.
   */
  private async createPartialClass8ReversalForInvoice(
    tx: Prisma.TransactionClient,
    po: PurchaseOrder,
    invoice: Invoice,
    actor: PostingActor,
    imputation: ImputationSnapshot,
  ): Promise<JournalEntry> {
    // 1) Engagement d'origine (status=posted, pas encore reversed)
    const original = await tx.journalEntry.findFirst({
      where: {
        sourceType: SOURCE_TYPE_PO,
        sourceId: po.id,
        journal: JournalType.OD,
        status: EntryStatus.posted,
        reversedById: null,
        // L'engagement initial : créé par createCommitmentEntry, son label
        // commence par "Engagement BC". Les écritures de re-engagement
        // (cancelPosting) ont un label différent.
        label: { startsWith: 'Engagement BC' },
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!original) {
      throw new EntityNotFoundException('CommitmentEntry', {
        poId: po.id,
        hint: 'No active class 8 engagement found for this PO',
      });
    }

    // 2) Cumul des extournements existants (pour fraction)
    const reversalsSoFar = await tx.journalEntry.findMany({
      where: {
        sourceType: SOURCE_TYPE_PO,
        sourceId: po.id,
        journal: JournalType.OD,
        status: EntryStatus.posted,
        label: { startsWith: 'Extourne engagement BC' },
      },
      include: { lines: true },
    });
    const totalReversedSoFar = reversalsSoFar.reduce((s, e) => {
      // Sur l'extournement, le crédit de 801 (= debit 801 d'origine extourné)
      const line801 = e.lines.find((l) => l.accountCode === ACCOUNT_ENGAGEMENT_DONNE);
      return s + (line801 ? Number(line801.credit) : 0);
    }, 0);

    const totalHt = Number(po.totalHt);
    const amountToReverse = Number(invoice.totalHt);
    const cumulativeFraction = totalHt > 0 ? (totalReversedSoFar + amountToReverse) / totalHt : 1;

    // 3) Création de l'extournement
    const entryNumber = await this.generateEntryNumber(tx, JournalType.OD);
    const reversal = await tx.journalEntry.create({
      data: {
        entryNumber,
        journal: JournalType.OD,
        entryDate: new Date(),
        periodId: original.periodId,
        label: `Extourne engagement BC ${po.poNumber} (facture ${invoice.invoiceNumber})`,
        sourceType: SOURCE_TYPE_PO,
        sourceId: po.id,
        status: EntryStatus.draft,
      },
    });
    await tx.journalLine.createMany({
      data: [
        {
          entryId: reversal.id,
          lineNumber: 1,
          accountCode: ACCOUNT_ENGAGEMENT_DONNE,
          label: `Extourne 801 ${po.poNumber}`,
          debit: 0,
          credit: amountToReverse,
          currency: po.currency,
          ...imputation,
        },
        {
          entryId: reversal.id,
          lineNumber: 2,
          accountCode: ACCOUNT_CONTRE_ENGAGEMENT,
          label: `Extourne 802 ${po.poNumber}`,
          debit: amountToReverse,
          credit: 0,
          currency: po.currency,
          ...imputation,
        },
      ],
    });
    await tx.journalEntry.update({
      where: { id: reversal.id },
      data: { status: EntryStatus.posted, postedAt: new Date(), postedBy: actor.id },
    });

    // 4) Si fraction ≥ 99,9% : on marque l'engagement d'origine comme reversed
    if (cumulativeFraction >= 0.999) {
      await tx.journalEntry.update({
        where: { id: original.id },
        data: { status: EntryStatus.reversed, reversedById: reversal.id },
      });
      this.logger.log(
        { poId: po.id, cumulativeFraction, total: totalHt, reversed: totalReversedSoFar + amountToReverse },
        'class 8 commitment fully reversed by invoice posting',
      );
    }

    return reversal;
  }

  /**
   * Résout le compte de charge 6xx pour chaque ligne de facture.
   * Priorité : invoice_line.glAccount > budget_line.default_account > 605.
   *
   * Toutes les lignes doivent résoudre un compte présent dans `ref.gl_account`,
   * sinon GL_ACCOUNT_NOT_FOUND avec le détail des lignes en défaut.
   */
  private async resolveExpenseAccounts(
    invoiceLines: InvoiceLineForPosting[],
    poLines: Array<{ id: string; budgetLineId: string }>,
  ): Promise<{ byLineId: Map<string, string> }> {
    const byPoLine = new Map(poLines.map((l) => [l.id, l.budgetLineId]));
    const candidates = new Set<string>();
    const wantedByLine = new Map<string, string>();
    const missing: Array<Record<string, unknown>> = [];

    // 1ʳᵉ passe : candidats explicites + budget_line
    const budgetLineIds = new Set<string>();
    for (const il of invoiceLines) {
      if (il.glAccount) {
        wantedByLine.set(il.id, il.glAccount);
        candidates.add(il.glAccount);
      } else if (il.poLineId) {
        const blId = byPoLine.get(il.poLineId);
        if (blId) budgetLineIds.add(blId);
      }
    }
    let budgetDefaults = new Map<string, string | null>();
    if (budgetLineIds.size > 0) {
      const bls = await this.prisma.budgetLine.findMany({
        where: { id: { in: Array.from(budgetLineIds) } },
        select: { id: true, defaultAccount: true },
      });
      budgetDefaults = new Map(bls.map((b) => [b.id, b.defaultAccount]));
    }
    for (const il of invoiceLines) {
      if (wantedByLine.has(il.id)) continue;
      if (il.poLineId) {
        const blId = byPoLine.get(il.poLineId);
        const acc = blId ? budgetDefaults.get(blId) ?? null : null;
        if (acc) {
          wantedByLine.set(il.id, acc);
          candidates.add(acc);
          continue;
        }
      }
      // Fallback
      wantedByLine.set(il.id, ACCOUNT_FALLBACK_EXPENSE);
      candidates.add(ACCOUNT_FALLBACK_EXPENSE);
    }

    // Vérifie que tous les candidats existent dans ref.gl_account
    const existing = await this.prisma.glAccount.findMany({
      where: { code: { in: Array.from(candidates) } },
      select: { code: true },
    });
    const existingSet = new Set(existing.map((e) => e.code));
    for (const il of invoiceLines) {
      const wanted = wantedByLine.get(il.id);
      if (!wanted || !existingSet.has(wanted)) {
        missing.push({
          invoiceLineId: il.id,
          lineNumber: il.lineNumber,
          description: il.description,
          attemptedAccount: wanted ?? null,
        });
      }
    }
    if (missing.length > 0) throw new GlAccountNotFoundException(missing);

    return { byLineId: wantedByLine };
  }

  /**
   * Cherche un taux de change dans `ref.exchange_rate` pour le couple
   * (from, to), à la date la plus récente ≤ targetDate. Lève
   * EXCHANGE_RATE_MISSING si aucun taux disponible.
   */
  private async lookupExchangeRate(from: string, to: string, targetDate: Date): Promise<number> {
    if (from === to) return 1;
    const rate = await this.prisma.exchangeRate.findFirst({
      where: { fromCurrency: from, toCurrency: to, rateDate: { lte: targetDate } },
      orderBy: { rateDate: 'desc' },
    });
    if (!rate) {
      throw new ExchangeRateMissingException(from, to, targetDate.toISOString().slice(0, 10));
    }
    return Number(rate.rate);
  }

  /** Arrondi monétaire XOF (2 décimales — la BCEAO arrondit au franc entier
   * en réalité, mais on garde 2 décimales pour les calculs intermédiaires
   * en cohérence avec les colonnes Decimal(18,2) de la BD). */
  private roundXof(value: number): number {
    return Math.round(value * 100) / 100;
  }

  /**
   * Cherche la période fiscale ouverte qui couvre la `date` donnée. On
   * privilégie le type "month" (granularité minimale du mécanisme de
   * fermeture mensuelle, cf. seed sprint 0). À défaut, "quarter" puis
   * "year". Si une période existe mais est fermée → PERIOD_CLOSED ;
   * si aucune ne couvre la date → NO_OPEN_FISCAL_PERIOD.
   */
  private async findOpenPeriodForDate(date: Date) {
    // 1) Toutes les périodes (ouvertes ou fermées) qui couvrent la date
    const allCovering = await this.prisma.fiscalPeriod.findMany({
      where: {
        startDate: { lte: date },
        endDate: { gte: date },
      },
    });
    if (allCovering.length === 0) {
      throw new NoOpenFiscalPeriodException(date.toISOString().slice(0, 10));
    }
    // 2) On ne garde que les ouvertes et on préfère month > quarter > year
    const open = allCovering.filter((p) => !p.isClosed);
    const preferred =
      open.find((p) => p.periodType === 'month') ??
      open.find((p) => p.periodType === 'quarter') ??
      open.find((p) => p.periodType === 'year');
    if (preferred) return preferred;

    // 3) Aucune ouverte → on remonte le code de la 1ʳᵉ période fermée
    //    (granularité fine en priorité) pour message utilisateur.
    const closest =
      allCovering.find((p) => p.periodType === 'month') ??
      allCovering.find((p) => p.periodType === 'quarter') ??
      allCovering[0];
    throw new PeriodClosedException(date.toISOString().slice(0, 10), closest.code);
  }

  /**
   * Imputation analytique : on remonte à la 1ʳᵉ PR liée pour récupérer
   * projectId / grantId / costCenterId / activityId, et à la 1ʳᵉ PR-line
   * pour récupérer budgetLineId. Suffisant pour le sprint 3 — quand on
   * voudra ventiler par ligne du PO, on créera plusieurs lignes 801/802
   * (1 paire par budget line). Hors scope ici.
   */
  private async resolveImputation(
    po: PurchaseOrder & { prLinks?: Array<{ prId: string }> },
  ): Promise<{
    projectId: string | null;
    grantId: string | null;
    budgetLineId: string | null;
    costCenterId: string | null;
    activityId: string | null;
  }> {
    const prId = po.prId ?? po.prLinks?.[0]?.prId ?? null;
    if (!prId) {
      // PO orphelin (pas de PR liée) : pas d'imputation. Cas pathologique
      // — le service createFromPr s'assure qu'il y a toujours ≥ 1 PR.
      return { projectId: null, grantId: null, budgetLineId: null, costCenterId: null, activityId: null };
    }
    const pr = await this.prisma.purchaseRequest.findUnique({
      where: { id: prId },
      select: {
        projectId: true,
        grantId: true,
        costCenterId: true,
        activityId: true,
        lines: { select: { budgetLineId: true }, take: 1 },
      },
    });
    return {
      projectId: pr?.projectId ?? null,
      grantId: pr?.grantId ?? null,
      budgetLineId: pr?.lines?.[0]?.budgetLineId ?? null,
      costCenterId: pr?.costCenterId ?? null,
      activityId: pr?.activityId ?? null,
    };
  }

  /**
   * Numéro de pièce comptable — `<JOURNAL>-YYYY-NNNN` séquentiel par
   * (journal, année). Verrou advisory pour éviter les collisions sous
   * concurrence (même approche que generatePrNumber dans
   * PurchaseRequestService).
   */
  private async generateEntryNumber(
    tx: Prisma.TransactionClient,
    journal: JournalType,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const lockKey = this.hashToBigInt(`je_${journal}_${year}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
    const count = await tx.journalEntry.count({
      where: { journal, entryNumber: { startsWith: `${journal}-${year}-` } },
    });
    return `${journal}-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private hashToBigInt(s: string): bigint {
    let h = 0n;
    for (let i = 0; i < s.length; i += 1) {
      h = (h * 31n + BigInt(s.charCodeAt(i))) & 0x7fffffffffffffffn;
    }
    return h;
  }
}
