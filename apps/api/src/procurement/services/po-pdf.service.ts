import { Injectable } from '@nestjs/common';
import { formatMoneyFr, formatQuantityFr } from '../../common/utils/fr-number-format';
import PDFDocument from 'pdfkit';

export interface PoPdfLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

export interface PoPdfSupplier {
  name: string;
  code: string;
  address: string | null;
  country: string | null;
  contactEmail: string | null;
  paymentTermsDays: number;
}

export interface PoPdfPayload {
  poNumber: string;
  orderDate: Date;
  expectedDate: Date | null;
  currency: string;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  incoterm: string | null;
  deliveryAddress: string | null;
  prNumbers: string[];
  supplier: PoPdfSupplier;
  lines: PoPdfLine[];
  buyer: { fullName: string; email: string } | null;
  emittedAt: Date;
}

/**
 * Génère le PDF d'un Bon de Commande IPD.
 *
 * Pattern : on construit le PDF en mémoire (chunks → Buffer) pour rester
 * compatible avec l'upload MinIO direct sans temp file. Lib `pdfkit`
 * (zéro dépendance native, fonctionne sur Windows et Linux pareil).
 *
 * Le template est volontairement basique pour le sprint 3. Un sprint
 * Reporting (5+) pourra le remplacer par un template Handlebars + un
 * vrai logo IPD.
 */
@Injectable()
export class PoPdfService {
  /**
   * Génère le PDF et retourne le Buffer complet (prêt pour MinIO).
   */
  async generate(payload: PoPdfPayload): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.writeHeader(doc, payload);
        this.writeSupplierBlock(doc, payload);
        this.writeRefsBlock(doc, payload);
        this.writeLinesTable(doc, payload);
        this.writeTotals(doc, payload);
        this.writeTerms(doc, payload);
        this.writeFooter(doc, payload);

        doc.end();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  // ------------------------------------------------------------------
  // Sections
  // ------------------------------------------------------------------

  private writeHeader(doc: PDFKit.PDFDocument, payload: PoPdfPayload): void {
    doc
      .fontSize(8)
      .fillColor('#666')
      .text('[LOGO IPD]', 50, 50)
      .fillColor('#000')
      .fontSize(10)
      .text('INSTITUT PASTEUR DE DAKAR', 50, 65)
      .text('36, avenue Pasteur — BP 220 Dakar (Sénégal)', 50, 80)
      .text('Tel : +221 33 839 92 00 — direction-finance@pasteur.sn', 50, 95);

    doc
      .fontSize(18)
      .fillColor('#000')
      .text(`BON DE COMMANDE ${payload.poNumber}`, 50, 130, { align: 'center' });

    doc
      .fontSize(9)
      .fillColor('#555')
      .text(
        `Émis le ${this.formatDate(payload.emittedAt)} — Devise : ${payload.currency}`,
        50,
        160,
        { align: 'center' },
      );
    doc.moveTo(50, 180).lineTo(545, 180).strokeColor('#999').stroke();
    doc.fillColor('#000');
  }

  private writeSupplierBlock(doc: PDFKit.PDFDocument, payload: PoPdfPayload): void {
    const { supplier } = payload;
    const y = 195;
    doc
      .fontSize(10)
      .text('FOURNISSEUR', 50, y, { underline: true })
      .moveDown(0.3)
      .fontSize(9)
      .text(`${supplier.name} (${supplier.code})`)
      .text(supplier.address ?? '—')
      .text(supplier.country ?? '—');
    if (supplier.contactEmail) {
      doc.text(`Email : ${supplier.contactEmail}`);
    }
  }

  private writeRefsBlock(doc: PDFKit.PDFDocument, payload: PoPdfPayload): void {
    const y = 195;
    const x = 320;
    doc
      .fontSize(10)
      .text('RÉFÉRENCES', x, y, { underline: true })
      .moveDown(0.3)
      .fontSize(9)
      .text(`BC : ${payload.poNumber}`, x)
      .text(`Date de commande : ${this.formatDate(payload.orderDate)}`, x);
    if (payload.expectedDate) {
      doc.text(`Livraison attendue : ${this.formatDate(payload.expectedDate)}`, x);
    }
    if (payload.incoterm) {
      doc.text(`Incoterm : ${payload.incoterm}`, x);
    }
    doc.text(`DA liée(s) : ${payload.prNumbers.join(', ') || '—'}`, x);
    if (payload.deliveryAddress) {
      doc.moveDown(0.2).text(`Adresse de livraison : ${payload.deliveryAddress}`, x, undefined, {
        width: 220,
      });
    }
  }

