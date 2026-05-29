import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

/**
 * Sprint F-INVOICE-SIM — Générateur de PDF de FACTURE FOURNISSEUR (mode démo).
 *
 * ⚠️ Ce service produit une facture *simulée* à partir d'un Bon de Commande
 * `sent`, uniquement pour les environnements de démonstration (pas de vrai
 * fournisseur sous la main). Le PDF imite une facture émise PAR le
 * fournisseur VERS l'IPD : en-tête fournisseur, n° de facture, référence au
 * BC, TVA 18 %. Il est ensuite soit téléchargé (mode A → re-upload via le
 * flux OCR normal), soit injecté directement en statut `captured` (mode B).
 *
 * Pattern identique à PoPdfService (pdfkit, buffer en mémoire) pour la
 * cohérence visuelle et la maintenance.
 */

export interface SupplierInvoicePdfLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

export interface SupplierInvoicePdfSupplier {
  name: string;
  /** NINEA / numéro d'identification fiscale (col. vat_number côté DB). */
  vatNumber: string | null;
  address: string | null;
  country: string | null;
}

export interface SupplierInvoiceData {
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  /** Référence du BC pré-remplie (effet : matching 3-way garanti). */
  poNumber: string;
  currency: string;
  supplier: SupplierInvoicePdfSupplier;
  lines: SupplierInvoicePdfLine[];
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  /** Taux de TVA appliqué (ex. 0.18 = 18 %). */
  vatRate: number;
  paymentTermsDays: number;
}

@Injectable()
export class SupplierInvoicePdfService {
  /** Génère le PDF de la facture simulée et retourne le Buffer complet. */
  async generate(data: SupplierInvoiceData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.writeDemoBanner(doc);
        this.writeSupplierHeader(doc, data);
        this.writeClientBlock(doc);
        this.writeInvoiceMeta(doc, data);
        this.writeLinesTable(doc, data);
        this.writeTotals(doc, data);
        this.writeFooter(doc, data);

        doc.end();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  // ------------------------------------------------------------------
  // Sections
  // ------------------------------------------------------------------

  /** Bandeau "facture simulée" — honnêteté visuelle (mode démo). */
  private writeDemoBanner(doc: PDFKit.PDFDocument): void {
    doc
      .fontSize(7)
      .fillColor('#b45309')
      .text(
        'DOCUMENT DE DÉMONSTRATION — facture générée par le simulateur GRANTFLOW (aucune valeur juridique)',
        50,
        38,
        { align: 'center', width: 495 },
      )
      .fillColor('#000');
  }

  private writeSupplierHeader(doc: PDFKit.PDFDocument, data: SupplierInvoiceData): void {
    const { supplier } = data;
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(supplier.name, 50, 60)
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#333');
    if (supplier.address) doc.text(supplier.address, 50);
    if (supplier.country) doc.text(supplier.country, 50);
    if (supplier.vatNumber) doc.text(`NINEA / N° fiscal : ${supplier.vatNumber}`, 50);
    doc.fillColor('#000');

    doc
      .fontSize(20)
      .fillColor('#1B7A8E')
      .text('FACTURE', 380, 60, { align: 'right', width: 165 })
      .fillColor('#000');
    doc.moveTo(50, 130).lineTo(545, 130).strokeColor('#999').stroke();
  }

  /** Bloc client = Institut Pasteur de Dakar (le destinataire de la facture). */
  private writeClientBlock(doc: PDFKit.PDFDocument): void {
    const y = 145;
    doc
      .fontSize(9)
      .text('FACTURÉ À', 50, y, { underline: true })
      .moveDown(0.3)
      .fontSize(9)
      .text('INSTITUT PASTEUR DE DAKAR')
      .text('36, avenue Pasteur — BP 220 Dakar (Sénégal)')
      .text('Direction Finance & Comptabilité');
  }

  private writeInvoiceMeta(doc: PDFKit.PDFDocument, data: SupplierInvoiceData): void {
    const x = 320;
    const y = 145;
    doc
      .fontSize(9)
      .text(`N° Facture : ${data.invoiceNumber}`, x, y)
      .text(`Date : ${this.formatDate(data.invoiceDate)}`, x)
      .text(`Échéance : ${this.formatDate(data.dueDate)} (${data.paymentTermsDays} j)`, x)
      .font('Helvetica-Bold')
      .text(`Réf. Bon de commande : ${data.poNumber}`, x)
      .font('Helvetica')
      .text(`Devise : ${data.currency}`, x);
  }

  private writeLinesTable(doc: PDFKit.PDFDocument, data: SupplierInvoiceData): void {
    const startY = 250;
    const colDesc = 50;
    const colQty = 320;
    const colUnit = 365;
    const colPu = 415;
    const colTot = 485;

    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('Description', colDesc, startY)
      .text('Qté', colQty, startY)
      .text('Unité', colUnit, startY)
      .text('PU', colPu, startY)
      .text('Total', colTot, startY)
      .font('Helvetica');

    doc.moveTo(50, startY + 12).lineTo(545, startY + 12).strokeColor('#999').stroke();

    let y = startY + 18;
    for (const line of data.lines) {
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

  private writeTotals(doc: PDFKit.PDFDocument, data: SupplierInvoiceData): void {
    const x = 360;
    const y = doc.y + 12;
    const vatPct = Math.round(data.vatRate * 100);
    doc
      .fontSize(9)
      .text(`Total HT : ${this.formatMoney(data.totalHt)} ${data.currency}`, x, y)
      .text(`TVA (${vatPct} %) : ${this.formatMoney(data.totalVat)} ${data.currency}`, x, y + 14)
      .font('Helvetica-Bold')
      .text(`NET À PAYER (TTC) : ${this.formatMoney(data.totalTtc)} ${data.currency}`, x, y + 28)
      .font('Helvetica');
  }

  private writeFooter(doc: PDFKit.PDFDocument, data: SupplierInvoiceData): void {
    const y = 770;
    doc
      .fontSize(8)
      .fillColor('#555')
      .text(
        `Règlement à ${data.paymentTermsDays} jours. Merci de votre confiance. — ` +
          'Facture simulée GRANTFLOW IPD (démo).',
        50,
        y,
        { align: 'center', width: 495 },
      )
      .fillColor('#000');
  }

  // ------------------------------------------------------------------
  // Formatters (identiques à PoPdfService)
  // ------------------------------------------------------------------

  private formatDate(d: Date): string {
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getUTCFullYear()}`;
  }

  private formatMoney(v: number): string {
    return v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  private formatQuantity(v: number): string {
    return v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  }
}
