import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/** Reflète l'enum `procurement.pr_status` côté BD. */
export const PR_STATUSES = [
  'draft',
  'submitted',
  'pending_pi',
  'pending_cg',
  'pending_daf',
  'approved',
  'rejected',
  'cancelled',
  'closed',
] as const;
export type PrStatusLiteral = (typeof PR_STATUSES)[number];

export const PR_SORT_FIELDS = ['prNumber', 'requestedAt', 'totalAmount', 'status'] as const;

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be ISO 8601 YYYY-MM-DD');

export const PurchaseRequestQuerySchema = z
  .object({
    q: z.string().min(1).max(128).optional(),
    status: z.enum(PR_STATUSES).optional(),
    projectId: z.string().uuid().optional(),
    grantId: z.string().uuid().optional(),
    /** Si fourni : limite à cet UUID requesteur — passé typiquement par un admin. */
    requestedBy: z.string().uuid().optional(),
    /** Bornes inclusives sur requested_at. */
    fromDate: ISO_DATE.optional(),
    toDate: ISO_DATE.optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 100, 20),
    sort: z.enum(PR_SORT_FIELDS).default('requestedAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export class PurchaseRequestQueryDto extends createZodDto(PurchaseRequestQuerySchema) {}
