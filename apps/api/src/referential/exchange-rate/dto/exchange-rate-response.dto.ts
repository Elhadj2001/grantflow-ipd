import { ApiProperty } from '@nestjs/swagger';

export class ExchangeRateResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'EUR' })
  fromCurrency!: string;

  @ApiProperty({ example: 'XOF' })
  toCurrency!: string;

  @ApiProperty({ example: '655.95700000' })
  rate!: string;

  @ApiProperty({ format: 'date', example: '1999-01-04' })
  rateDate!: string;

  @ApiProperty({ required: false, nullable: true, example: 'BCEAO_FIXED' })
  source!: string | null;

  @ApiProperty({ description: 'true = parité fixe BCEAO (EUR/XOF). Modifiable seulement par SUPER_ADMIN.' })
  isFixed!: boolean;
}

export class ExchangeRateLookupResponseDto extends ExchangeRateResponseDto {
  @ApiProperty({
    description:
      'Indique si le taux retourné est antérieur à la date demandée (fallback historique).',
    example: false,
  })
  isFallback!: boolean;
}

export class ExchangeRateListResponseDto {
  @ApiProperty({ type: [ExchangeRateResponseDto] })
  data!: ExchangeRateResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  hasMore!: boolean;
}
