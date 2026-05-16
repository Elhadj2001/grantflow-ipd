import { ApiProperty } from '@nestjs/swagger';

export class PurchaseOrderLineResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  lineNumber!: number;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  unit!: string;

  @ApiProperty()
  unitPrice!: number;

  @ApiProperty()
  lineTotal!: number;

  @ApiProperty({ format: 'uuid' })
  budgetLineId!: string;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  taxCodeId!: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  prLineId!: string | null;
}

export class PurchaseOrderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'BC-2026-0001' })
  poNumber!: string;

  @ApiProperty({ format: 'uuid' })
  supplierId!: string;

  @ApiProperty({ enum: ['draft', 'sent', 'acknowledged', 'partially_received', 'received', 'invoiced', 'closed', 'cancelled'] })
  status!: string;

  @ApiProperty({ format: 'date' })
  orderDate!: string;

  @ApiProperty({ format: 'date', required: false, nullable: true })
  expectedDate!: string | null;

  @ApiProperty()
  totalHt!: number;

  @ApiProperty()
  totalVat!: number;

  @ApiProperty()
  totalTtc!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ required: false, nullable: true })
  incoterm!: string | null;

  @ApiProperty({ required: false, nullable: true })
  deliveryAddress!: string | null;

  @ApiProperty({ format: 'date-time', required: false, nullable: true })
  sentAt!: string | null;

  @ApiProperty({ format: 'date-time', required: false, nullable: true })
  acknowledgedAt!: string | null;

  @ApiProperty({ required: false, nullable: true })
  acknowledgedBy!: string | null;

  @ApiProperty({ format: 'date-time', required: false, nullable: true })
  cancelledAt!: string | null;

  @ApiProperty({ required: false, nullable: true })
  cancellationReason!: string | null;

  @ApiProperty({ required: false, nullable: true })
  pdfObjectKey!: string | null;

  @ApiProperty({ format: 'date-time', required: false, nullable: true })
  emailSentAt!: string | null;

  @ApiProperty({ required: false, nullable: true })
  emailSentTo!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class PurchaseOrderDetailResponseDto extends PurchaseOrderResponseDto {
  @ApiProperty({ type: [PurchaseOrderLineResponseDto] })
  lines!: PurchaseOrderLineResponseDto[];

  @ApiProperty({ type: [String], description: 'DA(s) liées (UUIDs)' })
  prIds!: string[];
}

export class PurchaseOrderListResponseDto {
  @ApiProperty({ type: [PurchaseOrderResponseDto] })
  data!: PurchaseOrderResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  hasMore!: boolean;
}

export class SendPoResponseDto {
  @ApiProperty({ format: 'uuid' })
  poId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  pdfObjectKey!: string;

  @ApiProperty()
  emailDelivered!: boolean;

  @ApiProperty({ required: false, nullable: true })
  emailMessageId!: string | null;

  @ApiProperty({ required: false, nullable: true })
  emailError!: string | null;

  @ApiProperty({ format: 'uuid', required: false, nullable: true })
  commitmentEntryId!: string | null;

  @ApiProperty({ required: false, nullable: true })
  commitmentEntryNumber!: string | null;
}
