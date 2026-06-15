import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SuggestionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiPropertyOptional({ description: 'Route to navigate to if user accepts' })
  ctaRoute?: string;

  @ApiPropertyOptional()
  ctaLabel?: string;

  @ApiProperty({ enum: ['static', 'dynamic'] })
  source!: 'static' | 'dynamic';
}
