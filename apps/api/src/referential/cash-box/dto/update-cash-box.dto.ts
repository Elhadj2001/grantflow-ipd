import { createZodDto } from 'nestjs-zod';
import { CreateCashBoxSchema } from './create-cash-box.dto';

/** PATCH partiel — tous les champs deviennent optionnels (sauf le code). */
export const UpdateCashBoxSchema = CreateCashBoxSchema.partial().strict();

export class UpdateCashBoxDto extends createZodDto(UpdateCashBoxSchema) {}
