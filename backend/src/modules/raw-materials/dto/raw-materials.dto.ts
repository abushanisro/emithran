import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';
import { Currency, MaterialShape } from '../constants/material-categories.constants';

export class CreateRawMaterialDto {
  @ApiProperty({ example: 'Plastic & Rubber' })
  @IsString()
  materialGroup: string;

  @ApiProperty({ example: 'Acrylonitrile Butadiene Styrene' })
  @IsString()
  material: string;


  @ApiPropertyOptional({ example: 'ABS' })
  @IsOptional()
  @IsString()
  materialGrade?: string;

  @ApiPropertyOptional({ example: 'Stainless Steel' })
  @IsOptional()
  @IsString()
  materialType?: string;

  @ApiPropertyOptional({ example: 'High-grade stainless steel for industrial applications' })
  @IsOptional()
  @IsString()
  materialDescription?: string;


  @ApiPropertyOptional({ example: 'Yes' })
  @IsOptional()
  @IsString()
  regrinding?: string;

  @ApiPropertyOptional({ example: 10.00 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  regrindingPercentage?: number;

  @ApiPropertyOptional({ example: 49.4 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  clampingPressureMpa?: number;

  @ApiPropertyOptional({ example: 85 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  ejectDeflectionTempC?: number;

  @ApiPropertyOptional({ example: 240 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  meltingTempC?: number;

  @ApiPropertyOptional({ example: 70 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  moldTempC?: number;

  @ApiPropertyOptional({ example: 1040 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  densityKgM3?: number;

  @ApiPropertyOptional({ example: 1.8 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  specificHeatMelt?: number;

  @ApiPropertyOptional({ example: 0.127 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  thermalConductivityMelt?: number;



  @ApiPropertyOptional({ example: 1.53 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;

  @ApiPropertyOptional({ example: 1.53 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({ enum: Currency, example: Currency.USD })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  // Regional costs (USD/kg)
  @ApiPropertyOptional({ example: 2.03 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costFrance?: number;

  @ApiPropertyOptional({ example: 2.03 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costGermany?: number;

  @ApiPropertyOptional({ example: 2.03 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costWEurope?: number;

  @ApiPropertyOptional({ example: 3.05 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costUsa?: number;

  @ApiPropertyOptional({ example: 1.53 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costIndia?: number;

  @ApiPropertyOptional({ example: 2.03 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costEEurope?: number;

  @ApiPropertyOptional({ example: 1.53 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costChina?: number;

  @ApiPropertyOptional({ example: 1.20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costMexico?: number;


  @ApiPropertyOptional({ enum: MaterialShape, example: MaterialShape.GRANULES })
  @IsOptional()
  @IsEnum(MaterialShape)
  shape?: MaterialShape;

  // Material Properties
  @ApiPropertyOptional({ example: 7.85, description: 'Density in g/cm³' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  density?: number;

  @ApiPropertyOptional({ example: 520, description: 'Ultimate Tensile Strength in MPa' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  ultimate_tensile_strength?: number;

  @ApiPropertyOptional({ example: 350, description: 'Yield Tensile Strength in MPa' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  yield_tensile_strength?: number;

  @ApiPropertyOptional({ example: 315, description: 'Shearing Strength in MPa' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  shearing_strength?: number;

  // Material Standards
  @ApiPropertyOptional({ example: 'ASTM A240' })
  @IsOptional()
  @IsString()
  astm_standard?: string;

  @ApiPropertyOptional({ example: 'DIN 1.4301' })
  @IsOptional()
  @IsString()
  din_standard?: string;

  @ApiPropertyOptional({ example: 'EN 10088-2' })
  @IsOptional()
  @IsString()
  en_standard?: string;

  @ApiPropertyOptional({ example: 'JIS SUS304' })
  @IsOptional()
  @IsString()
  jis_standard?: string;

  @ApiPropertyOptional({ example: 'India' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: 'Sheet' })
  @IsOptional()
  @IsString()
  stockForm?: string;

  @ApiPropertyOptional({ example: 'Solid' })
  @IsOptional()
  @IsString()
  matlState?: string;

  @ApiPropertyOptional({ example: 'Industrial' })
  @IsOptional()
  @IsString()
  application?: string;

  @ApiPropertyOptional({ example: 'Warehouse A' })
  @IsOptional()
  @IsString()
  location?: string;
}

export class UpdateRawMaterialDto extends PartialType(CreateRawMaterialDto) {}

export class QueryRawMaterialsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  materialGroup?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  material?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;


  @ApiPropertyOptional({ enum: Currency })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;


  @ApiPropertyOptional({ enum: MaterialShape })
  @IsOptional()
  @IsEnum(MaterialShape)
  shape?: MaterialShape;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  minCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Manufacturing family for form ranking: sheet_metal, cnc_milled, cnc_turned, casting, forging, injection_moulded' })
  @IsOptional()
  @IsString()
  partFamily?: string;
}
