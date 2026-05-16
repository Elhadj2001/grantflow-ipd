import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO pour l'approbation d'une étape — commentaire libre, optionnel.
 * Aucun motif requis : si on rejette, on passe par `RejectDecisionDto`.
 */
export const ApproveDecisionSchema = z
  .object({
    comment: z.string().min(1).max(2000).optional(),
  })
  .strict();

export class ApproveDecisionDto extends createZodDto(ApproveDecisionSchema) {}

/**
 * DTO pour le rejet : la raison est OBLIGATOIRE (min 5 chars), pour la
 * traçabilité réglementaire (SYSCEBNL impose un motif explicite à chaque
 * refus comptable).
 */
export const RejectDecisionSchema = z
  .object({
    reason: z.string().min(5, 'reason is required (min 5 chars)').max(2000),
  })
  .strict();

export class RejectDecisionDto extends createZodDto(RejectDecisionSchema) {}

/**
 * DTO "renvoyé pour modifications" — comportement "renvoyer en draft".
 * Le commentaire est obligatoire (le demandeur doit savoir quoi corriger).
 */
export const ReturnForChangesSchema = z
  .object({
    comment: z.string().min(5, 'comment is required (min 5 chars)').max(2000),
  })
  .strict();

export class ReturnForChangesDto extends createZodDto(ReturnForChangesSchema) {}

// ---------------------------------------------------------------------------
//  Responses Swagger
// ---------------------------------------------------------------------------

export class ApprovalDecisionResponseDto {
  @ApiProperty({ format: 'uuid' })
  prId!: string;

  @ApiProperty({ example: 'pending_cg' })
  status!: string;

  @ApiProperty({
    example: 'CG',
    nullable: true,
    description: 'Rôle de la prochaine étape, null si workflow terminé',
  })
  nextStepRole!: string | null;

  @ApiProperty({
    description:
      'Présent si le demandeur a > 3 DA active(s) du même projet sur 30 jours. Non bloquant.',
    nullable: true,
  })
  splittingWarning!: { recentCount: number; projectId: string } | null;
}

export class ApprovalStepResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  stepOrder!: number;

  @ApiProperty({ required: false, nullable: true })
  approverRole!: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  approverId!: string | null;

  @ApiProperty({ example: 'pending', enum: ['pending', 'approved', 'rejected', 'returned'] })
  status!: string;

  @ApiProperty({ required: false, nullable: true, format: 'date-time' })
  decidedAt!: string | null;

  @ApiProperty({ required: false, nullable: true })
  decisionNotes!: string | null;
}
