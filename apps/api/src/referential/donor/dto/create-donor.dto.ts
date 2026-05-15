import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Convention `code` : MAJUSCULES + chiffres + tirets, longueur 2-32.
 * Aligné sur les codes existants en seed (BMGF, EDCTP, UE, AFD, GAVI, CEPI,
 * WHO, USAID, IPD). Validé strictement pour éviter qu'un humain saisisse
 * "bmgf 2024" ou un code avec espace.
 */
const CODE_REGEX = /^[A-Z0-9][A-Z0-9-]{1,31}$/;

const DONOR_TYPES = [
  'public_intl',
  'private_foundation',
  'bilateral',
  'multilateral',
  'government',
  'own_funds',
] as const;

export const CreateDonorSchema = z
  .object({
    code: z
      .string()
      .regex(CODE_REGEX, 'Code must match /^[A-Z0-9][A-Z0-9-]{1,31}$/'),
    label: z.string().min(2).max(255),
    type: z.enum(DONOR_TYPES),
    country: z.string().min(2).max(64).optional(),
    contactEmail: z.string().email().max(255).optional(),
    reportingTemplateId: z.string().uuid().optional(),
  })
  .strict();

export class CreateDonorDto extends createZodDto(CreateDonorSchema) {}
