import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, GrStatus, InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EntityNotFoundException,
  InvoiceNoPoLinkedException,
  MatchingEmptyInvoiceException,
  MatchingNoReceiptException,
} from '../../common/exceptions/business.exception';

/**
 * Résultat unitaire de matching pour une ligne de facture.
 *
 * Valeurs possibles de `result` :
 *  - OK : prix + qty dans la tolérance, GR cumul ≥ qty facturée
 *  - EXCEPTION_PRICE : écart prix > tolérance
 *  - EXCEPTION_QTY : écart qty > tolérance OU sous-réception
 *  - UNMATCHED_INVOICE_LINE : aucune po_line correspondante
 */
export type MatchResult = 'OK' | 'EXCEPTION_PRICE' | 'EXCEPTION_QTY' | 'UNMATCHED_INVOICE_LINE';

export interface InvoiceLineMatchDetail {
  invoiceLineId: string;
  invoiceLineNumber: number;
  poLineId: string | null;
  qtyInvoiced: number;
  qtyReceived: number;
  qtyOrdered: number;
  priceInvoiced: number;
  priceOrdered: number;
  priceVariancePct: number;
  qtyVariancePct: number;
  result: MatchResult;
  message?: string;
}

export interface MatchSummary {
  totalLinesMatched: number;
  totalLinesException: number;
  priceVarianceMax: number;
  qtyVarianceMax: number;
  priceTolerancePct: number;
  qtyTolerancePct: number;
  details: InvoiceLineMatchDetail[];
}

export interface MatchOutcome {
  invoiceId: string;
  newStatus: InvoiceStatus;
  summary: MatchSummary;
}

