/**
 * Sprint F-OCR-VISION Lot A/C — tests de la FAÇADE OcrService.
 *
 * Couvre :
 *   - sélection du provider via env (OCR_PROVIDER pdfparse|vision|auto)
 *   - mode 'auto' : bascule sur Vision quand pdfparse renvoie
 *     `isImageScan` ou `confidence` faible
 *   - fallback Vision → pdfparse en cas d'erreur Vision
 *   - défaut sans env = pdfparse strictement (anti-régression)
 *   - cas dégradé : OCR_PROVIDER=vision sans provider Vision wiré
 *     → fallback définitif pdfparse + log warning
 *
 * Les heuristiques d'extraction sont testées dans le spec dédié
 * `ocr/__tests__/pdfparse-ocr.provider.spec.ts`.
 */

import { ConfigService } from '@nestjs/config';
import { OcrService } from '../ocr.service';
import type { PdfParseOcrProvider } from '../ocr/pdfparse-ocr.provider';
import type { OcrProvider, OcrResult } from '../ocr/ocr-provider.interface';

function makePdfParseMock(result: OcrResult): jest.Mocked<PdfParseOcrProvider> {
  return {
    name: 'pdfparse',
    extractFromPdf: jest.fn().mockResolvedValue(result),
    // parseText n'est pas appelée par la façade — on met un stub vide.
    parseText: jest.fn(),
  } as unknown as jest.Mocked<PdfParseOcrProvider>;
}

function makeVisionMock(result: OcrResult): jest.Mocked<OcrProvider> {
  return {
    name: 'vision',
    extractFromPdf: jest.fn().mockResolvedValue(result),
  } as unknown as jest.Mocked<OcrProvider>;
}

function makeConfig(map: Record<string, string | undefined>): ConfigService {
  return {
    get: <T = string>(key: string): T | undefined => map[key] as T | undefined,
  } as unknown as ConfigService;
}

const HIGH_CONF_RESULT: OcrResult = {
  rawText: 'Facture INV-1',
  isImageScan: false,
  confidence: 90,
  fields: { invoiceNumber: 'INV-1' },
  fieldConfidence: { invoiceNumber: 95 },
};

const IMAGE_SCAN_RESULT: OcrResult = {
  rawText: '',
  isImageScan: true,
  confidence: 0,
  fields: {},
  fieldConfidence: {},
};

const VISION_RESULT: OcrResult = {
  rawText: '',
  isImageScan: false,
  confidence: 88,
  fields: { invoiceNumber: 'INV-VISION' },
  fieldConfidence: { invoiceNumber: 88 },
};

