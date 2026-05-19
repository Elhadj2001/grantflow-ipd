import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

// ---------------------------------------------------------------------
// Query DTOs
// ---------------------------------------------------------------------

export const BREAKDOWN_DIMENSIONS = ['account', 'cost_center', 'activity', 'period'] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

export const TRANSACTION_TYPES = ['all', 'pr', 'po', 'invoice', 'payment', 'od'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TransactionsQuerySchema = z.object({
  type: z.enum(TRANSACTION_TYPES).optional().default('all'),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  accountCode: z.string().optional(),
});
export type TransactionsQuery = z.infer<typeof TransactionsQuerySchema>;

export const BreakdownQuerySchema = z.object({
  by: z.enum(BREAKDOWN_DIMENSIONS).default('account'),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});
export type BreakdownQuery = z.infer<typeof BreakdownQuerySchema>;

// ---------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------

export class TransactionDto {
  @ApiProperty({ format: 'uuid' })
  entryId!: string;

  @ApiProperty()
  entryNumber!: string;

  @ApiProperty({ format: 'date' })
  entryDate!: string;

  @ApiProperty({ example: 'OD' })
  journal!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ nullable: true })
  sourceType!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  sourceId!: string | null;

  @ApiProperty()
  accountCode!: string;

  @ApiProperty()
  debit!: number;

  @ApiProperty()
  credit!: number;

  @ApiProperty()
  net!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  status!: string;
}

export class TransactionsResponseDto {
  @ApiProperty({ type: [TransactionDto] })
  data!: TransactionDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalDebit!: number;

  @ApiProperty()
  totalCredit!: number;
}

export class BreakdownEntryDto {
  @ApiProperty({ example: '611', description: 'Code/label de la dimension (account, cc, activity, période YYYY-MM)' })
  key!: string;

  @ApiProperty({ example: 'Achats consommables' })
  label!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty({ description: 'Part du total (0..1)' })
  share!: number;
}

export class BreakdownResponseDto {
  @ApiProperty({ enum: BREAKDOWN_DIMENSIONS })
  by!: BreakdownDimension;

  @ApiProperty()
  total!: number;

  @ApiProperty({ type: [BreakdownEntryDto] })
  entries!: BreakdownEntryDto[];
}

export class DedicatedFundsMovementDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['allocation', 'reprise'] })
  movementType!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ nullable: true })
  rationale!: string | null;

  @ApiProperty({ format: 'date-time' })
  computedAt!: string;

  @ApiProperty({ nullable: true, format: 'uuid' })
  journalEntryId!: string | null;

  @ApiProperty({ nullable: true })
  periodCode!: string | null;
}

export class DedicatedFundsResponseDto {
  @ApiProperty({ format: 'uuid' })
  grantId!: string;

  @ApiProperty()
  grantReference!: string;

  @ApiProperty({ description: 'Solde net du compte 19 imputé au grant' })
  balance!: number;

  @ApiProperty({ example: 'XOF' })
  currency!: string;

  @ApiProperty({ type: [DedicatedFundsMovementDto] })
  movements!: DedicatedFundsMovementDto[];

  @ApiProperty({ type: DedicatedFundsMovementDto, nullable: true })
  lastMovement!: DedicatedFundsMovementDto | null;
}

export class OverheadEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  periodCode!: string;

  @ApiProperty()
  eligibleBase!: number;

  @ApiProperty({ example: 0.15 })
  overheadRate!: number;

  @ApiProperty({ description: 'eligible_base × overhead_rate (calculé en base)' })
  overheadAmount!: number;

  @ApiProperty({ nullable: true, format: 'uuid' })
  journalEntryId!: string | null;

  @ApiProperty({ format: 'date-time' })
  computedAt!: string;
}

export class OverheadResponseDto {
  @ApiProperty({ format: 'uuid' })
  grantId!: string;

  @ApiProperty()
  grantReference!: string;

  @ApiProperty({ example: 0.15 })
  grantOverheadRate!: number;

  @ApiProperty({ description: 'Total overhead facturable (somme overhead_amount)' })
  totalBillable!: number;

  @ApiProperty({ description: 'Total overhead reversé (sum credits compte 754x grant)' })
  totalReversed!: number;

  @ApiProperty({ description: 'totalBillable - totalReversed' })
  variance!: number;

  @ApiProperty({ description: 'variance / totalBillable, clamp à 0 si totalBillable=0' })
  variancePercent!: number;

  @ApiProperty({ type: [OverheadEntryDto] })
  entries!: OverheadEntryDto[];
}

export class MyProjectGrantDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  reference!: string;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ format: 'date' })
  startDate!: string;

  @ApiProperty({ format: 'date' })
  endDate!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  donorCode!: string;

  @ApiProperty()
  donorLabel!: string;
}

export class MyProjectDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ type: [MyProjectGrantDto] })
  grants!: MyProjectGrantDto[];
}

export class MyProjectsResponseDto {
  @ApiPropertyOptional({ format: 'uuid' })
  piUserId?: string;

  @ApiProperty({ type: [MyProjectDto] })
  data!: MyProjectDto[];

  @ApiProperty()
  total!: number;
}
