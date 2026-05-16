import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Payload du POST /:id/settle (régularisation cash_advance).
 *
 *   actualSpent     : montant réellement dépensé (justifié par pièces)
 *   justifications  : commentaire libre (références factures, observations)
 */
export const SettleCashAdvanceSchema = z
  .object({
    actualSpent: z.number().nonnegative(),
    justifications: z.string().min(0).max(2000).optional(),
  })
  .strict();

export class SettleCashAdvanceDto extends createZodDto(SettleCashAdvanceSchema) {}

export class CashSettlementResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  purchaseRequestId!: string;

  @ApiProperty({ example: 75000 })
  actualSpent!: number;

  @ApiProperty({
    description: 'actualSpent - totalEngagé. Positif = à rembourser au demandeur ; négatif = reliquat retourné en caisse.',
    example: -25000,
  })
  variance!: number;

  @ApiProperty({ required: false, nullable: true })
  justifications!: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  settledBy!: string | null;

  @ApiProperty({ format: 'date-time' })
  settledAt!: string;
}

export class SettleCashAdvanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  prId!: string;

  @ApiProperty({ example: 'settled' })
  status!: string;

  @ApiProperty({ type: () => CashSettlementResponseDto })
  settlement!: CashSettlementResponseDto;
}
