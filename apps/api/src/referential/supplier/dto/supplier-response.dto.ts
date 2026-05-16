import { ApiProperty } from '@nestjs/swagger';
import { SUPPLIER_CURRENCIES } from './create-supplier.dto';

export class SupplierResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'THERMO_FISHER' })
  code!: string;

  @ApiProperty({ example: 'Thermo Fisher Scientific' })
  name!: string;

  @ApiProperty({ required: false, nullable: true })
  vatNumber!: string | null;

  @ApiProperty({ required: false, nullable: true })
  address!: string | null;

  @ApiProperty({ required: false, nullable: true })
  country!: string | null;

  @ApiProperty({ required: false, nullable: true })
  iban!: string | null;

  @ApiProperty({ required: false, nullable: true })
  bic!: string | null;

  @ApiProperty({ required: false, nullable: true })
  bankName!: string | null;

  @ApiProperty({ example: 30 })
  paymentTermsDays!: number;

  @ApiProperty({ enum: SUPPLIER_CURRENCIES })
  currencyDefault!: string;

  @ApiProperty({ required: false, nullable: true, minimum: 0, maximum: 100 })
  riskScore!: number | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class SupplierDetailResponseDto extends SupplierResponseDto {
  @ApiProperty({ description: 'Nombre de bons de commande liés (tous statuts confondus)' })
  poCount!: number;
}

export class SupplierListResponseDto {
  @ApiProperty({ type: [SupplierResponseDto] })
  data!: SupplierResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  hasMore!: boolean;
}
