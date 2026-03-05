/**
 * Packaging & Logistics Cost DTOs
 *
 * Data Transfer Objects following 2026 best practices
 * - Proper validation with class-validator
 * - Clear separation of concerns
 * - API documentation with Swagger
 *
 * @module PackagingLogisticsCostDTO
 * @version 1.0.0
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsBoolean, IsUUID, IsEnum, Min, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

// ============================================================================
// ENUMS
// ============================================================================

export enum LogisticsType {
  PACKAGING = 'packaging',
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
  STORAGE = 'storage',
}

export enum CostBasis {
  PER_UNIT = 'per_unit',
  PER_BATCH = 'per_batch',
  PER_KG = 'per_kg',
  PER_KM = 'per_km',
}

// ============================================================================
// CREATE DTO
// ============================================================================

export class CreatePackagingLogisticsCostDto {
  @ApiProperty({ description: 'BOM item ID (UUID)' })
  @IsUUID()
  bomItemId: string;

  @ApiProperty({ description: 'Cost name/description' })
  @IsString()
  costName: string;

  @ApiProperty({ enum: LogisticsType, description: 'Type of logistics cost' })
  @IsEnum(LogisticsType)
  logisticsType: LogisticsType;

  @ApiPropertyOptional({ description: 'Mode of transport (for logistics)' })
  @IsOptional()
  @IsString()
  modeOfTransport?: string;

  @ApiPropertyOptional({ description: 'Calculator ID if using calculator' })
  @IsOptional()
  @IsUUID()
  calculatorId?: string;

  @ApiPropertyOptional({ description: 'Calculator name' })
  @IsOptional()
  @IsString()
  calculatorName?: string;

  @ApiProperty({ enum: CostBasis, description: 'Cost basis' })
  @IsEnum(CostBasis)
  costBasis: CostBasis;

  @ApiPropertyOptional({ description: 'Flexible parameters (JSONB)', type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, any>;

  @ApiProperty({ description: 'Unit cost in INR', minimum: 0 })
  @IsNumber()
  @Min(0)
  unitCost: number;

  @ApiProperty({ description: 'Quantity', minimum: 0.0001 })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ description: 'Cost breakdown details', type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  costBreakdown?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Is active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ============================================================================
// UPDATE DTO
// ============================================================================

export class UpdatePackagingLogisticsCostDto {
  @ApiPropertyOptional({ description: 'Cost name/description' })
  @IsOptional()
  @IsString()
  costName?: string;

  @ApiPropertyOptional({ enum: LogisticsType, description: 'Type of logistics cost' })
  @IsOptional()
  @IsEnum(LogisticsType)
  logisticsType?: LogisticsType;

  @ApiPropertyOptional({ description: 'Mode of transport' })
  @IsOptional()
  @IsString()
  modeOfTransport?: string;

  @ApiPropertyOptional({ description: 'Calculator ID' })
  @IsOptional()
  @IsUUID()
  calculatorId?: string;

  @ApiPropertyOptional({ description: 'Calculator name' })
  @IsOptional()
  @IsString()
  calculatorName?: string;

  @ApiPropertyOptional({ enum: CostBasis, description: 'Cost basis' })
  @IsOptional()
  @IsEnum(CostBasis)
  costBasis?: CostBasis;

  @ApiPropertyOptional({ description: 'Parameters', type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Unit cost', minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({ description: 'Quantity', minimum: 0.0001 })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Cost breakdown', type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  costBreakdown?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ============================================================================
// QUERY DTO
// ============================================================================

export class QueryPackagingLogisticsCostsDto {
  @ApiPropertyOptional({ description: 'Filter by BOM item ID' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;

  @ApiPropertyOptional({ enum: LogisticsType, description: 'Filter by logistics type' })
  @IsOptional()
  @IsEnum(LogisticsType)
  logisticsType?: LogisticsType;

  @ApiPropertyOptional({ description: 'Search by cost name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by active status', default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Page number', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', minimum: 1, maximum: 100, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}

// ============================================================================
// RESPONSE DTOs
// ============================================================================

export class PackagingLogisticsCostResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() bomItemId: string;
  @ApiProperty() userId: string;
  @ApiProperty() costName: string;
  @ApiProperty({ enum: LogisticsType }) logisticsType: LogisticsType;
  @ApiPropertyOptional() modeOfTransport?: string;
  @ApiPropertyOptional() calculatorId?: string;
  @ApiPropertyOptional() calculatorName?: string;
  @ApiProperty({ enum: CostBasis }) costBasis: CostBasis;
  @ApiPropertyOptional() parameters?: Record<string, any>;
  @ApiProperty() unitCost: number;
  @ApiProperty() quantity: number;
  @ApiProperty() totalCost: number;
  @ApiPropertyOptional() costBreakdown?: Record<string, any>;
  @ApiPropertyOptional() notes?: string;
  @ApiProperty() isActive: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class PackagingLogisticsCostListResponseDto {
  @ApiProperty({ type: [PackagingLogisticsCostResponseDto] })
  items: PackagingLogisticsCostResponseDto[];

  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
