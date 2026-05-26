import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Types d'états financiers supportés.
 *  - TER          : Tableau des Emplois et Ressources (SYSCEBNL)
 *  - BILAN        : Actif / Passif
 *  - RESULTAT     : Compte de résultat (charges / produits)
 *  - FONDS_DEDIES : Suivi des fonds dédiés par convention (sprint F5b-a Lot 4)
 *                   Reçu / Employé / Restant à employer, rapprochement 689/19.
 */
export const StatementTypeSchema = z.enum(['TER', 'BILAN', 'RESULTAT', 'FONDS_DEDIES']);
export type StatementTypeInput = z.infer<typeof StatementTypeSchema>;

export const CreateFinancialStatementSchema = z
  .object({
    periodId: z.string().uuid(),
    type: StatementTypeSchema,
  })
  .strict();
export class CreateFinancialStatementDto extends createZodDto(CreateFinancialStatementSchema) {}
