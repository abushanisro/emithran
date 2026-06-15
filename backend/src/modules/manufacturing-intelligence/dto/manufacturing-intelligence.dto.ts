import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional, IsString, IsNumber, IsBoolean, IsDateString,
  Min, Max, IsUUID, IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class QueryCompatibilityDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Aluminium 6061' })
  @IsOptional()
  @IsString()
  material?: string;

  @ApiPropertyOptional({ example: 'CNC Milling' })
  @IsOptional()
  @IsString()
  process?: string;

  @ApiPropertyOptional({ example: 7, description: 'Minimum suitability score (1-10)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10)
  minScore?: number;
}

export class QueryFeatureCostRulesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'CNC Machining' })
  @IsOptional()
  @IsString()
  processCategory?: string;

  @ApiPropertyOptional({ example: 'Through Hole' })
  @IsOptional()
  @IsString()
  featureType?: string;
}

export class QueryDfmRulesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Injection Moulding' })
  @IsOptional()
  @IsString()
  processName?: string;

  @ApiPropertyOptional({ example: 'Critical', enum: ['Critical', 'Warning', 'Advisory'] })
  @IsOptional()
  @IsString()
  @IsIn(['Critical', 'Warning', 'Advisory'])
  severity?: string;

  @ApiPropertyOptional({ example: 'Very High', enum: ['Low', 'Medium', 'High', 'Very High'] })
  @IsOptional()
  @IsString()
  @IsIn(['Low', 'Medium', 'High', 'Very High'])
  costImpact?: string;
}

export class QuerySupplierKpiDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Automotive' })
  @IsOptional()
  @IsString()
  industrySector?: string;

  @ApiPropertyOptional({ example: 'Quality' })
  @IsOptional()
  @IsString()
  kpiCategory?: string;
}

export class QueryCommodityPricesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'LME-AL' })
  @IsOptional()
  @IsString()
  commodityCode?: string;

  @ApiPropertyOptional({ example: '2023-01-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2024-12-31' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class QuerySupplierPerformanceDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Acme Machining' })
  @IsOptional()
  @IsString()
  supplierName?: string;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @IsDateString()
  periodFrom?: string;

  @ApiPropertyOptional({ example: '2024-12-31' })
  @IsOptional()
  @IsDateString()
  periodTo?: string;
}

export class CreateSupplierPerformanceDto {
  @ApiProperty({ example: 'Acme Machining Pvt Ltd' })
  @IsString()
  supplierName: string;

  @ApiPropertyOptional({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiProperty({ example: '2024-01-01' })
  @IsDateString()
  periodStart: string;

  @ApiProperty({ example: '2024-03-31' })
  @IsDateString()
  periodEnd: string;

  @ApiPropertyOptional({ example: 97.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  onTimeDeliveryPct?: number;

  @ApiPropertyOptional({ example: 450 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  qualityPpm?: number;

  @ApiPropertyOptional({ example: 98.2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  firstPassYieldPct?: number;

  @ApiPropertyOptional({ example: -2.5, description: 'Negative = under budget' })
  @IsOptional()
  @IsNumber()
  costVariancePct?: number;

  @ApiPropertyOptional({ example: 28 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  leadTimeDays?: number;

  @ApiPropertyOptional({ example: 4, description: '1-5 scale' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  responsivenessScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateSupplierPerformanceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  supplierName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  onTimeDeliveryPct?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  qualityPpm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  firstPassYieldPct?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  costVariancePct?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  leadTimeDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  responsivenessScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
