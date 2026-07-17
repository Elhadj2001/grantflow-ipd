/**
 * Sprint F-OCR-VISION Lot A — tests unitaires PdfParseOcrProvider.
 *
 * Cases reprises 1:1 de l'ancien `ocr.service.spec.ts` — la logique
 * d'extraction n'a pas changé, seul l'emplacement (provider dédié) a
 * été déplacé. On teste `parseText` directement pour ne pas dépendre
 * de pdfkit dans la fixture (le pipeline pdf-parse → texte est testé
 * par un cas e2e séparé).
 */
import { PdfParseOcrProvider } from '../pdfparse-ocr.provider';

describe('PdfParseOcrProvider', () => {
  const svc = new PdfParseOcrProvider();

  it('expose `name = "pdfparse"` (identifiant pour les logs)', () => {
    expect(svc.name).toBe('pdfparse');
  });

  // ----------------------------------------------------------------
  // Numéro de facture
  // ----------------------------------------------------------------
  describe('invoice number', () => {
    it('extracts "Facture n° INV-2026-0042"', () => {
      const r = svc.parseText('Facture n° INV-2026-0042\nClient : IPD Dakar');
      expect(r.fields.invoiceNumber).toBe('INV-2026-0042');
      expect(r.fieldConfidence.invoiceNumber).toBeGreaterThan(80);
    });

    it('extracts "Invoice Number: FAC-001"', () => {
      const r = svc.parseText('Invoice Number: FAC-001');
      expect(r.fields.invoiceNumber).toBe('FAC-001');
    });

    it('falls back to direct pattern FAC2026123 without label', () => {
      const r = svc.parseText('Réf interne FAC-2026-99\nLignes ci-dessous');
      expect(r.fields.invoiceNumber).toBe('FAC-2026-99');
    });

    it('returns undefined when no number present', () => {
      const r = svc.parseText('Lorem ipsum dolor sit amet, no invoice here.');
      expect(r.fields.invoiceNumber).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // Dates
  // ----------------------------------------------------------------
  describe('dates', () => {
    it('extracts labelled invoice date DD/MM/YYYY', () => {
      const r = svc.parseText('Date facture : 14/05/2026\nTotal HT : 100');
      expect(r.fields.invoiceDate?.toISOString().slice(0, 10)).toBe('2026-05-14');
      expect(r.fieldConfidence.invoiceDate).toBeGreaterThan(80);
    });

    it('extracts ISO date 2026-05-14', () => {
      const r = svc.parseText('Date facture: 2026-05-14');
      expect(r.fields.invoiceDate?.toISOString().slice(0, 10)).toBe('2026-05-14');
    });

    it('falls back to any date in document', () => {
      const r = svc.parseText('Document du 14/05/2026 sans label précis');
      expect(r.fields.invoiceDate?.toISOString().slice(0, 10)).toBe('2026-05-14');
    });

    it('extracts due date when present', () => {
      const r = svc.parseText('Échéance : 14/06/2026');
      expect(r.fields.dueDate?.toISOString().slice(0, 10)).toBe('2026-06-14');
    });
  });

  // ----------------------------------------------------------------
  // Montants
  // ----------------------------------------------------------------
  describe('totals', () => {
    it('extracts total HT/TVA/TTC from a French invoice', () => {
      const text = `
Facture INV-2026-001
Total HT      : 100 000,00 XOF
TVA           :  18 000,00 XOF
Total TTC     : 118 000,00 XOF
`;
      const r = svc.parseText(text);
      expect(r.fields.totalHt).toBe(100000);
      expect(r.fields.totalVat).toBe(18000);
      expect(r.fields.totalTtc).toBe(118000);
    });

    it('computes VAT when HT and TTC are present but VAT label missing', () => {
      const text = 'Total HT : 100\nGrand Total : 118';
      const r = svc.parseText(text);
      expect(r.fields.totalHt).toBe(100);
      expect(r.fields.totalTtc).toBe(118);
      expect(r.fields.totalVat).toBe(18);
    });

    it('parses US-style numbers (1,234.56)', () => {
      const text = 'Subtotal: 1,234.56 USD\nAmount Due: 1,456.78 USD';
      const r = svc.parseText(text);
      expect(r.fields.totalHt).toBe(1234.56);
      expect(r.fields.totalTtc).toBe(1456.78);
    });

    it('parses bare integers without separator', () => {
      const text = 'Total HT: 100000\nTotal TTC: 118000';
      const r = svc.parseText(text);
      expect(r.fields.totalHt).toBe(100000);
      expect(r.fields.totalTtc).toBe(118000);
    });

    // ----- US-077 (F-S8-04) — le TAUX n'est jamais un MONTANT -----

    it('US-077 : « TVA (18%) : 2 952,00 » capture 2952, JAMAIS le taux 18', () => {
      const text = `
Total HT      : 16 400,00 XOF
TVA (18%)     :  2 952,00 XOF
Total TTC     : 19 352,00 XOF
`;
      const r = svc.parseText(text);
      expect(r.fields.totalVat).toBe(2952);
      expect(r.fields.totalHt).toBe(16400);
      expect(r.fields.totalTtc).toBe(19352);
      expect(r.warnings).toBeUndefined(); // cohérent → pas de warning
    });

    it('US-077 : « TVA 18 % » sans montant → dérivation TTC−HT (pas 18)', () => {
      const text = 'Total HT : 100 000\nTVA 18 %\nTotal TTC : 118 000';
      const r = svc.parseText(text);
      expect(r.fields.totalVat).toBe(18000);
    });

    it('US-077 : incohérence HT+TVA≠TTC → warning + confiance plafonnée ≤ 50', () => {
      // Reproduit la facture prod : TVA=18 alors que TTC-HT=2952.
      const text = 'Montant HT : 16 400,00\nTotal TVA : 18,00\nTotal TTC : 19 352,00';
      const r = svc.parseText(text);
      expect(r.warnings?.[0]).toMatch(/totals_inconsistent/);
      expect(r.confidence).toBeLessThanOrEqual(50);
      expect(r.fieldConfidence.totalVat).toBeLessThanOrEqual(30);
    });
  });

  // ----------------------------------------------------------------
  // Devise
  // ----------------------------------------------------------------
  describe('currency', () => {
    it('extracts XOF', () => {
      const r = svc.parseText('Total HT : 100 000,00 XOF');
      expect(r.fields.currency).toBe('XOF');
    });

    it('normalises CFA to XOF', () => {
      const r = svc.parseText('Total HT : 100 000 CFA');
      expect(r.fields.currency).toBe('XOF');
    });

    it('extracts EUR via €', () => {
      const r = svc.parseText('Total TTC : 1 234,56 €');
      expect(r.fields.currency).toBe('EUR');
    });

    it('returns undefined if no currency hint', () => {
      const r = svc.parseText('Numéro: FAC-001\nMontant : 100');
      expect(r.fields.currency).toBeUndefined();
    });

    it('US-077 : la devise PRÈS DES TOTAUX gagne sur une mention antérieure (IBAN EUR…)', () => {
      const text = `
Coordonnées bancaires : IBAN FR76… — virements EUR acceptés
Total HT  : 16 400,00
Total TTC : 19 352,00 XOF
`;
      const r = svc.parseText(text);
      expect(r.fields.currency).toBe('XOF');
    });
  });

  // ----------------------------------------------------------------
  // Référence BC
  // ----------------------------------------------------------------
  describe('PO reference', () => {
    it('extracts BC-2026-0042', () => {
      const r = svc.parseText('Votre BC-2026-0042\nMerci');
      expect(r.fields.poReference).toBe('BC-2026-0042');
    });

    it('extracts PO inline', () => {
      const r = svc.parseText('PO 2026-99 referenced on delivery');
      expect(r.fields.poReference?.replace(/\s/g, '')).toBe('PO2026-99');
    });

    it('undefined when no PO ref', () => {
      const r = svc.parseText('Just an invoice.');
      expect(r.fields.poReference).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // Cas d'ensemble
  // ----------------------------------------------------------------
  describe('overall result', () => {
    it('full French invoice → high confidence', () => {
      const text = `
FOURNISSEUR ACME LAB
Facture n° INV-2026-0042
Date facture : 14/05/2026
Échéance : 13/06/2026
Votre BC-2026-0017

Total HT  : 100 000,00 XOF
TVA       :  18 000,00 XOF
Total TTC : 118 000,00 XOF
`;
      const r = svc.parseText(text);
      expect(r.fields.invoiceNumber).toBe('INV-2026-0042');
      expect(r.fields.totalTtc).toBe(118000);
      expect(r.fields.currency).toBe('XOF');
      expect(r.fields.poReference).toBe('BC-2026-0017');
      expect(r.confidence).toBeGreaterThan(80);
      expect(r.isImageScan).toBe(false);
    });

    it('empty text → isImageScan stays false (parseText only)', () => {
      const r = svc.parseText('aaaaa bbbbb ccccc ddddd eeeee fffff');
      expect(r.fields.invoiceNumber).toBeUndefined();
      expect(r.confidence).toBe(0);
    });
  });
});
