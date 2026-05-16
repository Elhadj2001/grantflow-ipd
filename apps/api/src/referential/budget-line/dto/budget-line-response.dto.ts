import { ApiProperty } from '@nestjs/swagger';

export class BudgetLineResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  grantId!: string;

  @ApiProperty({ example: 'L01' })
  code!: string;

  @ApiProperty({ example: 'Consommables' })
  label!: string;

  @ApiProperty({ example: '38000.00' })
  budgetedAmount!: string;

  @ApiProperty({ required: false, nullable: true, example: '6111' })
  defaultAccount!: string | null;

  @ApiProperty()
  isOverheadEligible!: boolean;

  @ApiProperty()
  isActive!: boolean;
}

export class BudgetLineListResponseDto {
  @ApiProperty({ type: [BudgetLineResponseDto] })
  data!: BudgetLineResponseDto[];

  @ApiProperty()
  total!: number;
}

/** Erreur ligne par ligne lors d'un import bulk. */
export class BulkImportRowErrorDto {
  @ApiProperty({ description: 'Numéro de ligne dans le fichier xlsx (1-indexé, header exclus)' })
  row!: number;

  @ApiProperty()
  message!: string;
}

export class BulkImportResponseDto {
  @ApiProperty({ description: 'Nombre de lignes créées (transactionnel — 0 si rollback)' })
  created!: number;

  @ApiProperty({ type: [BulkImportRowErrorDto] })
  errors!: BulkImportRowErrorDto[];
}
