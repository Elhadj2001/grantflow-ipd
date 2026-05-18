import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { LabelFormat } from '../dto/gr-labels.dto';

export interface GrLabelLine {
  lineId: string;
  lineNumber: number;
  description: string;
  batchNumber: string | null;
  expiryDate: Date | null;
  coldChainRequired: boolean;
}

export interface GrLabelsPayload {
  grId: string;
  grNumber: string;
  poNumber: string;
  supplierName: string;
  receiptDate: Date;
  lines: GrLabelLine[];
  /** Nombre de cartons par ligne (1 = une étiquette / ligne). */
  cartonCountPerLine: number;
}

/**
 * Génère un PDF d'étiquettes QR pour traçabilité magasin.
 *
 * Chaque étiquette contient :
 *  - QR code encodant `GRF://<grId>/<lineId>/<carton>`
 *  - N° GR + ligne + carton, description courte, lot, péremption,
 *    badge ❄️ si chaîne du froid
 *
 * Pas de norme externe (GS1/EAN) — c'est notre propre système de
 * traçabilité interne, scannable plus tard par /inventaire-scan.
 *
 * Deux formats :
 *  - grid-4x4    : A4 portrait, grille 4×4 = 16 étiquettes (~70×35 mm)
 *  - individual  : A4 portrait, 1 étiquette pleine page (gros colis)
 */
@Injectable()
export class GrLabelsService {
  async generate(payload: GrLabelsPayload, format: LabelFormat): Promise<Buffer> {
    // Le rendu PDF est sync (chunks pdfkit) mais la génération QR est async.
    // On pré-calcule tous les QR en cache avant la phase de dessin.
    await this.preComputeQrCodes(payload);
    if (format === 'individual') return this.generateIndividual(payload);
    return this.generateGrid(payload);
  }

  // ------------------------------------------------------------------
  // Format grille 4×4
  // ------------------------------------------------------------------

  private async generateGrid(payload: GrLabelsPayload): Promise<Buffer> {
    const labels = this.expandLabels(payload);
    return this.renderPdf((doc) => {
      const cols = 4;
      const rows = 4;
      const perPage = cols * rows;
      // Marges + dimensions (A4 = 595×842 pt)
      const marginX = 30;
      const marginY = 40;
      const usableW = 595 - 2 * marginX;
      const usableH = 842 - 2 * marginY;
      const cellW = usableW / cols;
      const cellH = usableH / rows;

      labels.forEach((label, idx) => {
        const slot = idx % perPage;
        if (idx > 0 && slot === 0) doc.addPage();
        const col = slot % cols;
        const row = Math.floor(slot / cols);
        const x = marginX + col * cellW;
        const y = marginY + row * cellH;
        this.drawLabel(doc, label, x + 4, y + 4, cellW - 8, cellH - 8);
      });
    });
  }

  // ------------------------------------------------------------------
  // Format pleine page
  // ------------------------------------------------------------------

  private async generateIndividual(payload: GrLabelsPayload): Promise<Buffer> {
    const labels = this.expandLabels(payload);
    return this.renderPdf((doc) => {
      labels.forEach((label, idx) => {
        if (idx > 0) doc.addPage();
        this.drawLabel(doc, label, 50, 50, 495, 742);
      });
    });
  }

  // ------------------------------------------------------------------
  // Helpers internes
  // ------------------------------------------------------------------

