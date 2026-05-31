import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PrStatus } from '@prisma/client';

/**
 * Reflète l'enum `procurement.pr_status` côté BD. Dérivé directement de
 * l'enum Prisma `PrStatus` pour garantir qu'aucun statut ne peut être
 * oublié ici quand le DDL évolue.
 *
 * ⚠️ Fix `fix-pr-status-enum-alignment` : le tableau littéral précédent
 * oubliait `pending_caissier` et `settled`, ce qui faisait planter en
 * 400 BadRequest tout GET `/purchase-requests?status=<missing>` — vu en
 * pratique sur le KPI "DA en attente" du dashboard. On évite désormais
 * la double maintenance manuelle en passant par `Object.values(PrStatus)`.
 */
export const PR_STATUSES = Object.values(PrStatus) as readonly PrStatus[];
export type PrStatusLiteral = PrStatus;

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
    status: z.nativeEnum(PrStatus).optional(),
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