describe('OcrService (façade)', () => {
  describe('OCR_PROVIDER non défini', () => {
    it('défaut = pdfparse (anti-régression)', async () => {
      const pdf = makePdfParseMock(HIGH_CONF_RESULT);
      const svc = new OcrService(pdf, null, makeConfig({}));
      const r = await svc.extractFromPdf(Buffer.from('pdf'));
      expect(pdf.extractFromPdf).toHaveBeenCalledTimes(1);
      expect(r).toBe(HIGH_CONF_RESULT);
    });
  });

  describe('OCR_PROVIDER=pdfparse', () => {
    it('utilise pdfparse exclusivement', async () => {
      const pdf = makePdfParseMock(HIGH_CONF_RESULT);
      const vision = makeVisionMock(VISION_RESULT);
      const svc = new OcrService(pdf, vision, makeConfig({ OCR_PROVIDER: 'pdfparse' }));
      const r = await svc.extractFromPdf(Buffer.from('pdf'));
      expect(pdf.extractFromPdf).toHaveBeenCalledTimes(1);
      expect(vision.extractFromPdf).not.toHaveBeenCalled();
      expect(r).toBe(HIGH_CONF_RESULT);
    });
  });

  describe('OCR_PROVIDER=vision', () => {
    it('utilise vision', async () => {
      const pdf = makePdfParseMock(HIGH_CONF_RESULT);
      const vision = makeVisionMock(VISION_RESULT);
      const svc = new OcrService(pdf, vision, makeConfig({ OCR_PROVIDER: 'vision' }));
      const r = await svc.extractFromPdf(Buffer.from('pdf'));
      expect(vision.extractFromPdf).toHaveBeenCalledTimes(1);
      expect(pdf.extractFromPdf).not.toHaveBeenCalled();
      expect(r).toBe(VISION_RESULT);
    });

    it("fallback pdfparse si Vision échoue (jamais d'upload bloqué)", async () => {
      const pdf = makePdfParseMock(HIGH_CONF_RESULT);
      const vision = makeVisionMock(VISION_RESULT);
      vision.extractFromPdf.mockRejectedValueOnce(new Error('anthropic-api-down'));
      const svc = new OcrService(pdf, vision, makeConfig({ OCR_PROVIDER: 'vision' }));
      const r = await svc.extractFromPdf(Buffer.from('pdf'));
      expect(vision.extractFromPdf).toHaveBeenCalledTimes(1);
      expect(pdf.extractFromPdf).toHaveBeenCalledTimes(1);
      expect(r).toBe(HIGH_CONF_RESULT);
    });

    it("vision demandée mais provider absent → fallback pdfparse + warning", async () => {
      const pdf = makePdfParseMock(HIGH_CONF_RESULT);
      const svc = new OcrService(pdf, null, makeConfig({ OCR_PROVIDER: 'vision' }));
      const r = await svc.extractFromPdf(Buffer.from('pdf'));
      expect(pdf.extractFromPdf).toHaveBeenCalledTimes(1);
      expect(r).toBe(HIGH_CONF_RESULT);
    });
  });

  describe('OCR_PROVIDER=auto', () => {
    it('reste sur pdfparse si confidence ≥ seuil par défaut (50)', async () => {
      const pdf = makePdfParseMock(HIGH_CONF_RESULT); // confidence=90
      const vision = makeVisionMock(VISION_RESULT);
      const svc = new OcrService(pdf, vision, makeConfig({ OCR_PROVIDER: 'auto' }));
      const r = await svc.extractFromPdf(Buffer.from('pdf'));
      expect(pdf.extractFromPdf).toHaveBeenCalledTimes(1);
      expect(vision.extractFromPdf).not.toHaveBeenCalled();
      expect(r).toBe(HIGH_CONF_RESULT);
    });

    it("bascule sur Vision si pdfparse renvoie isImageScan", async () => {
      const pdf = makePdfParseMock(IMAGE_SCAN_RESULT);
      const vision = makeVisionMock(VISION_RESULT);
      const svc = new OcrService(pdf, vision, makeConfig({ OCR_PROVIDER: 'auto' }));
      const r = await svc.extractFromPdf(Buffer.from('pdf'));
      expect(pdf.extractFromPdf).toHaveBeenCalledTimes(1);
      expect(vision.extractFromPdf).toHaveBeenCalledTimes(1);
      expect(r).toBe(VISION_RESULT);
    });

    it("bascule sur Vision si pdfparse confidence < seuil (override env)", async () => {
      const pdf = makePdfParseMock({ ...HIGH_CONF_RESULT, confidence: 40 });
      const vision = makeVisionMock(VISION_RESULT);
      const svc = new OcrService(
        pdf,
        vision,
        makeConfig({ OCR_PROVIDER: 'auto', OCR_VISION_FALLBACK_THRESHOLD: '50' }),
      );
      const r = await svc.extractFromPdf(Buffer.from('pdf'));
      expect(vision.extractFromPdf).toHaveBeenCalledTimes(1);
      expect(r).toBe(VISION_RESULT);
    });

    it("auto + Vision en panne → conserve le résultat pdfparse (best-effort)", async () => {
      const pdfResult = { ...HIGH_CONF_RESULT, confidence: 30 }; // faible
      const pdf = makePdfParseMock(pdfResult);
      const vision = makeVisionMock(VISION_RESULT);
      vision.extractFromPdf.mockRejectedValueOnce(new Error('anthropic-down'));
      const svc = new OcrService(pdf, vision, makeConfig({ OCR_PROVIDER: 'auto' }));
      const r = await svc.extractFromPdf(Buffer.from('pdf'));
      expect(pdf.extractFromPdf).toHaveBeenCalledTimes(1);
      expect(vision.extractFromPdf).toHaveBeenCalledTimes(1);
      // Vision échoue → on garde le résultat pdfparse pré-calculé
      expect(r).toBe(pdfResult);
    });
  });
});