  private writeLinesTable(doc: PDFKit.PDFDocument, payload: PoPdfPayload): void {
    const startY = 320;
    const colDesc = 50;
    const colQty = 320;
    const colUnit = 365;
    const colPu = 415;
    const colTot = 485;

    doc
      .fontSize(9)
      .fillColor('#000')
      .font('Helvetica-Bold')
      .text('Description', colDesc, startY)
      .text('Qté', colQty, startY)
      .text('Unité', colUnit, startY)
      .text('PU', colPu, startY)
      .text('Total', colTot, startY)
      .font('Helvetica');

    doc.moveTo(50, startY + 12).lineTo(545, startY + 12).strokeColor('#999').stroke();

    let y = startY + 18;
    for (const line of payload.lines) {
      doc
        .fontSize(9)
        .text(`${line.lineNumber}. ${line.description}`, colDesc, y, { width: 260 })
        .text(this.formatQuantity(line.quantity), colQty, y, { width: 40 })
        .text(line.unit, colUnit, y, { width: 45 })
        .text(this.formatMoney(line.unitPrice), colPu, y, { width: 65 })
        .text(this.formatMoney(line.lineTotal), colTot, y, { width: 60 });
      y += 18;
      if (y > 700) {
        doc.addPage();
        y = 80;
      }
    }
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#999').stroke();
  }

  private writeTotals(doc: PDFKit.PDFDocument, payload: PoPdfPayload): void {
    const x = 380;
    const y = doc.y + 10;
    doc
      .fontSize(9)
      .text(`Total HT : ${this.formatMoney(payload.totalHt)} ${payload.currency}`, x, y, {
        align: 'left',
      })
      .text(`TVA : ${this.formatMoney(payload.totalVat)} ${payload.currency}`, x, y + 14)
      .font('Helvetica-Bold')
      .text(`Total TTC : ${this.formatMoney(payload.totalTtc)} ${payload.currency}`, x, y + 28)
      .font('Helvetica');
  }

  private writeTerms(doc: PDFKit.PDFDocument, payload: PoPdfPayload): void {
    const y = doc.y + 30;
    doc
      .fontSize(8)
      .fillColor('#555')
      .text('CONDITIONS GÉNÉRALES', 50, y, { underline: true })
      .moveDown(0.2)
      .text(
        `Délai de paiement : ${payload.supplier.paymentTermsDays} jours à réception de la facture conforme.`,
        50,
      )
      .text(
        'Toute livraison doit être accompagnée d\'un bon de livraison référençant ce BC.',
        50,
      )
      .text(
        'En cas de litige, l\'IPD se réserve le droit de retourner la marchandise sans frais.',
        50,
      )
      .fillColor('#000');
  }

  private writeFooter(doc: PDFKit.PDFDocument, payload: PoPdfPayload): void {
    const y = 780;
    const buyer = payload.buyer ? payload.buyer.fullName : 'Service Achats IPD';
    doc
      .fontSize(8)
      .fillColor('#555')
      .text(
        `Émis par ${buyer} le ${this.formatDate(payload.emittedAt)} — GRANTFLOW IPD`,
        50,
        y,
        { align: 'center', width: 495 },
      );
  }

  // ------------------------------------------------------------------
  // Formatters
  // ------------------------------------------------------------------

  private formatDate(d: Date): string {
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getUTCFullYear()}`;
  }

  // fix/pdf-thousands-separator : séparateur normalisé en espace ASCII U+0020
  // (seul glyphe d'espace dans Helvetica pdfkit ; U+202F → « / », U+00A0 →
  // carré cassé). Cf. common/utils/fr-number-format.ts.
  private formatMoney(v: number): string {
    return formatMoneyFr(v);
  }

  private formatQuantity(v: number): string {
    return formatQuantityFr(v);
  }
}
