import { createZodDto } from 'nestjs-zod';
import { CreateOverheadRuleSchema } from './create-overhead-rule.dto';

/** Mise à jour partielle d'une règle d'overhead. */
export const UpdateOverheadRuleSchema = CreateOverheadRuleSchema.partial();

export class UpdateOverheadRuleDto extends createZodDto(UpdateOverheadRuleSchema) {}
