import { ApiProperty } from '@nestjs/swagger';

export class TaxCodeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'TVA18' })
  code!: string;

  @ApiProperty({ example: 'TVA 18 % standard' })
  label!: string;

  @ApiProperty({ example: '0.1800', description: 'Taux décimal entre 0 et 1 (18 % → 0.18)' })
  rate!: string;

  @ApiProperty({ required: false, nullable: true, example: '4456' })
  accountCode!: string | null;

  @ApiProperty()
  isActive!: boolean;
}

export class TaxCodeListResponseDto {
  @ApiProperty({ type: [TaxCodeResponseDto] })
  data!: TaxCodeResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  hasMore!: boolean;
}
