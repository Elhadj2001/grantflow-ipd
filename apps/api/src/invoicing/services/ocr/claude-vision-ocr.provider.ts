import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OcrExtractionFailedException } from '../../../common/exceptions/business.exception';
import type {
  OcrFields,
  OcrLineCandidate,
  OcrProvider,
  OcrResult,
} from './ocr-provider.interface';

/**
 * Sprint F-OCR-VISION Lot B — Provider OCR Claude Vision (Anthropic API).
 *
 * Stratégie : on envoie le PDF entier en bloc `document` à l'API Messages
 * (l'API lit nativement les PDF, pas besoin de rasteriser). On demande
 * une extraction STRUCTURÉE via `tool_use` avec un `input_schema` JSON
 * strict — le modèle DOIT répondre via l'outil `extract_invoice_fields`,
 * sans texte libre, ce qui rend le parsing déterministe côté code.
 *
 * Sécurité / confidentialité :
 *   - Clé `ANTHROPIC_API_KEY` lue côté env, JAMAIS hardcodée ni loggée.
 *   - On n'envoie le PDF qu'à Anthropic (opt-in via OCR_PROVIDER=vision|auto).
 *   - Aucun PDF n'est écrit sur disque.
 *   - Les logs ne contiennent JAMAIS de payload facture (ni montants, ni
 *     n° facture extraits) — uniquement des indicateurs techniques
 *     (latence, taille, statut HTTP, message d'erreur générique).
 *
 * Garde-fou taille : on rejette les PDF > MAX_PDF_BYTES (5 Mo par défaut,
 * surchargable via OCR_VISION_MAX_BYTES). L'API Anthropic accepte de
 * grosses tailles mais le coût et la latence explosent ; la quasi-totalité
 * des factures fournisseur tiennent largement sous 5 Mo.
 *
 * Fallback : ce provider NE TENTE PAS de fallback en interne — la façade
 * `OcrService` catche les erreurs et retombe sur pdf-parse. Une exception
 * ici signale "Vision indisponible / inutilisable pour ce PDF".
 */

const DEFAULT_MAX_PDF_BYTES = 5 * 1024 * 1024;
/**
 * Modèle Claude par défaut. La valeur EXACTE doit refléter un modèle
 * actuellement disponible sur l'API au moment du déploiement —
 * surchargable via OCR_VISION_MODEL (.env). Voir docs Anthropic pour
 * la liste des modèles supportant le bloc `document` PDF.
 *
 * Vérifié actif au 2026-05-27 (cf. https://platform.claude.com/docs/en/about-claude/models/overview).
 * Ancien défaut `claude-sonnet-4-5` (Sonnet 4.5) reste compatible mais
 * a été déclassé en "legacy" — on suit le Sonnet courant.
 */
const DEFAULT_VISION_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

/** JSON Schema attendu en sortie du tool — passé tel quel à l'API. */
const INVOICE_EXTRACTION_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    invoiceNumber: { type: 'string', description: "Référence facture (FAC-..., INV-...)" },
    invoiceDate: { type: 'string', description: 'Date facture ISO YYYY-MM-DD' },
    dueDate: { type: 'string', description: "Date d'échéance ISO YYYY-MM-DD" },
    supplierName: { type: 'string', description: 'Raison sociale fournisseur' },
    currency: { type: 'string', description: 'Code ISO 4217 (XOF, EUR, USD…)' },
    totalHt: { type: 'number', description: 'Total hors taxes' },
    vatAmount: { type: 'number', description: 'Montant TVA' },
    totalTtc: { type: 'number', description: 'Total toutes taxes comprises' },
    poReference: { type: 'string', description: 'Référence BC associée (BC-…)' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { type: 'number' },
        },
      },
    },
    perFieldConfidence: {
      type: 'object',
      description:
        'Confiance 0-100 par champ. Clés possibles : invoiceNumber, invoiceDate, ' +
        'dueDate, supplierName, currency, totalHt, totalVat, totalTtc, poReference.',
      additionalProperties: { type: 'number' },
    },
  },
} as const;

const TOOL_NAME = 'extract_invoice_fields';

/**
 * Forme attendue du JSON renvoyé par le modèle dans `tool_use`.
 * Tous les champs sont optionnels — le modèle laisse en absent ce qu'il
 * ne sait pas lire.
 */
