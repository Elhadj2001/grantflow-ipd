import { createZodDto } from 'nestjs-zod';
import { CreateDonorSchema } from './create-donor.dto';

/**
 * Update partiel (PATCH). Reprend les contraintes de `CreateDonorSchema`
 * mais tous les champs deviennent optionnels.
 *
 * Pour un PUT (replace total), on accepte le même schéma mais le service
 * exige que TOUS les champs requis du Create soient présents — c'est
 * la couche métier qui distingue, pas la validation Zod (cf. service).
 */
export const UpdateDonorSchema = CreateDonorSchema.partial();

export class UpdateDonorDto extends createZodDto(UpdateDonorSchema) {}
