import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/** Body of PUT /api/exchange-rates/:currency — a new budget rate, 1 USD = rate CCY. */
export class SetExchangeRateDto {
  @ApiProperty({ example: 88.1, description: '1 USD = rate units of the currency' })
  @IsNumber()
  @IsPositive()
  rate!: number;

  @ApiProperty({ example: 'FY2027 budget rate approved by finance' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    description:
      'Apply a change larger than FX_RATE_MAX_CHANGE_PERCENT of the current rate; without it such a change is refused with 422 FX_RATE_CHANGE_NEEDS_CONFIRMATION.',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