/**
 * Service de rapprochement 3-way (Facture ↔ BC ↔ Réception).
 *
 * Tolérances paramétrables via env :
 *  - `INVOICE_MATCH_PRICE_TOLERANCE_PCT` (défaut 2.0)
 *  - `INVOICE_MATCH_QTY_TOLERANCE_PCT`   (défaut 5.0)
 *
 * Le service est appelé par `InvoiceService.submitForMatching` puis aussi
 * indirectement par `forceMatch` (qui contourne la validation mais
 * conserve la trace dans `match_summary`).
 *
 * **Pas de comptabilisation ici** — au passage `matched`, on stocke
 * juste l'état. La comptabilisation classes 4/6 + extournement classe 8
 * arrivera au sprint 4.2b.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get priceTolerance(): number {
    return Number(this.config.get('INVOICE_MATCH_PRICE_TOLERANCE_PCT', '2.0'));
  }

  private get qtyTolerance(): number {
    return Number(this.config.get('INVOICE_MATCH_QTY_TOLERANCE_PCT', '5.0'));
  }

  /**
   * Lance le matching sur une facture donnée. Crée/écrase les lignes
   * `ap.invoice_match` correspondantes et calcule le statut global.
   *
   * Retourne le `MatchOutcome` — l'appelant (InvoiceService) se charge
   * de persister sur `invoice.status`, `matched_at`, `match_summary`.
   */
  async matchInvoice(invoiceId: string): Promise<MatchOutcome> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
      },
    });
    if (!invoice) throw new EntityNotFoundException('Invoice', { id: invoiceId });
    if (!invoice.poId) throw new InvoiceNoPoLinkedException(invoice.id);
    // US-078 (F-S8-02) : une facture SANS ligne rendait un verdict « matched »
    // PAR VACUITÉ (agrégation some() sur details=[]). Jamais de rapprochement
    // sans matière à comparer.
    if (invoice.lines.length === 0) {
      throw new MatchingEmptyInvoiceException(invoice.id, 'no_lines');
    }

    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: invoice.poId },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
      },
    });
    if (!po) throw new EntityNotFoundException('PurchaseOrder', { id: invoice.poId });

    // Cumul des quantités reçues par po_line (uniquement GR complete)
    const grAgg = await this.prisma.goodsReceiptLine.groupBy({
      by: ['poLineId'],
      where: {
        poLineId: { in: po.lines.map((l) => l.id) },
        gr: { status: GrStatus.complete },
      },
      _sum: { quantity: true },
    });
    // Cumuls reçus en Decimal (F10) — _sum.quantity est un Decimal.
    const receivedByPoLine = new Map<string, Prisma.Decimal>(
      grAgg.map((r) => [r.poLineId, new Prisma.Decimal(r._sum.quantity ?? 0)]),
    );

    const totalReceived = Array.from(receivedByPoLine.values()).reduce(
      (s, v) => s.plus(v),
      new Prisma.Decimal(0),
    );
    if (totalReceived.isZero()) {
      throw new MatchingNoReceiptException(invoice.id, invoice.poId);
    }

    const poLineMap = new Map(po.lines.map((l) => [l.id, l]));
    const details: InvoiceLineMatchDetail[] = [];

    // Reset les matches précédents (re-run idempotent)
    const existingMatchIds = await this.prisma.invoiceMatch.findMany({
      where: { invoiceLine: { invoiceId } },
      select: { id: true },
    });
    if (existingMatchIds.length > 0) {
      await this.prisma.invoiceMatch.deleteMany({
        where: { id: { in: existingMatchIds.map((m) => m.id) } },
      });
    }

    for (const il of invoice.lines) {
      // Essai 1 : po_line_id explicite
      let poLine = il.poLineId ? poLineMap.get(il.poLineId) : null;
      // Essai 2 : fuzzy match sur description
      if (!poLine) {
        poLine = this.findBestPoLineMatch(il.description, Array.from(poLineMap.values()));
      }

      if (!poLine) {
        details.push({
          invoiceLineId: il.id,
          invoiceLineNumber: il.lineNumber,
          poLineId: null,
          qtyInvoiced: Number(il.quantity ?? 0),
          qtyReceived: 0,
          qtyOrdered: 0,
          priceInvoiced: Number(il.unitPrice ?? 0),
          priceOrdered: 0,
          priceVariancePct: 0,
          qtyVariancePct: 0,
          result: 'UNMATCHED_INVOICE_LINE',
          message: 'No matching PO line found',
        });
        continue;
      }

      // Valeurs brutes en Decimal (F10) — écarts/comparaisons exacts pour le
      // matching 3-voies. Les champs `number` du détail/persistance sont
      // dérivés via .toNumber() / Decimal à la frontière uniquement.
      const qtyInvoicedD = new Prisma.Decimal(il.quantity ?? 0);
      const qtyOrderedD = new Prisma.Decimal(poLine.quantity);
      const qtyReceivedD = receivedByPoLine.get(poLine.id) ?? new Prisma.Decimal(0);
      const priceInvoicedD = new Prisma.Decimal(il.unitPrice ?? 0);
      const priceOrderedD = new Prisma.Decimal(poLine.unitPrice);

      const qtyInvoiced = qtyInvoicedD.toNumber();
      const qtyOrdered = qtyOrderedD.toNumber();
      const qtyReceived = qtyReceivedD.toNumber();
      const priceInvoiced = priceInvoicedD.toNumber();
      const priceOrdered = priceOrderedD.toNumber();

      // Écart prix en % : |priceInvoiced - priceOrdered| / priceOrdered * 100
      const priceVariancePctD = priceOrderedD.greaterThan(0)
        ? priceInvoicedD.minus(priceOrderedD).abs().div(priceOrderedD).times(100)
        : priceInvoicedD.greaterThan(0)
          ? new Prisma.Decimal(100)
          : new Prisma.Decimal(0);
      // Écart qty en % : |qtyInvoiced - qtyReceived| / qtyReceived * 100
      const qtyVariancePctD = qtyReceivedD.greaterThan(0)
        ? qtyInvoicedD.minus(qtyReceivedD).abs().div(qtyReceivedD).times(100)
        : qtyInvoicedD.greaterThan(0)
          ? new Prisma.Decimal(100)
          : new Prisma.Decimal(0);

      let result: MatchResult = 'OK';
      let message: string | undefined;
      // Priorité prix > qty (cf. spec sprint 4.2a). Comparaisons en Decimal.
      if (priceVariancePctD.greaterThan(this.priceTolerance)) {
        result = 'EXCEPTION_PRICE';
        message = `Price variance ${priceVariancePctD.toFixed(2)}% > tolerance ${this.priceTolerance}%`;
      } else if (qtyInvoicedD.greaterThan(qtyReceivedD)) {
        result = 'EXCEPTION_QTY';
        message = `Under-reception: invoiced ${qtyInvoiced} > received ${qtyReceived}`;
      } else if (qtyVariancePctD.greaterThan(this.qtyTolerance)) {
        result = 'EXCEPTION_QTY';
        message = `Qty variance ${qtyVariancePctD.toFixed(2)}% > tolerance ${this.qtyTolerance}%`;
      }

      details.push({
        invoiceLineId: il.id,
        invoiceLineNumber: il.lineNumber,
        poLineId: poLine.id,
        qtyInvoiced,
        qtyReceived,
        qtyOrdered,
        priceInvoiced,
        priceOrdered,
        priceVariancePct: priceVariancePctD.toDecimalPlaces(2).toNumber(),
        qtyVariancePct: qtyVariancePctD.toDecimalPlaces(2).toNumber(),
        result,
        ...(message !== undefined ? { message } : {}),
      });

      // Persiste la ligne de matching — écarts exacts en Decimal.
      await this.prisma.invoiceMatch.create({
        data: {
          invoiceLineId: il.id,
          poLineId: poLine.id,
          qtyMatched: qtyInvoicedD,
          priceVariance: priceInvoicedD.minus(priceOrderedD).toDecimalPlaces(2),
          qtyVariance: qtyInvoicedD.minus(qtyReceivedD),
          matchResult: result,
        },
      });
    }

    // Statut global
    const hasPrice = details.some((d) => d.result === 'EXCEPTION_PRICE');
    const hasQty = details.some((d) => d.result === 'EXCEPTION_QTY' || d.result === 'UNMATCHED_INVOICE_LINE');
    const newStatus: InvoiceStatus = hasPrice
      ? InvoiceStatus.exception_price
      : hasQty
        ? InvoiceStatus.exception_qty
        : InvoiceStatus.matched;

    const summary: MatchSummary = {
      totalLinesMatched: details.filter((d) => d.result === 'OK').length,
      totalLinesException: details.filter((d) => d.result !== 'OK').length,
      priceVarianceMax: details.reduce((m, d) => Math.max(m, d.priceVariancePct), 0),
      qtyVarianceMax: details.reduce((m, d) => Math.max(m, d.qtyVariancePct), 0),
      priceTolerancePct: this.priceTolerance,
      qtyTolerancePct: this.qtyTolerance,
      details,
    };

    this.logger.log(
      {
        invoiceId,
        newStatus,
        ok: summary.totalLinesMatched,
        exceptions: summary.totalLinesException,
      },
      '3-way matching completed',
    );

    return { invoiceId, newStatus, summary };
  }

  /**
   * Fuzzy match d'une ligne facture sur les lignes du PO.
   * Heuristique simple : score = nb de mots ≥ 3 caractères en commun
   * (insensible à la casse). Retourne `null` si meilleur score == 0.
   *
   * Suffisant pour le sprint — sinon il faudra du Levenshtein ou un
   * embedding sémantique.
   */
  private findBestPoLineMatch<T extends { description: string }>(
    description: string,
    poLines: T[],
  ): T | null {
    if (poLines.length === 0) return null;
    const tokens = (s: string): Set<string> =>
      new Set(
        s
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .split(/\s+/)
          .filter((t) => t.length >= 3),
      );

    const invTokens = tokens(description);
    let best: { line: T; score: number } | null = null;
    for (const pl of poLines) {
      const plTokens = tokens(pl.description);
      let score = 0;
      for (const t of invTokens) if (plTokens.has(t)) score += 1;
      if (best === null || score > best.score) best = { line: pl, score };
    }
    return best && best.score > 0 ? best.line : null;
  }
}
