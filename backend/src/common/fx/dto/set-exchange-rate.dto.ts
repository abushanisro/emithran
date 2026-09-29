import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsPositive, IsString, MaxLength } from 'class-validator';

/** Body of PUT /api/fx/exchange-rates/:currency — a new budget rate, 1 USD = rate CCY. */
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
}
