import { ApiProperty } from '@nestjs/swagger';
import { ACCOUNT_CLASSES } from './create-gl-account.dto';

export class GlAccountResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '6011' })
  code!: string;

  @ApiProperty({ example: 'Achats de matières premières' })
  label!: string;

  @ApiProperty({ enum: ACCOUNT_CLASSES })
  class!: string;

  @ApiProperty({ required: false, nullable: true, example: '601' })
  parentCode!: string | null;

  @ApiProperty()
  isMovement!: boolean;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  syscebnlSpecific!: boolean;

  @ApiProperty({ required: false, nullable: true })
  description!: string | null;
}

export class GlAccountTreeNodeDto extends GlAccountResponseDto {
  @ApiProperty({ type: () => [GlAccountTreeNodeDto] })
  children!: GlAccountTreeNodeDto[];
}

export class GlAccountListResponseDto {
  @ApiProperty({ type: [GlAccountResponseDto] })
  data!: GlAccountResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  hasMore!: boolean;
}
