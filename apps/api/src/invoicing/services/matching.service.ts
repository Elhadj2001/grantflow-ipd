import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, GrStatus, InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EntityNotFoundException,
  InvoiceNoPoLinkedException,
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
    const receivedByPoLine = new Map<string, number>(
      grAgg.map((r) => [r.poLineId, Number(r._sum.quantity ?? 0)]),
    );

    const totalReceived = Array.from(receivedByPoLine.values()).reduce((s, v) => s + v, 0);
    if (totalReceived === 0) {
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

      const qtyInvoiced = Number(il.quantity ?? 0);
      const qtyOrdered = Number(poLine.quantity);
      const qtyReceived = receivedByPoLine.get(poLine.id) ?? 0;
      const priceInvoiced = Number(il.unitPrice ?? 0);
      const priceOrdered = Number(poLine.unitPrice);

      const priceVariancePct =
        priceOrdered > 0
          ? Math.abs(priceInvoiced - priceOrdered) / priceOrdered * 100
          : priceInvoiced > 0 ? 100 : 0;
      const qtyVariancePct =
        qtyReceived > 0
          ? Math.abs(qtyInvoiced - qtyReceived) / qtyReceived * 100
          : qtyInvoiced > 0 ? 100 : 0;

      let result: MatchResult = 'OK';
      let message: string | undefined;
      // Priorité prix > qty (cf. spec sprint 4.2a)
      if (priceVariancePct > this.priceTolerance) {
        result = 'EXCEPTION_PRICE';
        message = `Price variance ${priceVariancePct.toFixed(2)}% > tolerance ${this.priceTolerance}%`;
      } else if (qtyInvoiced > qtyReceived + 1e-9) {
        result = 'EXCEPTION_QTY';
        message = `Under-reception: invoiced ${qtyInvoiced} > received ${qtyReceived}`;
      } else if (qtyVariancePct > this.qtyTolerance) {
        result = 'EXCEPTION_QTY';
        message = `Qty variance ${qtyVariancePct.toFixed(2)}% > tolerance ${this.qtyTolerance}%`;
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
        priceVariancePct: Math.round(priceVariancePct * 100) / 100,
        qtyVariancePct: Math.round(qtyVariancePct * 100) / 100,
        result,
        ...(message !== undefined ? { message } : {}),
      });

      // Persiste la ligne de matching
      await this.prisma.invoiceMatch.create({
        data: {
          invoiceLineId: il.id,
          poLineId: poLine.id,
          qtyMatched: new Prisma.Decimal(qtyInvoiced),
          priceVariance: new Prisma.Decimal(Math.round((priceInvoiced - priceOrdered) * 100) / 100),
          qtyVariance: new Prisma.Decimal(qtyInvoiced - qtyReceived),
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
