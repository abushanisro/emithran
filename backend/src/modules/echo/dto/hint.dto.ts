import { ApiProperty } from '@nestjs/swagger';

export class HintDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Route glob this hint targets (e.g. /projects/*/bom)' })
  routeGlob!: string;

  @ApiProperty()
  topicId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ description: 'Markdown body' })
  contentMd!: string;

  @ApiProperty({ type: [String] })
  tags!: string[];
}