interface ClaudeExtractedJson {
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  supplierName?: string;
  currency?: string;
  totalHt?: number;
  vatAmount?: number;
  totalTtc?: number;
  poReference?: string;
  lines?: Array<{ description?: string; quantity?: number; unitPrice?: number }>;
  perFieldConfidence?: Record<string, number>;
}

interface AnthropicContentBlock {
  type: string;
  name?: string;
  input?: ClaudeExtractedJson;
  text?: string;
}

interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
}

export class ClaudeVisionOcrProvider implements OcrProvider {
  readonly name = 'vision';
  private readonly logger = new Logger(ClaudeVisionOcrProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxBytes: number;

  constructor(config: ConfigService) {
    const key = config.get<string>('ANTHROPIC_API_KEY');
    if (!key) {
      // Construit uniquement quand la clé est présente (cf. useFactory du
      // module qui renvoie null sinon). Ce throw est un garde-fou de
      // défense — ne devrait pas arriver en pratique.
      throw new Error(
        'ClaudeVisionOcrProvider requires ANTHROPIC_API_KEY (provider should be wired only when the key is present).',
      );
    }
    this.apiKey = key;
    // Garde-fou : OCR_VISION_MODEL peut être présent dans .env mais VIDE
    // (`OCR_VISION_MODEL=`) — config.get retourne alors `""`. Le `??` ne
    // déclencherait pas le fallback (chaîne vide ≠ nullish), et l'API
    // Anthropic répondrait 400 « model: String should have at least 1
    // character ». On normalise en trim+truthy check explicite.
    const modelFromEnv = config.get<string>('OCR_VISION_MODEL');
    const modelTrimmed = typeof modelFromEnv === 'string' ? modelFromEnv.trim() : '';
    this.model = modelTrimmed.length > 0 ? modelTrimmed : DEFAULT_VISION_MODEL;
    const maxBytesRaw = config.get<string>('OCR_VISION_MAX_BYTES');
    const parsed = maxBytesRaw ? Number.parseInt(maxBytesRaw, 10) : NaN;
    this.maxBytes =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PDF_BYTES;
  }

  async extractFromPdf(buffer: Buffer): Promise<OcrResult> {
    if (buffer.length === 0) {
      throw new OcrExtractionFailedException('empty buffer');
    }
    if (buffer.length > this.maxBytes) {
      // Pas de PII dans le log — uniquement la taille.
      this.logger.warn(
        { bytes: buffer.length, maxBytes: this.maxBytes },
        'PDF too large for vision OCR',
      );
      throw new OcrExtractionFailedException(
        `PDF size ${buffer.length} bytes exceeds vision OCR limit (${this.maxBytes})`,
      );
    }

    const base64 = buffer.toString('base64');
    const requestBody = {
      model: this.model,
      max_tokens: 4096,
      tools: [
        {
          name: TOOL_NAME,
          description:
            "Extrait les champs structurés d'une facture fournisseur scannée " +
            '(en-tête + lignes). Renvoie un JSON strictement conforme au schéma.',
          input_schema: INVOICE_EXTRACTION_TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            {
              type: 'text',
              text:
                'Voici une facture fournisseur. Extrais les champs via l\'outil ' +
                '`extract_invoice_fields`. Si un champ est absent ou illisible, ' +
                'OMETS-LE (ne pas deviner). Renseigne `perFieldConfidence` (0-100) ' +
                'pour chaque champ extrait. Les dates doivent être en ISO YYYY-MM-DD. ' +
                'Devise = code ISO 4217 (XOF, EUR, USD, ...). Aucun texte libre — ' +
                'utilise UNIQUEMENT l\'outil.',
            },
          ],
        },
      ],
    };

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify(requestBody),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.warn({ err: msg }, 'Anthropic Vision fetch failed (network)');
      throw new OcrExtractionFailedException(`anthropic-network: ${msg}`);
    }

    if (!response.ok) {
      // Lit le body en mode "tronqué" sans logger de PII : le body
      // d'erreur Anthropic ne contient pas la facture, juste un code
      // d'erreur API.
      const text = await response.text().catch(() => '');
      this.logger.warn(
        { status: response.status, bodyPrefix: text.slice(0, 200) },
        'Anthropic Vision returned non-2xx',
      );
      throw new OcrExtractionFailedException(
        `anthropic-http-${response.status}`,
      );
    }

