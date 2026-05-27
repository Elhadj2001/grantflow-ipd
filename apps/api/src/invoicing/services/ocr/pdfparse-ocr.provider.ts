import { Injectable, Logger } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import { OcrExtractionFailedException } from '../../../common/exceptions/business.exception';
import type {
  OcrFields,
  OcrProvider,
  OcrResult,
} from './ocr-provider.interface';

/**
 * Sprint F-OCR-VISION — Provider OCR `pdf-parse`.
 *
 * IMPLÉMENTATION HISTORIQUE (sprint 4.2a) : extraction de la COUCHE TEXTE
 * native du PDF + heuristiques regex. Fonctionne pour les factures émises
 * électroniquement (Sage, EBP, NetSuite, Odoo…). Ne sait PAS lire un PDF
 * image scannée : dans ce cas `isImageScan=true` et `confidence=0` —
 * la façade `OcrService` peut alors basculer sur un provider Vision
 * (sprint F-OCR-VISION, opt-in).
 *
 * Le code et la sémantique sont rigoureusement identiques à l'ancien
 * `OcrService` — il a juste été extrait dans un provider dédié pour
 * permettre le multi-provider. Les tests existants restent passants
 * (cf. pdfparse-ocr.provider.spec.ts).
 */
@Injectable()
export class PdfParseOcrProvider implements OcrProvider {
  readonly name = 'pdfparse';
  private readonly logger = new Logger(PdfParseOcrProvider.name);

  /** Confiance attribuée à un match de regex exact. */
  private readonly CONF_EXACT = 95;
  /** Confiance attribuée à un fallback heuristique partiel. */
  private readonly CONF_HEURISTIC = 70;

  async extractFromPdf(buffer: Buffer): Promise<OcrResult> {
    let rawText = '';
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      rawText = result.text ?? '';
      await parser.destroy();
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown';
      this.logger.warn({ reason }, 'pdf-parse failed');
      throw new OcrExtractionFailedException(reason);
    }

    // Texte vide → PDF probablement image scannée. On renvoie un résultat
    // "vide" propre plutôt que de planter — le comptable saisira manuellement.
    if (!rawText || rawText.trim().length < 20) {
      return {
        rawText,
        isImageScan: true,
        confidence: 0,
        fields: {},
        fieldConfidence: {},
      };
    }

