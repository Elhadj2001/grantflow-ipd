import { ApiProperty } from '@nestjs/swagger';
import { AXIS_TYPES } from './create-analytical-axis.dto';

export class AnalyticalAxisResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: AXIS_TYPES })
  type!: string;

  @ApiProperty({ example: 'LAB-VIRO' })
  code!: string;

  @ApiProperty({ example: 'Virologie' })
  label!: string;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  parentId!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ required: false, nullable: true, type: 'object', additionalProperties: true })
  metadata!: Record<string, unknown> | null;
}

export class AnalyticalAxisDetailResponseDto extends AnalyticalAxisResponseDto {
  @ApiProperty({ description: 'Nombre d\'enfants directs actifs' })
  childCount!: number;

  @ApiProperty({
    description: 'Chemin complet de la racine vers l\'axe, codes séparés par /',
    example: 'LAB/LAB-VIRO',
  })
  path!: string;
}

export class AnalyticalAxisTreeNodeDto extends AnalyticalAxisResponseDto {
  @ApiProperty({ type: () => [AnalyticalAxisTreeNodeDto] })
  children!: AnalyticalAxisTreeNodeDto[];
}

export class AnalyticalAxisListResponseDto {
  @ApiProperty({ type: [AnalyticalAxisResponseDto] })
  data!: AnalyticalAxisResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  hasMore!: boolean;
}
