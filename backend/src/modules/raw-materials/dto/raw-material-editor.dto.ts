import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsNumber, IsNotEmpty, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { STOCK_FORMS, STOCK_LOCATIONS } from './material-stock-price.dto';

// The one edit form: core fields, every property value, every stock price. The
// service applies the whole payload in a single transaction (migration 862).

export class EditorCoreDto {
  @ApiProperty() @IsString() @IsNotEmpty() materialGroup: string;
  @ApiProperty() @IsString() @IsNotEmpty() material: string;
  @ApiProperty({ required: false, nullable: true, description: 'The grade (memory Description), stored in description' })
  @IsOptional() @IsString() grade?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() materialType?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() materialDescription?: string | null;
  @ApiProperty({ required: false, nullable: true, description: 'USD per kg, the USA cost' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) costUsa?: number | null;
}

export class EditorPropertyDto {
  @ApiProperty() @IsString() @IsNotEmpty() propertyKey: string;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() valueNum?: number | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString() valueText?: string | null;
}

export class EditorStockPriceDto {
  @ApiProperty({ enum: STOCK_FORMS }) @IsIn(STOCK_FORMS as unknown as string[]) stockForm: string;
  @ApiProperty({ enum: STOCK_LOCATIONS }) @IsIn(STOCK_LOCATIONS as unknown as string[]) location: string;
  @ApiProperty({ description: 'USD per kg' }) @Type(() => Number) @IsNumber() @Min(0.000001) pricePerKg: number;
}

export class SaveRawMaterialEditorDto {
  @ApiProperty({ type: EditorCoreDto })
  @ValidateNested() @Type(() => EditorCoreDto)
  core: EditorCoreDto;

  @ApiProperty({ type: [EditorPropertyDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => EditorPropertyDto)
  properties: EditorPropertyDto[];

  @ApiProperty({ type: [EditorStockPriceDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => EditorStockPriceDto)
  stockPrices: EditorStockPriceDto[];
}
