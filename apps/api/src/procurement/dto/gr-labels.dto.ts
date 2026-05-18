import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Format de planche d'étiquettes. `grid-4x4` = 16 étiquettes A4 (par
 * défaut, optimal pour cartons moyens). `individual` = une étiquette
 * pleine page (gros colis qui se voit de loin).
 */
export const LABEL_FORMATS = ['grid-4x4', 'individual'] as const;
export type LabelFormat = (typeof LABEL_FORMATS)[number];

export const GrLabelsQuerySchema = z
  .object({
    /** Format d'impression. */
    format: z.enum(LABEL_FORMATS).default('grid-4x4'),
    /**
     * Nombre d'étiquettes par ligne du GR. Si 1 ligne = 5 cartons,
     * le magasinier demande count=5 → on génère QR/1, QR/2, ..., QR/5
     * pour cette ligne. La valeur par défaut 1 = une étiquette par ligne.
     */
    count: z
      .union([z.string().regex(/^\d+$/), z.number().int()])
      .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
      .pipe(z.number().int().min(1).max(64))
      .default(1),
  })
  .strict();

export class GrLabelsQueryDto extends createZodDto(GrLabelsQuerySchema) {}
