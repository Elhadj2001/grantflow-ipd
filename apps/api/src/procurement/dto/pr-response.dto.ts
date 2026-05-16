import { ApiProperty } from '@nestjs/swagger';
import { PR_STATUSES } from './pr-query.dto';

export class PurchaseRequestLineResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  lineNumber!: number;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  quantity!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty()
  unitPrice!: string;

  @ApiProperty()
  lineTotal!: string;

  @ApiProperty({ format: 'uuid' })
  budgetLineId!: string;
}

export class PurchaseRequestResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'DA-2026-0001' })
  prNumber!: string;

  @ApiProperty({ format: 'uuid' })
  requestedBy!: string;

  @ApiProperty({ format: 'date-time' })
  requestedAt!: string;

  @ApiProperty({ required: false, nullable: true, format: 'date' })
  neededBy!: string | null;

  @ApiProperty({ enum: PR_STATUSES })
  status!: string;

  @ApiProperty({ format: 'uuid' })
  projectId!: string;

  @ApiProperty({ format: 'uuid' })
  grantId!: string;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  costCenterId!: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  activityId!: string | null;

  @ApiProperty()
  totalAmount!: string;

  @ApiProperty({ example: 'XOF' })
  currency!: string;

  @ApiProperty({ required: false, nullable: true })
  description!: string | null;
}

export class PurchaseRequestDetailResponseDto extends PurchaseRequestResponseDto {
  @ApiProperty({ type: [PurchaseRequestLineResponseDto] })
  lines!: PurchaseRequestLineResponseDto[];
}

export class PurchaseRequestListResponseDto {
  @ApiProperty({ type: [PurchaseRequestResponseDto] })
  data!: PurchaseRequestResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  hasMore!: boolean;
}
