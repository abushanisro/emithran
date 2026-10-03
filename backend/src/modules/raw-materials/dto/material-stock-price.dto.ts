import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const STOCK_FORMS = [
  'round_bar', 'hex_bar', 'rectangular_bar', 'square_bar', 'round_tube', 'square_tube',
  'rectangular_tube', 'plate', 'angle_bar', 'channel_bar', 'i_beam', 't_beam', 'sheet',
] as const;
export const STOCK_LOCATIONS = ['USA', 'India'] as const;

export class UpsertMaterialStockPriceDto {
  @ApiProperty({ enum: STOCK_FORMS })
  @IsIn(STOCK_FORMS as unknown as string[])
  stockForm: string;

  @ApiProperty({ enum: STOCK_LOCATIONS })
  @IsIn(STOCK_LOCATIONS as unknown as string[])
  location: string;

  @ApiProperty({ description: 'USD per kg' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  pricePerKg: number;
}
