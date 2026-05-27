import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PdfParseOcrProvider } from './ocr/pdfparse-ocr.provider';
import {
  OCR_VISION_PROVIDER,
} from './ocr/ocr-tokens';
import type { OcrProvider, OcrResult } from './ocr/ocr-provider.interface';

// Re-exports — préserve la rétro-compatibilité des imports `import { ... } from './ocr.service'`.
export type {
  OcrFields,
  OcrLineCandidate,
  OcrProvider,
  OcrResult,
} from './ocr/ocr-provider.interface';

/**
 * Sprint F-OCR-VISION — Façade OCR multi-provider.
 *
 * Anciennement la classe contenait toute la logique pdf-parse. Cette
 * implémentation a été extraite dans `PdfParseOcrProvider` (sprint
 * F-OCR-VISION Lot A). La façade choisit le provider selon l'env :
 *   - `OCR_PROVIDER=pdfparse` (défaut) → comportement strictement identique
 *     à avant ce sprint.
 *   - `OCR_PROVIDER=vision`    → Claude Vision (fallback pdf-parse en cas d'erreur).
 *   - `OCR_PROVIDER=auto`      → pdf-parse d'abord ; si `isImageScan` ou
 *     `confidence < OCR_VISION_FALLBACK_THRESHOLD` (défaut 50), bascule
 *     sur Vision (best-effort).
 *
 * `OcrService` reste la dépendance injectée dans `invoice.service` — le
 * contrat n'a pas changé : `extractFromPdf(buffer): Promise<OcrResult>`.
 * Pas d'introduction de BullMQ dans ce sprint (flux SYNCHRONE conservé).
 * TODO : asynchroniser sur queue si les latences Vision dépassent ~5 s
 * en pratique → améliorer l'UX upload.
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly providerName: 'pdfparse' | 'vision' | 'auto';
  /** Seuil de confiance pdf-parse en-dessous duquel `auto` bascule Vision. */
  private readonly autoFallbackThreshold: number;

  constructor(
    private readonly pdfParse: PdfParseOcrProvider,
    // Le provider Vision est optionnel — il n'est wiré que si la conf le
    // demande (le wiring se fait via useFactory dans invoicing.module.ts).
    @Optional() @Inject(OCR_VISION_PROVIDER) private readonly vision: OcrProvider | null,
    private readonly config: ConfigService,
  ) {
    const raw = (config.get<string>('OCR_PROVIDER') ?? 'pdfparse').toLowerCase();
    this.providerName =
      raw === 'vision' || raw === 'auto' ? raw : 'pdfparse';
    const thresholdRaw = config.get<string>('OCR_VISION_FALLBACK_THRESHOLD');
    const parsed = thresholdRaw ? Number.parseInt(thresholdRaw, 10) : NaN;
    this.autoFallbackThreshold =
      Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 50;

    this.logger.log(
      `OCR provider configured: ${this.providerName}` +
        (this.providerName === 'auto'
          ? ` (fallback threshold = ${this.autoFallbackThreshold})`
          : ''),
    );

    if (
      (this.providerName === 'vision' || this.providerName === 'auto') &&
      !this.vision
    ) {
      // Pas d'exception : on logue et on retombe sur pdfparse. Permet de
      // déployer du code "vision-ready" sans clé Anthropic en dev.
      this.logger.warn(
        `OCR_PROVIDER=${this.providerName} demandé mais aucun provider Vision wiré ` +
          '(ANTHROPIC_API_KEY manquante ?). Fallback définitif pdf-parse.',
      );
    }
  }

  /**
   * Point d'entrée unique consommé par `invoice.service` (upload facture).
   * Délègue au provider configuré + applique la stratégie `auto`.
   */
  async extractFromPdf(buffer: Buffer): Promise<OcrResult> {
    const start = Date.now();
    try {
      if (this.providerName === 'pdfparse' || !this.vision) {
        return await this.pdfParse.extractFromPdf(buffer);
      }

      if (this.providerName === 'vision') {
        return await this.runVisionWithFallback(buffer);
      }

      // 'auto' : pdfparse d'abord, fallback Vision si signal faible.
      const pdfResult = await this.pdfParse.extractFromPdf(buffer).catch(() => null);
      if (
        pdfResult &&
        !pdfResult.isImageScan &&
        pdfResult.confidence >= this.autoFallbackThreshold
      ) {
        return pdfResult;
      }
      this.logger.log(
        `OCR auto → bascule vers ${this.vision.name} ` +
          `(pdfparse confidence=${pdfResult?.confidence ?? 0}, isImageScan=${pdfResult?.isImageScan ?? 'unknown'})`,
      );
      return await this.runVisionWithFallback(buffer, pdfResult);
    } finally {
      this.logger.log(
        `OCR done in ${Date.now() - start} ms via ${this.providerName}`,
      );
    }
  }

  /**
   * Exécute Vision avec garde-fou : si l'appel échoue, on retombe sur
   * le résultat pdf-parse pré-calculé (ou un nouvel appel pdf-parse si
   * `pdfResultIfPrecomputed` est absent). Ainsi un upload ne plante
   * JAMAIS à cause d'un downtime Anthropic.
   */
  private async runVisionWithFallback(
    buffer: Buffer,
    pdfResultIfPrecomputed?: OcrResult | null,
  ): Promise<OcrResult> {
    if (!this.vision) {
      // Garde-fou — runVisionWithFallback ne devrait être appelée que si
      // this.vision existe. On retombe poliment sur pdfparse.
      return this.pdfParse.extractFromPdf(buffer);
    }
    try {
      return await this.vision.extractFromPdf(buffer);
    } catch (err) {
      this.logger.warn(
        { providerName: this.vision.name, err: err instanceof Error ? err.message : 'unknown' },
        'Vision OCR failed — falling back to pdf-parse',
      );
      if (pdfResultIfPrecomputed) return pdfResultIfPrecomputed;
      return this.pdfParse.extractFromPdf(buffer);
    }
  }
}