  private async renderPdf(builder: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 0 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        builder(doc);
        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Développe les lignes en n étiquettes individuelles (1 par carton). */
  private expandLabels(payload: GrLabelsPayload) {
    const labels: Array<{
      uri: string;
      lineNumber: number;
      cartonNumber: number;
      cartonsTotal: number;
      description: string;
      grNumber: string;
      batchNumber: string | null;
      expiryDate: Date | null;
      coldChainRequired: boolean;
    }> = [];
    for (const line of payload.lines) {
      for (let c = 1; c <= payload.cartonCountPerLine; c++) {
        labels.push({
          uri: `GRF://${payload.grId}/${line.lineId}/${c}`,
          lineNumber: line.lineNumber,
          cartonNumber: c,
          cartonsTotal: payload.cartonCountPerLine,
          description: line.description,
          grNumber: payload.grNumber,
          batchNumber: line.batchNumber,
          expiryDate: line.expiryDate,
          coldChainRequired: line.coldChainRequired,
        });
      }
    }
    return labels;
  }

  /** Dessine une étiquette dans un rectangle (x, y, w, h). */
  private drawLabel(
    doc: PDFKit.PDFDocument,
    label: ReturnType<GrLabelsService['expandLabels']>[number],
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    // Bordure pointillée discrète pour repère de découpe
    doc
      .save()
      .lineWidth(0.5)
      .dash(2, { space: 2 })
      .strokeColor('#bbb')
      .rect(x, y, w, h)
      .stroke()
      .restore();

    // QR code (carré, ~40% de la largeur)
    const qrSize = Math.min(w * 0.4, h * 0.55);
    const qrPng = this.qrDataUrlSync(label.uri);
    if (qrPng) {
      doc.image(qrPng, x + 4, y + 4, { width: qrSize, height: qrSize });
    }

    // Bloc texte à droite du QR
    const textX = x + qrSize + 12;
    const textW = w - qrSize - 16;
    let textY = y + 6;

    doc
      .fontSize(8)
      .fillColor('#000')
      .font('Helvetica-Bold')
      .text(`${label.grNumber}`, textX, textY, { width: textW, ellipsis: true });
    textY += 11;
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#444')
      .text(
        `Ligne ${label.lineNumber} · Carton ${label.cartonNumber}/${label.cartonsTotal}`,
        textX,
        textY,
        { width: textW, ellipsis: true },
      );
    textY += 10;
    doc
      .fontSize(7)
      .fillColor('#000')
      .text(label.description, textX, textY, {
        width: textW,
        height: 20,
        ellipsis: true,
      });
    textY += 22;

    if (label.batchNumber) {
      doc
        .fontSize(6)
        .fillColor('#555')
        .text(`Lot ${label.batchNumber}`, textX, textY, { width: textW, ellipsis: true });
      textY += 8;
    }
    if (label.expiryDate) {
      const day = String(label.expiryDate.getUTCDate()).padStart(2, '0');
      const month = String(label.expiryDate.getUTCMonth() + 1).padStart(2, '0');
      const year = label.expiryDate.getUTCFullYear();
      doc
        .fontSize(6)
        .fillColor('#555')
        .text(`Périmé le ${day}/${month}/${year}`, textX, textY, { width: textW, ellipsis: true });
      textY += 8;
    }
    if (label.coldChainRequired) {
      doc
        .fontSize(7)
        .fillColor('#0E5060')
        .font('Helvetica-Bold')
        .text('❄ CHAÎNE DU FROID', textX, textY, { width: textW, ellipsis: true })
        .font('Helvetica');
    }
  }

  /**
   * Génère un PNG QR encodé Base64 (pour passer à pdfkit.image()).
   *
   * `qrcode` est async par nature — on stocke la promise dans un cache
   * local pendant la phase d'expansion pour pouvoir générer les chunks
   * synchroniquement dans drawLabel(). En pratique, le service appelle
   * `await this.preComputeQrCodes()` avant d'invoquer renderPdf().
   *
   * Note : pour simplifier, on passe par toDataURL (Base64), trade-off
   * lisible / fonctionnel pour un volume modeste (≤ 64 étiquettes).
   */
  private qrCache = new Map<string, string>();
  private qrDataUrlSync(uri: string): string | null {
    return this.qrCache.get(uri) ?? null;
  }

  /** À appeler avant renderPdf — peuple le cache QR. */
  async preComputeQrCodes(payload: GrLabelsPayload): Promise<void> {
    this.qrCache.clear();
    for (const label of this.expandLabels(payload)) {
      if (this.qrCache.has(label.uri)) continue;
      const dataUrl = await QRCode.toDataURL(label.uri, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 256,
      });
      this.qrCache.set(label.uri, dataUrl);
    }
  }
}
