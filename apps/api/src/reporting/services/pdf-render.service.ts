import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatMoneyFr2 } from '../../common/utils/fr-number-format';
import type { AggregationResult } from './report-aggregation.service';

export interface PdfRenderInput {
  reportNumber: string;
  donorName: string;
  templateName: string;
  grantReference: string;
  projectTitle: string;
  periodStart: Date;
  periodEnd: Date;
  currency: string;
  fxRateUsed: number;
  generatedAt: Date;
  generatedBy: string;
  notes?: string | null;
  aggregation: AggregationResult;
}

/**
 * Génère le PDF d'un rapport bailleur avec :
 *  - Entête IPD + numéro de référence
 *  - Métadonnées du rapport (grant, période, devise, taux)
 *  - Tableau récapitulatif par catégorie (budget / spent / variance)
 *  - Pied : signature DAF + total overhead + funds carried
 *
 * Le rendu est simple et lisible (pas de logo image pour rester pur
 * pdfkit sans dépendance fs). Le bailleur signe en bas du PDF.
 */
@Injectable()
export class PdfRenderService {
  private readonly logger = new Logger(PdfRenderService.name);

  async render(input: PdfRenderInput): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    this.renderHeader(doc, input);
    this.renderMetadata(doc, input);
    this.renderCategoriesTable(doc, input);
    this.renderTotals(doc, input);
    this.renderSignature(doc, input);

    doc.end();
    const buf = await done;
    this.logger.log(
      { reportNumber: input.reportNumber, size: buf.length },
      'donor report PDF rendered',
    );
    return buf;
  }

  private renderHeader(doc: PDFKit.PDFDocument, input: PdfRenderInput): void {
    doc
      .fontSize(16)
      .fillColor('#1a3556')
      .text('INSTITUT PASTEUR DE DAKAR', { align: 'left' });
    doc
      .fontSize(9)
      .fillColor('#555')
      .text('Direction Administrative & Financière', { align: 'left' });
    doc
      .fontSize(8)
      .text('36, avenue Pasteur — BP 220 Dakar — Sénégal', { align: 'left' });

    doc
      .fontSize(11)
      .fillColor('#000')
      .text(`Rapport financier — ${input.donorName}`, 350, 50, {
        align: 'right',
        width: 200,
      });
    doc
      .fontSize(9)
      .fillColor('#555')
      .text(`Réf : ${input.reportNumber}`, { align: 'right', width: 200 });
    doc
      .fontSize(8)
      .text(`Template : ${input.templateName}`, { align: 'right', width: 200 });

    doc.moveDown(2);
    doc
      .moveTo(48, doc.y)
      .lineTo(547, doc.y)
      .strokeColor('#1a3556')
      .lineWidth(0.8)
      .stroke();
    doc.moveDown(1);
  }

  private renderMetadata(doc: PDFKit.PDFDocument, input: PdfRenderInput): void {
    const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
    doc.fontSize(10).fillColor('#000');
    doc.text(`Convention : ${input.grantReference}`);
    doc.text(`Projet : ${input.projectTitle}`);
    doc.text(`Période : ${fmtDate(input.periodStart)} → ${fmtDate(input.periodEnd)}`);
    doc.text(
      `Devise rapport : ${input.currency}` +
        (input.fxRateUsed !== 1 ? `  (taux XOF→${input.currency} : ${input.fxRateUsed})` : ''),
    );
    doc.text(`Généré le : ${input.generatedAt.toISOString().slice(0, 19).replace('T', ' ')}`);
    doc.text(`Généré par : ${input.generatedBy}`);
    doc.moveDown(1);
  }

  private renderCategoriesTable(doc: PDFKit.PDFDocument, input: PdfRenderInput): void {
    const startY = doc.y;
    const cols = {
      cat: { x: 48, w: 250, label: 'Catégorie' },
      budget: { x: 298, w: 80, label: 'Budget' },
      spent: { x: 378, w: 80, label: 'Dépensé' },
      varPct: { x: 458, w: 80, label: 'Variance %' },
    };

    // Header row
    doc
      .fontSize(10)
      .fillColor('#fff')
      .rect(48, startY - 2, 500, 18)
      .fill('#1a3556');
    doc.fillColor('#fff');
    doc.text(cols.cat.label, cols.cat.x + 4, startY + 2);
    doc.text(cols.budget.label, cols.budget.x, startY + 2, {
      width: cols.budget.w - 4,
      align: 'right',
    });
    doc.text(cols.spent.label, cols.spent.x, startY + 2, {
      width: cols.spent.w - 4,
      align: 'right',
    });
    doc.text(cols.varPct.label, cols.varPct.x, startY + 2, {
      width: cols.varPct.w - 4,
      align: 'right',
    });
    doc.fillColor('#000');
    doc.moveDown(0.5);

    // Body
    doc.fontSize(9);
    for (const l of input.aggregation.lines) {
      const y = doc.y;
      const alertColor = l.alert ? '#c0392b' : '#000';
      doc.fillColor('#000').text(`${l.categoryCode} — ${l.categoryLabel}`, cols.cat.x + 4, y, {
        width: cols.cat.w - 4,
      });
      doc.text(this.fmtAmount(l.budgetAmount), cols.budget.x, y, {
        width: cols.budget.w - 4,
        align: 'right',
      });
      doc.text(this.fmtAmount(l.spentAmount), cols.spent.x, y, {
        width: cols.spent.w - 4,
        align: 'right',
      });
      doc.fillColor(alertColor).text(this.fmtPct(l.variancePct), cols.varPct.x, y, {
        width: cols.varPct.w - 4,
        align: 'right',
      });
      doc.fillColor('#000');
      doc.moveDown(0.3);
    }
    doc.moveDown(0.5);
  }

  private renderTotals(doc: PDFKit.PDFDocument, input: PdfRenderInput): void {
    const a = input.aggregation;
    doc
      .moveTo(48, doc.y)
      .lineTo(547, doc.y)
      .strokeColor('#888')
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#000');
    doc.text(`Total budget : ${this.fmtAmount(a.totalBudget)} ${input.currency}`);
    doc.text(
      `Total dépensé (charges directes + overhead) : ${this.fmtAmount(a.totalSpent)} ${input.currency}`,
    );
    doc.text(`  dont overhead : ${this.fmtAmount(a.totalOverhead)} ${input.currency}`);
    doc.text(`Funds carried over : ${this.fmtAmount(a.fundsCarried)} ${input.currency}`);
    if (input.notes) {
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#555').text(`Notes : ${input.notes}`);
    }
  }

  private renderSignature(doc: PDFKit.PDFDocument, input: PdfRenderInput): void {
    doc.moveDown(3);
    doc.fontSize(9).fillColor('#000');
    doc.text(
      `Fait à Dakar, le ${new Date().toISOString().slice(0, 10)} — Document généré électroniquement par GRANTFLOW IPD.`,
    );
    doc.moveDown(2);
    doc.text('Signature DAF : _______________________________', { align: 'left' });
    doc.text(`Réf : ${input.reportNumber}`, { align: 'right' });
  }

  private fmtAmount(v: number): string {
    // US-075 (F-S8-15) : séparateur en espace ASCII U+0020 (seul glyphe
    // d'espace rendu par Helvetica pdfkit) — cf. fr-number-format.ts.
    return formatMoneyFr2(v);
  }
  private fmtPct(v: number): string {
    const s = v >= 0 ? '+' : '';
    return `${s}${v.toFixed(2)}%`;
  }
}