    return this.parseText(rawText);
  }

  /**
   * Parsing texte → champs structurés. Exposé `public` pour pouvoir
   * tester sans avoir à fabriquer un PDF — c'est plus rapide et
   * couvre la même logique métier.
   */
  parseText(rawText: string): OcrResult {
    const fields: OcrFields = {};
    const fieldConfidence: Record<string, number> = {};

    // ---- 1) Numéro de facture ----
    const invNumber = this.extractInvoiceNumber(rawText);
    if (invNumber) {
      fields.invoiceNumber = invNumber.value;
      fieldConfidence.invoiceNumber = invNumber.confidence;
    }

    // ---- 2) Dates ----
    const invDate = this.extractInvoiceDate(rawText);
    if (invDate) {
      fields.invoiceDate = invDate.value;
      fieldConfidence.invoiceDate = invDate.confidence;
    }
    const dueDate = this.extractDueDate(rawText);
    if (dueDate) {
      fields.dueDate = dueDate.value;
      fieldConfidence.dueDate = dueDate.confidence;
    }

    // ---- 3) Montants ----
    const totals = this.extractTotals(rawText);
    if (totals.totalHt !== undefined) {
      fields.totalHt = totals.totalHt;
      fieldConfidence.totalHt = totals.confidenceHt;
    }
    if (totals.totalVat !== undefined) {
      fields.totalVat = totals.totalVat;
      fieldConfidence.totalVat = totals.confidenceVat;
    }
    if (totals.totalTtc !== undefined) {
      fields.totalTtc = totals.totalTtc;
      fieldConfidence.totalTtc = totals.confidenceTtc;
    }

    // ---- 4) Devise ----
    const currency = this.extractCurrency(rawText);
    if (currency) {
      fields.currency = currency.value;
      fieldConfidence.currency = currency.confidence;
    }

    // ---- 5) Référence BC ----
    const po = this.extractPoReference(rawText);
    if (po) {
      fields.poReference = po.value;
      fieldConfidence.poReference = po.confidence;
    }

    // ---- 6) Confiance globale ----
    const values = Object.values(fieldConfidence);
    const confidence = values.length === 0
      ? 0
      : Math.round(values.reduce((s, v) => s + v, 0) / values.length);

    return {
      rawText,
      isImageScan: false,
      confidence,
      fields,
      fieldConfidence,
    };
  }

  // ------------------------------------------------------------------
  // Heuristiques d'extraction (inchangées vs sprint 4.2a)
  // ------------------------------------------------------------------

  private extractInvoiceNumber(text: string): { value: string; confidence: number } | null {
    const explicit = text.match(
      /(?:facture|invoice|fact\.?|inv\.?)\s*(?:number|num[ée]ro|num\.?|n[°ºo]?|#)\s*:?\s*([A-Z0-9][A-Z0-9\-/]{2,32})/i,
    );
    if (explicit) return { value: explicit[1].trim().toUpperCase(), confidence: this.CONF_EXACT };

    const directPattern = text.match(/\b((?:FAC|INV|FACT|F)[-/]?\d{2,4}[-/]?\d{2,8})\b/);
    if (directPattern) return { value: directPattern[1].toUpperCase(), confidence: this.CONF_HEURISTIC };

    return null;
  }

  private extractInvoiceDate(text: string): { value: Date; confidence: number } | null {
    const labelled = text.match(
      /(?:date\s+facture|date\s+d['']\s*é?mission|invoice\s+date|emise?\s+le)\s*:?\s*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4}|[0-9]{4}[/-][0-9]{1,2}[/-][0-9]{1,2})/i,
    );
    if (labelled) {
      const d = this.parseDateString(labelled[1]);
      if (d) return { value: d, confidence: this.CONF_EXACT };
    }

    const anyDate = text.match(/\b([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4}|[0-9]{4}[/-][0-9]{1,2}[/-][0-9]{1,2})\b/);
    if (anyDate) {
      const d = this.parseDateString(anyDate[1]);
      if (d) return { value: d, confidence: this.CONF_HEURISTIC };
    }

    return null;
  }

  private extractDueDate(text: string): { value: Date; confidence: number } | null {
    const labelled = text.match(
      /(?:date\s+d['']\s*é?ché?ance|é?ché?ance|due\s+date|payable\s+le)\s*:?\s*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4}|[0-9]{4}[/-][0-9]{1,2}[/-][0-9]{1,2})/i,
    );
    if (labelled) {
      const d = this.parseDateString(labelled[1]);
      if (d) return { value: d, confidence: this.CONF_EXACT };
    }
    return null;
  }

  private parseDateString(s: string): Date | null {
    const m1 = s.match(/^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{2,4})$/);
    if (m1) {
      const [, dd, mm, yyRaw] = m1;
      const yy = yyRaw.length === 2 ? `20${yyRaw}` : yyRaw;
      const d = new Date(`${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const m2 = s.match(/^([0-9]{4})[/-]([0-9]{1,2})[/-]([0-9]{1,2})$/);
    if (m2) {
      const [, yy, mm, dd] = m2;
      const d = new Date(`${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00Z`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  private extractTotals(text: string): {
    totalHt?: number; confidenceHt: number;
    totalVat?: number; confidenceVat: number;
    totalTtc?: number; confidenceTtc: number;
  } {
    const out = { confidenceHt: 0, confidenceVat: 0, confidenceTtc: 0 } as ReturnType<typeof this.extractTotals>;

    const tttc = this.matchAmountLabelled(text, /(?:total\s+ttc|net\s+à\s+payer|montant\s+ttc|grand\s+total|amount\s+due)/i);
    if (tttc) { out.totalTtc = tttc.value; out.confidenceTtc = tttc.confidence; }

    const tht = this.matchAmountLabelled(text, /(?:total\s+ht|montant\s+ht|sous[-\s]?total|subtotal)/i);
    if (tht) { out.totalHt = tht.value; out.confidenceHt = tht.confidence; }

    const tva = this.matchAmountLabelled(text, /(?:total\s+tva|tva|vat|taxes?\b)/i);
    if (tva) { out.totalVat = tva.value; out.confidenceVat = tva.confidence; }

    if (out.totalTtc !== undefined && out.totalHt !== undefined && out.totalVat === undefined) {
      const vat = Math.round((out.totalTtc - out.totalHt) * 100) / 100;
      if (vat >= 0) {
        out.totalVat = vat;
        out.confidenceVat = this.CONF_HEURISTIC;
      }
    }
    return out;
  }

  private matchAmountLabelled(text: string, labelRe: RegExp): { value: number; confidence: number } | null {
    const labelMatch = text.match(labelRe);
    if (!labelMatch) return null;
    const startIdx = (labelMatch.index ?? 0) + labelMatch[0].length;
    const window = text.slice(startIdx, startIdx + 120);
    const amount = window.match(/([-+]?\s*[0-9][0-9\s.,]*)\s*(?:XOF|EUR|USD|CFA|F|€|\$)?/);
    if (!amount) return null;
    const num = this.parseNumber(amount[1]);
    if (num === null) return null;
    return { value: num, confidence: this.CONF_EXACT };
  }

  private parseNumber(s: string): number | null {
    const cleaned = s.replace(/\s/g, '').trim();
    if (cleaned === '' || !/[0-9]/.test(cleaned)) return null;

    const hasComma = cleaned.includes(',');
    const hasDot = cleaned.includes('.');
    let normalized: string;

    if (hasComma && hasDot) {
      const lastComma = cleaned.lastIndexOf(',');
      const lastDot = cleaned.lastIndexOf('.');
      if (lastComma > lastDot) {
        normalized = cleaned.replace(/\./g, '').replace(',', '.');
      } else {
        normalized = cleaned.replace(/,/g, '');
      }
    } else if (hasComma) {
      const parts = cleaned.split(',');
      if (parts.length === 2 && parts[1].length <= 2) {
        normalized = `${parts[0]}.${parts[1]}`;
      } else {
        normalized = cleaned.replace(/,/g, '');
      }
    } else {
      normalized = cleaned;
    }

    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  private extractCurrency(text: string): { value: string; confidence: number } | null {
    const iso = text.match(/\b(XOF|EUR|USD|CFA|GBP|CHF|CAD)\b/i);
    if (iso) {
      const v = iso[1].toUpperCase() === 'CFA' ? 'XOF' : iso[1].toUpperCase();
      return { value: v, confidence: this.CONF_EXACT };
    }
    if (text.includes('€')) return { value: 'EUR', confidence: this.CONF_HEURISTIC };
    if (text.includes('$')) return { value: 'USD', confidence: this.CONF_HEURISTIC };
    return null;
  }

  private extractPoReference(text: string): { value: string; confidence: number } | null {
    const m = text.match(/\b((?:BC|PO|BON\s+DE\s+COMMANDE)[-\s]?\d{2,4}[-\s]?\d{1,8})\b/i);
    if (!m) return null;
    return { value: m[1].trim().toUpperCase(), confidence: this.CONF_EXACT };
  }
}
