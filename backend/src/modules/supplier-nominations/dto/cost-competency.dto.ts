import { IsString, IsUUID, IsOptional, IsNumber, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CostVendorValueDto {
  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiProperty()
  @IsUUID()
  vendorId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  numericValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  textValue?: string;
}

export class CostCompetencyAnalysisDto {
  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiProperty()
  @IsUUID()
  nominationEvaluationId: string;

  @ApiProperty()
  @IsString()
  costComponent: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  baseValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  basePaymentTerm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiProperty()
  @IsBoolean()
  isRanking: boolean;

  @ApiProperty()
  @IsNumber()
  sortOrder: number;

  @ApiProperty({ type: [CostVendorValueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CostVendorValueDto)
  vendorValues: CostVendorValueDto[];
}

export class UpdateCostValueDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  baseValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  basePaymentTerm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  numericValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  textValue?: string;
}

export class VendorValueUpdateDto {
  @ApiProperty()
  @IsUUID()
  vendorId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  numericValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  textValue?: string;
}

export class CostComponentUpdateDto {
  @ApiProperty()
  @IsString()
  costComponent: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  baseValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  basePaymentTerm?: string;

  @ApiProperty({ type: [VendorValueUpdateDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VendorValueUpdateDto)
  vendorValues: VendorValueUpdateDto[];
}

export class BulkUpdateCostDataDto {
  @ApiProperty({ type: [CostComponentUpdateDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CostComponentUpdateDto)
  components: CostComponentUpdateDto[];
}