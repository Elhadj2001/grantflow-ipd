import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import type { StatementResult } from './financial-statement-generator.service';

export interface StatementRenderInput {
  statement: StatementResult;
  periodCode: string;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  generatedBy: string;
}

/**
 * Renderer PDF + Excel pour les états financiers SYSCEBNL. Format
 * volontairement homogène : entête IPD, métadonnées période, tableau
 * 2 colonnes (sections gauche/droite), totaux + statut équilibre.
 *
 * Le PDF est en A4 portrait pour les sections simples (RESULTAT) et
 * A4 paysage pour le TER / BILAN (2 colonnes côte à côte).
 *
 * Le Excel produit 2 onglets :
 *   - Summary  : entête + totaux + statut équilibre
 *   - Detail   : 1 ligne par poste (section, label, débit, crédit, balance)
 */
@Injectable()
export class StatementRenderService {
  private readonly logger = new Logger(StatementRenderService.name);

  async renderPdf(input: StatementRenderInput): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    this.renderHeader(doc, input);
    this.renderTwoColumns(doc, input);
    this.renderTotals(doc, input);

    doc.end();
    const buf = await done;
    this.logger.log(
      { type: input.statement.type, periodCode: input.periodCode, size: buf.length },
      'financial statement PDF rendered',
    );
    return buf;
  }

  renderExcel(input: StatementRenderInput): Buffer {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, this.buildSummarySheet(input), 'Summary');
    XLSX.utils.book_append_sheet(wb, this.buildDetailSheet(input), 'Detail');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  // ------------------------------------------------------------------ PDF

  private renderHeader(doc: PDFKit.PDFDocument, input: StatementRenderInput): void {
    const titles: Record<string, string> = {
      TER: "TABLEAU DES EMPLOIS ET RESSOURCES (TER)",
      BILAN: 'BILAN SYSCEBNL — Actif / Passif',
      RESULTAT: 'COMPTE DE RÉSULTAT — Charges / Produits',
      // Sprint F5b-a Lot 4
      FONDS_DEDIES: 'SUIVI DES FONDS DÉDIÉS PAR CONVENTION',
    };
    doc
      .fontSize(14)
      .fillColor('#1a3556')
      .text('INSTITUT PASTEUR DE DAKAR', { align: 'left' });
    doc
      .fontSize(9)
      .fillColor('#555')
      .text('Direction Administrative & Financière — Référentiel SYSCEBNL', { align: 'left' });
    doc.moveDown(0.3);
    doc
      .fontSize(12)
      .fillColor('#000')
      .text(titles[input.statement.type] ?? input.statement.type, { align: 'center' });
    doc
      .fontSize(9)
      .fillColor('#555')
      .text(
        `Période : ${input.periodCode} (${this.fmtDate(input.periodStart)} → ${this.fmtDate(
          input.periodEnd,
        )})  — Généré le ${this.fmtDate(input.generatedAt)} par ${input.generatedBy}`,
        { align: 'center' },
      );
    doc.moveDown(0.5);
    doc.moveTo(36, doc.y).lineTo(806, doc.y).strokeColor('#1a3556').lineWidth(0.8).stroke();
    doc.moveDown(0.5);
  }

  private renderTwoColumns(doc: PDFKit.PDFDocument, input: StatementRenderInput): void {
    const sections = this.splitSections(input.statement);
    const startY = doc.y;
    const colWidth = 370;
    const leftX = 36;
    const rightX = 436;

    // En-têtes
    doc.fontSize(10).fillColor('#fff');
    doc.rect(leftX, startY - 2, colWidth, 18).fill('#1a3556');
    doc.rect(rightX, startY - 2, colWidth, 18).fill('#1a3556');
    doc.fillColor('#fff');
    doc.text(sections.leftSection, leftX + 6, startY + 2);
    doc.text(sections.rightSection, rightX + 6, startY + 2);
    doc.fillColor('#000');
    doc.moveDown(0.8);

    const rowsLeft = sections.left;
    const rowsRight = sections.right;
    const maxRows = Math.max(rowsLeft.length, rowsRight.length);
    const lineHeight = 14;

    doc.fontSize(8);
    for (let i = 0; i < maxRows; i++) {
      const y = doc.y;
      if (rowsLeft[i]) {
        doc.text(rowsLeft[i].label, leftX + 6, y, { width: colWidth - 80 });
        doc.text(
          this.fmtAmount(rowsLeft[i].balance),
          leftX + colWidth - 70,
          y,
          { width: 60, align: 'right' },
        );
      }
      if (rowsRight[i]) {
        doc.text(rowsRight[i].label, rightX + 6, y, { width: colWidth - 80 });
        doc.text(
          this.fmtAmount(rowsRight[i].balance),
          rightX + colWidth - 70,
          y,
          { width: 60, align: 'right' },
        );
      }
      doc.y = y + lineHeight;
    }
  }

  private renderTotals(doc: PDFKit.PDFDocument, input: StatementRenderInput): void {
    doc.moveDown(1);
    doc.moveTo(36, doc.y).lineTo(806, doc.y).strokeColor('#888').lineWidth(0.5).stroke();
    doc.moveDown(0.3);
    const t = input.statement.totals;
    doc.fontSize(10).fillColor('#000');
    doc.text(
      `TOTAL gauche : ${this.fmtAmount(Number(t.leftTotal))}   |   TOTAL droite : ${this.fmtAmount(
        Number(t.rightTotal),
      )}   |   Équilibre : ${t.balanced ? 'OK' : 'ROMPU (écart ' + this.fmtAmount(Number(t.leftTotal) - Number(t.rightTotal)) + ')'}`,
      { align: 'center' },
    );
    if (input.statement.type === 'BILAN' && t.resultatNet !== undefined) {
      doc.text(`Résultat net de l'exercice : ${this.fmtAmount(Number(t.resultatNet))} XOF`, {
        align: 'center',
      });
    }
    if (input.statement.type === 'RESULTAT' && t.resultatNet !== undefined) {
      doc.text(`Résultat net = produits - charges : ${this.fmtAmount(Number(t.resultatNet))} XOF`, {
        align: 'center',
      });
    }
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#555');
    doc.text('Signature DAF : _______________________________', { align: 'left' });
  }

  // ------------------------------------------------------------------ Excel

  private buildSummarySheet(input: StatementRenderInput): XLSX.WorkSheet {
    const t = input.statement.totals;
    const rows: Array<[string, string | number]> = [
      ['Type', input.statement.type],
      ['Période', input.periodCode],
      ['Période début', this.fmtDate(input.periodStart)],
      ['Période fin', this.fmtDate(input.periodEnd)],
      ['Généré le', this.fmtDate(input.generatedAt)],
      ['Généré par', input.generatedBy],
      ['', ''],
      ['Total gauche', Number(t.leftTotal)],
      ['Total droite', Number(t.rightTotal)],
      ['Équilibré ?', t.balanced ? 'OUI' : 'NON'],
    ];
    if (t.resultatNet !== undefined) rows.push(['Résultat net', Number(t.resultatNet)]);
    return XLSX.utils.aoa_to_sheet(rows);
  }

  private buildDetailSheet(input: StatementRenderInput): XLSX.WorkSheet {
    const header = ['Section', 'Code', 'Label', 'Débit', 'Crédit', 'Balance'];
    const rows: Array<Array<string | number | null>> = [header];
    for (const l of input.statement.lines) {
      rows.push([
        l.section,
        l.accountCode ?? '',
        l.label,
        l.debit,
        l.credit,
        l.balance,
      ]);
    }
    return XLSX.utils.aoa_to_sheet(rows);
  }

  // ------------------------------------------------------------------

  private splitSections(s: StatementResult): {
    leftSection: string;
    rightSection: string;
    left: typeof s.lines;
    right: typeof s.lines;
  } {
    if (s.type === 'TER') {
      return {
        leftSection: 'EMPLOIS',
        rightSection: 'RESSOURCES',
        left: s.lines.filter((l) => l.section === 'EMPLOIS'),
        right: s.lines.filter((l) => l.section === 'RESSOURCES'),
      };
    }
    if (s.type === 'BILAN') {
      return {
        leftSection: 'ACTIF',
        rightSection: 'PASSIF',
        left: s.lines.filter((l) => l.section === 'ACTIF'),
        right: s.lines.filter((l) => l.section === 'PASSIF'),
      };
    }
    return {
      leftSection: 'CHARGES',
      rightSection: 'PRODUITS',
      left: s.lines.filter((l) => l.section === 'CHARGES'),
      right: s.lines.filter((l) => l.section === 'PRODUITS'),
    };
  }

  private fmtDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
  private fmtAmount(v: number): string {
    return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
