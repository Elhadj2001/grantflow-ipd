import { ApiProperty } from '@nestjs/swagger';
import { GRANT_STATUSES, SUPPORTED_CURRENCIES } from './create-grant.dto';

export class GrantResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'BMGF-2023-117' })
  reference!: string;

  @ApiProperty({ format: 'uuid' })
  donorId!: string;

  @ApiProperty({ format: 'uuid' })
  projectId!: string;

  @ApiProperty({ example: '485000.00' })
  amount!: string;

  @ApiProperty({ enum: SUPPORTED_CURRENCIES })
  currency!: string;

  @ApiProperty({ example: '0.1500' })
  overheadRate!: string;

  @ApiProperty({ format: 'date' })
  startDate!: string;

  @ApiProperty({ format: 'date' })
  endDate!: string;

  @ApiProperty({ enum: GRANT_STATUSES })
  status!: string;

  @ApiProperty({ required: false, nullable: true, format: 'date' })
  signedAt!: string | null;

  @ApiProperty({ required: false, nullable: true })
  notes!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class GrantBudgetLineEntryDto {
  @ApiProperty({ format: 'uuid' })
  budgetLineId!: string;

  @ApiProperty({ example: 'L01' })
  code!: string;

  @ApiProperty({ example: 'Consommables' })
  label!: string;

  @ApiProperty()
  budgeted!: number;

  @ApiProperty()
  engaged!: number;

  @ApiProperty()
  consumed!: number;

  @ApiProperty()
  available!: number;

  @ApiProperty({ example: 0.769, description: 'engaged / budgeted, clamp [0, ∞)' })
  utilization!: number;
}

export class GrantDashboardResponseDto {
  @ApiProperty({ example: 'BMGF-2023-117' })
  grantRef!: string;

  @ApiProperty()
  totalBudgeted!: number;

  @ApiProperty()
  totalEngaged!: number;

  @ApiProperty()
  totalConsumed!: number;

  @ApiProperty()
  totalAvailable!: number;

  @ApiProperty({ example: 0.587 })
  utilization!: number;

  @ApiProperty({ type: [GrantBudgetLineEntryDto] })
  byBudgetLine!: GrantBudgetLineEntryDto[];

  @ApiProperty({ description: 'Mois calendaires restants jusqu\'à endDate', example: 19 })
  monthsRemaining!: number;

  @ApiProperty({ type: [String], example: ['L02 à 91% utilisé', 'Échéance bailleur dans 28 jours'] })
  alerts!: string[];
}

export class GrantListResponseDto {
  @ApiProperty({ type: [GrantResponseDto] })
  data!: GrantResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  hasMore!: boolean;
}
