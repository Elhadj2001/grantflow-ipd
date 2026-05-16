import { ApiProperty } from '@nestjs/swagger';
import { PROJECT_STATUSES } from './create-project.dto';

export class ProjectResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'MADIBA-VAC-2024' })
  code!: string;

  @ApiProperty({ example: 'Madiba vaccine accelerator 2024' })
  title!: string;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  programId!: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  piUserId!: string | null;

  @ApiProperty({ format: 'date', example: '2024-01-01' })
  startDate!: string;

  @ApiProperty({ required: false, nullable: true, format: 'date', example: '2026-12-31' })
  endDate!: string | null;

  @ApiProperty({ enum: PROJECT_STATUSES })
  status!: string;

  @ApiProperty({ required: false, nullable: true })
  description!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ProjectDetailResponseDto extends ProjectResponseDto {
  @ApiProperty({ description: 'Nombre de conventions liées à ce projet' })
  grantCount!: number;
}

export class ProjectListResponseDto {
  @ApiProperty({ type: [ProjectResponseDto] })
  data!: ProjectResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  hasMore!: boolean;
}
