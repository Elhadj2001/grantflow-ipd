import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const coerceBool = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

const coerceInt = (min: number, max: number, def: number) =>
  z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max))
    .default(def);

const CURRENCY = z.string().regex(/^[A-Z]{3}$/);
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ExchangeRateQuerySchema = z
  .object({
    from: CURRENCY.optional(),
    to: CURRENCY.optional(),
    /** Bornes inclusives sur rate_date. */
    fromDate: ISO_DATE.optional(),
    toDate: ISO_DATE.optional(),
    isFixed: coerceBool.optional(),
    page: coerceInt(1, 10_000, 1),
    pageSize: coerceInt(1, 200, 50),
  })
  .strict();

export class ExchangeRateQueryDto extends createZodDto(ExchangeRateQuerySchema) {}

export const ExchangeRateLookupSchema = z
  .object({
    from: CURRENCY,
    to: CURRENCY,
    date: ISO_DATE.optional(),
  })
  .strict()
  .refine((v) => v.from !== v.to, {
    message: 'from and to must differ',
    path: ['to'],
  });

export class ExchangeRateLookupDto extends createZodDto(ExchangeRateLookupSchema) {}
