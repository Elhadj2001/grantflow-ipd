/**
 * Sprint F-OCR-VISION Lot B — tests unitaires ClaudeVisionOcrProvider.
 *
 * Stratégie : on stube global.fetch — pas d'appel réseau réel à
 * l'API Anthropic. Couvre :
 *   - construction depuis ConfigService (clé requise, modèle par défaut,
 *     surcharge OCR_VISION_MODEL/OCR_VISION_MAX_BYTES),
 *   - mapping JSON Anthropic → OcrResult (champs, confidences, dates,
 *     lines, devise upper-case),
 *   - garde-fou taille (PDF trop gros → OcrExtractionFailedException),
 *   - erreurs HTTP / réseau → exception propre (la façade s'occupe du
 *     fallback pdfparse — pas le provider lui-même),
 *   - aucun PII dans les logs (assertion sur le contenu de logger.warn).
 */

import { ConfigService } from '@nestjs/config';
import { ClaudeVisionOcrProvider } from '../claude-vision-ocr.provider';
import { OcrExtractionFailedException } from '../../../../common/exceptions/business.exception';

function makeConfig(map: Record<string, string | undefined>): ConfigService {
  return {
    get: <T = string>(k: string): T | undefined => map[k] as T | undefined,
  } as unknown as ConfigService;
}

/** Build a fake Response-like object for fetch mock. */
function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response;
}

