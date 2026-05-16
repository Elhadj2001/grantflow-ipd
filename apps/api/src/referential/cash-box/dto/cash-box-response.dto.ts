import { ApiProperty } from '@nestjs/swagger';

export class CashBoxResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'CAISSE-PRINCIPALE' })
  code!: string;

  @ApiProperty({ example: 'Caisse principale IPD (XOF)' })
  label!: string;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  custodianUserId!: string | null;

  @ApiProperty({ example: 'XOF' })
  currency!: string;

  @ApiProperty({ example: 500000 })
  currentBalance!: number;

  @ApiProperty({ example: 500000 })
  ceiling!: number;

  @ApiProperty({ example: 100000 })
  perRequestMax!: number;

  @ApiProperty({ example: 200000 })
  perDayUserMax!: number;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** Détail enrichi (GET /:id) — ajoute le nombre de DA rattachées. */
export class CashBoxDetailResponseDto extends CashBoxResponseDto {
  @ApiProperty({ description: 'Nombre de DA rattachées à cette caisse' })
  prCount!: number;
}

/** Solde + plafonds (GET /:id/balance). */
export class CashBoxBalanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  cashBoxId!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  currentBalance!: number;

  @ApiProperty()
  ceiling!: number;

  @ApiProperty()
  perRequestMax!: number;

  @ApiProperty()
  perDayUserMax!: number;

  @ApiProperty({ description: 'Somme des DA cash en attente/approved du jour (toutes confondues)' })
  todayConsumed!: number;
}

export class CashBoxListResponseDto {
  @ApiProperty({ type: [CashBoxResponseDto] })
  data!: CashBoxResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  hasMore!: boolean;
}
