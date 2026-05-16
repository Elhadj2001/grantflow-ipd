import { ApiProperty } from '@nestjs/swagger';

/**
 * Représentation transport (Swagger + front) d'un Donor.
 * Plus stricte que le modèle Prisma : on ne fuit pas `reportingTemplateId`
 * brut sans contexte, et on remplace `Date` par ISO string pour le JSON.
 */
export class DonorResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'BMGF' })
  code!: string;

  @ApiProperty({ example: 'Bill & Melinda Gates Foundation' })
  label!: string;

  @ApiProperty({
    enum: [
      'public_intl',
      'private_foundation',
      'bilateral',
      'multilateral',
      'government',
      'own_funds',
    ],
  })
  type!: string;

  @ApiProperty({ required: false, nullable: true, example: 'USA' })
  country!: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'email' })
  contactEmail!: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  reportingTemplateId!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/** Détail enrichi (GET /:id) — ajoute le nombre de grants liés. */
export class DonorDetailResponseDto extends DonorResponseDto {
  @ApiProperty({ description: 'Nombre de conventions liées à ce bailleur' })
  grantCount!: number;
}

/** Enveloppe paginée. */
export class DonorListResponseDto {
  @ApiProperty({ type: [DonorResponseDto] })
  data!: DonorResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  hasMore!: boolean;
}