function errorResponse(status: number, body = ''): Response {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

/** Réponse Anthropic minimaliste avec un bloc tool_use. */
function anthropicToolUse(input: unknown) {
  return {
    content: [
      {
        type: 'tool_use',
        name: 'extract_invoice_fields',
        input,
      },
    ],
    stop_reason: 'tool_use',
  };
}

describe('ClaudeVisionOcrProvider', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------- Construction ----------------

  describe('construction', () => {
    it('lève si ANTHROPIC_API_KEY absent (garde-fou défensif)', () => {
      expect(() => new ClaudeVisionOcrProvider(makeConfig({}))).toThrow(
        /ANTHROPIC_API_KEY/,
      );
    });

    it('expose name = "vision"', () => {
      const svc = new ClaudeVisionOcrProvider(
        makeConfig({ ANTHROPIC_API_KEY: 'sk-test' }),
      );
      expect(svc.name).toBe('vision');
    });

    it("OCR_VISION_MODEL vide ('') → fallback DEFAULT_VISION_MODEL (anti-régression)", async () => {
      // Reproduit le bug détecté pendant le smoke test : `OCR_VISION_MODEL=`
      // dans .env retourne `""` côté ConfigService. Le `??` ne déclencherait
      // PAS le fallback (chaîne vide n'est pas nullish), Anthropic
      // répondrait 400 « model: String should have at least 1 character ».
      const svc = new ClaudeVisionOcrProvider(
        makeConfig({ ANTHROPIC_API_KEY: 'sk-test', OCR_VISION_MODEL: '' }),
      );
      fetchMock.mockResolvedValueOnce(
        okResponse(anthropicToolUse({ invoiceNumber: 'INV-1' })),
      );
      await svc.extractFromPdf(Buffer.from('PDF'));
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      );
      // Le modèle envoyé doit être non vide ; on ne fige PAS l'id exact
      // (il évolue avec les releases Anthropic), juste qu'il est défini.
      expect(typeof body.model).toBe('string');
      expect(body.model.length).toBeGreaterThan(0);
    });

    it('OCR_VISION_MODEL whitespace-only → fallback aussi', async () => {
      const svc = new ClaudeVisionOcrProvider(
        makeConfig({ ANTHROPIC_API_KEY: 'sk-test', OCR_VISION_MODEL: '   ' }),
      );
      fetchMock.mockResolvedValueOnce(
        okResponse(anthropicToolUse({ invoiceNumber: 'INV-1' })),
      );
      await svc.extractFromPdf(Buffer.from('PDF'));
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.model.length).toBeGreaterThan(0);
      expect(body.model.trim()).toBe(body.model);
    });
  });

  // ---------------- Mapping happy path ----------------

  describe('extractFromPdf — mapping JSON → OcrResult', () => {
    it('mappe les champs principaux + perFieldConfidence', async () => {
      const svc = new ClaudeVisionOcrProvider(
        makeConfig({ ANTHROPIC_API_KEY: 'sk-test', OCR_VISION_MODEL: 'claude-test' }),
      );
      fetchMock.mockResolvedValueOnce(
        okResponse(
          anthropicToolUse({
            invoiceNumber: 'INV-2026-001',
            invoiceDate: '2026-05-14',
            dueDate: '2026-06-14',
            supplierName: 'ACME LAB',
            currency: 'xof',
            totalHt: 100000,
            vatAmount: 18000,
            totalTtc: 118000,
            poReference: 'BC-2026-001',
            perFieldConfidence: {
              invoiceNumber: 95,
              totalTtc: 92,
              currency: 90,
            },
          }),
        ),
      );

      const r = await svc.extractFromPdf(Buffer.from('FAKE_PDF_BYTES_long_enough'));

      expect(r.fields.invoiceNumber).toBe('INV-2026-001');
      expect(r.fields.invoiceDate?.toISOString().slice(0, 10)).toBe('2026-05-14');
      expect(r.fields.dueDate?.toISOString().slice(0, 10)).toBe('2026-06-14');
      expect(r.fields.supplierName).toBe('ACME LAB');
      expect(r.fields.currency).toBe('XOF'); // upper-case forcé
      expect(r.fields.totalHt).toBe(100000);
      expect(r.fields.totalVat).toBe(18000); // mapping vatAmount → totalVat
      expect(r.fields.totalTtc).toBe(118000);
      expect(r.fields.poReference).toBe('BC-2026-001');
      expect(r.fieldConfidence.invoiceNumber).toBe(95);
      expect(r.fieldConfidence.totalTtc).toBe(92);
      expect(r.isImageScan).toBe(false);
      expect(r.confidence).toBeGreaterThan(0);

      // Vérifie que l'appel HTTP est conforme
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect((init as RequestInit).method).toBe('POST');
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-test');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe('claude-test');
      expect(body.tool_choice).toEqual({ type: 'tool', name: 'extract_invoice_fields' });
    });

    it('mappe les lignes et calcule lineTotal quand quantity+unitPrice présents', async () => {
      const svc = new ClaudeVisionOcrProvider(makeConfig({ ANTHROPIC_API_KEY: 'sk-x' }));
      fetchMock.mockResolvedValueOnce(
        okResponse(
          anthropicToolUse({
            lines: [
              { description: 'Reagent A', quantity: 10, unitPrice: 150.5 },
              { description: 'Service install', quantity: 1 }, // pas d'unitPrice → pas de lineTotal
              { description: '   ' }, // filtré (blank)
            ],
          }),
        ),
      );
      const r = await svc.extractFromPdf(Buffer.from('PDF'));
      expect(r.fields.lines).toHaveLength(2);
      expect(r.fields.lines?.[0]).toEqual({
        description: 'Reagent A',
        quantity: 10,
        unitPrice: 150.5,
        lineTotal: 1505,
      });
      expect(r.fields.lines?.[1]).toEqual({
        description: 'Service install',
        quantity: 1,
      });
    });

    it("attribue la confiance par défaut (85) si perFieldConfidence absent", async () => {
      const svc = new ClaudeVisionOcrProvider(makeConfig({ ANTHROPIC_API_KEY: 'sk-x' }));
      fetchMock.mockResolvedValueOnce(
        okResponse(anthropicToolUse({ invoiceNumber: 'INV-001' })),
      );
      const r = await svc.extractFromPdf(Buffer.from('PDF'));
      expect(r.fieldConfidence.invoiceNumber).toBe(85);
    });

    it('champs absents du JSON Claude → absents de OcrResult.fields (pas de null/undef)', async () => {
      const svc = new ClaudeVisionOcrProvider(makeConfig({ ANTHROPIC_API_KEY: 'sk-x' }));
      fetchMock.mockResolvedValueOnce(
        okResponse(anthropicToolUse({ invoiceNumber: 'INV-1' })),
      );
      const r = await svc.extractFromPdf(Buffer.from('PDF'));
      expect(r.fields.invoiceNumber).toBe('INV-1');
      expect('supplierName' in r.fields).toBe(false);
      expect('totalHt' in r.fields).toBe(false);
    });
  });

  // ---------------- Erreurs ----------------

  describe('erreurs', () => {
    const svc = () =>
      new ClaudeVisionOcrProvider(makeConfig({ ANTHROPIC_API_KEY: 'sk-x' }));

    it('buffer vide → OcrExtractionFailedException, pas d\'appel réseau', async () => {
      await expect(svc().extractFromPdf(Buffer.alloc(0))).rejects.toBeInstanceOf(
        OcrExtractionFailedException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('PDF > limite (5 Mo défaut) → OcrExtractionFailedException, pas d\'appel réseau', async () => {
      const big = Buffer.alloc(5 * 1024 * 1024 + 1);
      await expect(svc().extractFromPdf(big)).rejects.toBeInstanceOf(
        OcrExtractionFailedException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('limite surchargée via OCR_VISION_MAX_BYTES', async () => {
      const provider = new ClaudeVisionOcrProvider(
        makeConfig({ ANTHROPIC_API_KEY: 'sk-x', OCR_VISION_MAX_BYTES: '1024' }),
      );
      const buf = Buffer.alloc(1025);
      await expect(provider.extractFromPdf(buf)).rejects.toBeInstanceOf(
        OcrExtractionFailedException,
      );
    });

    it('erreur réseau (fetch reject) → exception propre', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(svc().extractFromPdf(Buffer.from('PDF'))).rejects.toBeInstanceOf(
        OcrExtractionFailedException,
      );
    });

    it('HTTP 429 (rate limit) → exception propre', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(429, '{"type":"rate_limit"}'));
      await expect(svc().extractFromPdf(Buffer.from('PDF'))).rejects.toBeInstanceOf(
        OcrExtractionFailedException,
      );
    });

    it('réponse sans tool_use → exception propre', async () => {
      fetchMock.mockResolvedValueOnce(
        okResponse({
          content: [{ type: 'text', text: 'oups je devine plutôt' }],
          stop_reason: 'end_turn',
        }),
      );
      await expect(svc().extractFromPdf(Buffer.from('PDF'))).rejects.toBeInstanceOf(
        OcrExtractionFailedException,
      );
    });
  });

  // ---------------- Confidentialité ----------------

  describe('confidentialité — pas de PII dans les logs', () => {
    it('en cas d\'erreur HTTP, le log ne contient ni clé API ni buffer', async () => {
      const svc = new ClaudeVisionOcrProvider(
        makeConfig({ ANTHROPIC_API_KEY: 'SECRET-SHOULD-NEVER-LEAK' }),
      );
      fetchMock.mockResolvedValueOnce(errorResponse(500, '{"error":"internal"}'));

      // Spy sur le logger Nest — capture des arguments réels.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const warnSpy = jest.spyOn((svc as any).logger, 'warn');
      try {
        await svc.extractFromPdf(Buffer.from('CONFIDENTIAL_INVOICE_BUFFER'));
      } catch {
        /* ok */
      }
      const allArgs = warnSpy.mock.calls.flat();
      for (const a of allArgs) {
        const text = typeof a === 'string' ? a : JSON.stringify(a);
        expect(text).not.toContain('SECRET-SHOULD-NEVER-LEAK');
        expect(text).not.toContain('CONFIDENTIAL_INVOICE_BUFFER');
      }
    });
  });
});
