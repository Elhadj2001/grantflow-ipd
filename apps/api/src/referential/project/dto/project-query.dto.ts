import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PROJECT_STATUSES } from './create-project.dto';

export const PROJECT_SORT_FIELDS = ['code', 'title', 'startDate', 'createdAt'] as const;
export type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];

const coerceBool = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

export const ProjectQuerySchema = z
  .object({
    q: z.string().min(1).max(128).optional(),
    programId: z.string().uuid().optional(),
    piUserId: z.string().uuid().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    /**
     * Filtre rapide : projets "actifs" = `status='active'`. Distinct
     * du soft-delete `isActive` du Donor — ici on raisonne sur statut
     * métier multi-valué.
     */
    isActive: coerceBool.optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 100, 20),
    sort: z.enum(PROJECT_SORT_FIELDS).default('code'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export class ProjectQueryDto extends createZodDto(ProjectQuerySchema) {}
