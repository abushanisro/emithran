import { IsUUID, IsOptional, IsNumber, IsString, IsArray, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PartWiseCostAnalysisDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  nominationId: string;

  @ApiProperty()
  bomItemId: string;

  @ApiProperty()
  vendorId: string;

  @ApiPropertyOptional()
  rawMaterialCost?: number;

  @ApiPropertyOptional()
  processCost?: number;

  @ApiPropertyOptional()
  overheadsProfit?: number;

  @ApiPropertyOptional()
  packingForwardingCost?: number;

  @ApiPropertyOptional()
  paymentTerms?: string;

  @ApiPropertyOptional()
  netPriceUnit?: number;

  @ApiPropertyOptional()
  developmentCost?: number;

  @ApiPropertyOptional()
  financialRisk?: number;

  @ApiPropertyOptional()
  costCompetencyScore?: number;

  @ApiPropertyOptional()
  leadTimeDays?: number;

  @ApiPropertyOptional()
  rankCost?: number;

  @ApiPropertyOptional()
  rankDevelopmentCost?: number;

  @ApiPropertyOptional()
  rankLeadTime?: number;

  @ApiPropertyOptional()
  totalScore?: number;

  @ApiPropertyOptional()
  overallRank?: number;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

export class PartWiseCostBaseDataDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  nominationId: string;

  @ApiProperty()
  bomItemId: string;

  @ApiPropertyOptional()
  baseRawMaterialCost?: number;

  @ApiPropertyOptional()
  baseProcessCost?: number;

  @ApiPropertyOptional()
  baseOverheadsProfit?: number;

  @ApiPropertyOptional()
  basePackingForwardingCost?: number;

  @ApiPropertyOptional()
  basePaymentTerms?: string;

  @ApiPropertyOptional()
  baseNetPriceUnit?: number;

  @ApiPropertyOptional()
  baseDevelopmentCost?: number;

  @ApiPropertyOptional()
  baseFinancialRisk?: number;

  @ApiPropertyOptional()
  baseCostCompetencyScore?: number;

  @ApiPropertyOptional()
  baseLeadTimeDays?: number;

  @ApiPropertyOptional()
  costFactorWeight?: number;

  @ApiPropertyOptional()
  developmentCostFactorWeight?: number;

  @ApiPropertyOptional()
  leadTimeFactorWeight?: number;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

class CreatePartWiseCostAnalysisDto {
  @ApiProperty()
  @IsUUID()
  nominationId: string;

  @ApiProperty()
  @IsUUID()
  bomItemId: string;

  @ApiProperty()
  @IsUUID()
  vendorId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  rawMaterialCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  processCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  overheadsProfit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  packingForwardingCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  netPriceUnit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  developmentCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  financialRisk?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  costCompetencyScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  leadTimeDays?: number;
}

class CreatePartWiseCostBaseDataDto {
  @ApiProperty()
  @IsUUID()
  nominationId: string;

  @ApiProperty()
  @IsUUID()
  bomItemId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  baseRawMaterialCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  baseProcessCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  baseOverheadsProfit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basePackingForwardingCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  basePaymentTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  baseNetPriceUnit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  baseDevelopmentCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  baseFinancialRisk?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  baseCostCompetencyScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseLeadTimeDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  costFactorWeight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  developmentCostFactorWeight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  leadTimeFactorWeight?: number;
}

export class BulkUpdatePartWiseCostAnalysisDto {
  @ApiProperty({ type: [CreatePartWiseCostAnalysisDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePartWiseCostAnalysisDto)
  vendorCostData: CreatePartWiseCostAnalysisDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePartWiseCostBaseDataDto)
  baseData?: CreatePartWiseCostBaseDataDto;
}