    const json = (await response.json()) as AnthropicMessageResponse;
    const toolBlock = (json.content ?? []).find(
      (b) => b.type === 'tool_use' && b.name === TOOL_NAME,
    );
    if (!toolBlock || !toolBlock.input) {
      this.logger.warn(
        { stop_reason: json.stop_reason },
        'Anthropic response missing tool_use block',
      );
      throw new OcrExtractionFailedException('anthropic-no-tool-use');
    }

    return this.mapToOcrResult(toolBlock.input);
  }

  /**
   * Convertit le JSON Claude vers le contrat `OcrResult` consommé par
   * `invoice.service`. Sémantique des confidences alignée sur pdfparse
   * (échelle 0-100). Champs non extraits = absents (pas `null` ni `""`).
   */
  private mapToOcrResult(input: ClaudeExtractedJson): OcrResult {
    const fields: OcrFields = {};
    const fieldConfidence: Record<string, number> = {};

    const setStr = (key: keyof OcrFields, value: string | undefined) => {
      if (value && value.trim().length > 0) {
        (fields[key] as unknown) = value.trim();
        fieldConfidence[key] =
          input.perFieldConfidence?.[key as string] ??
          this.defaultConfidence();
      }
    };

    const setNum = (key: keyof OcrFields, value: number | undefined) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        (fields[key] as unknown) = value;
        // Le modèle expose `vatAmount` dans son schéma — on l'aligne sur
        // `totalVat` côté OcrFields (champ historique).
        const confKey = key === 'totalVat' ? 'vatAmount' : (key as string);
        fieldConfidence[key] =
          input.perFieldConfidence?.[confKey] ?? this.defaultConfidence();
      }
    };

    const setDate = (key: 'invoiceDate' | 'dueDate', iso: string | undefined) => {
      if (!iso) return;
      const d = new Date(`${iso}T00:00:00Z`);
      if (!Number.isNaN(d.getTime())) {
        fields[key] = d;
        fieldConfidence[key] =
          input.perFieldConfidence?.[key] ?? this.defaultConfidence();
      }
    };

    setStr('invoiceNumber', input.invoiceNumber);
    setDate('invoiceDate', input.invoiceDate);
    setDate('dueDate', input.dueDate);
    setStr('supplierName', input.supplierName);
    setStr('currency', input.currency?.toUpperCase());
    setNum('totalHt', input.totalHt);
    setNum('totalVat', input.vatAmount);
    setNum('totalTtc', input.totalTtc);
    setStr('poReference', input.poReference);

    if (input.lines && input.lines.length > 0) {
      const lines: OcrLineCandidate[] = input.lines
        .filter((l): l is { description: string; quantity?: number; unitPrice?: number } =>
          !!l && typeof l.description === 'string' && l.description.trim().length > 0,
        )
        .map((l) => {
          const item: OcrLineCandidate = { description: l.description.trim() };
          if (typeof l.quantity === 'number') item.quantity = l.quantity;
          if (typeof l.unitPrice === 'number') item.unitPrice = l.unitPrice;
          if (typeof l.quantity === 'number' && typeof l.unitPrice === 'number') {
            item.lineTotal = Math.round(l.quantity * l.unitPrice * 100) / 100;
          }
          return item;
        });
      if (lines.length > 0) {
        fields.lines = lines;
      }
    }

    // Confiance globale = moyenne des per-field, comme pdfparse.
    const values = Object.values(fieldConfidence);
    const confidence =
      values.length === 0
        ? 0
        : Math.round(values.reduce((s, v) => s + v, 0) / values.length);

    return {
      // Le rawText n'a pas de sens pour Vision (extraction = JSON direct).
      // On laisse une chaîne vide — le front utilise `fields`/`confidence`.
      rawText: '',
      isImageScan: false,
      confidence,
      fields,
      fieldConfidence,
    };
  }

  /**
   * Confiance par défaut quand le modèle a renseigné un champ sans
   * fournir de `perFieldConfidence` correspondante. Choix : 85 — plus
   * haut que le seuil de fallback `auto` (50) mais en-dessous des matches
   * exacts pdfparse (95), pour refléter l'incertitude d'un LLM.
   */
  private defaultConfidence(): number {
    return 85;
  }
}
