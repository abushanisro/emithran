/**
 * Procured Parts Cost DTOs
 *
 * Production-grade Data Transfer Objects
 * - Input validation with class-validator
 * - API documentation with Swagger decorators
 * - Type safety with TypeScript
 *
 * @module ProcuredPartsCostDTO
 * @version 1.0.0
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsBoolean, IsUUID, Min, Max, IsObject, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

// ============================================================================
// CREATE DTO
// ============================================================================

export class CreateProcuredPartsCostDto {
  @ApiProperty({ description: 'BOM item ID (UUID)' })
  @IsUUID()
  bomItemId: string;

  @ApiProperty({ description: 'Part name' })
  @IsString()
  partName: string;

  @ApiPropertyOptional({ description: 'Part number/SKU' })
  @IsOptional()
  @IsString()
  partNumber?: string;

  @ApiPropertyOptional({ description: 'Supplier name' })
  @IsOptional()
  @IsString()
  supplierName?: string;

  @ApiPropertyOptional({ description: 'Supplier ID (UUID)' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiProperty({ description: 'Unit cost in INR', minimum: 0 })
  @IsNumber()
  @Min(0)
  unitCost: number;

  @ApiProperty({ description: 'Quantity', minimum: 0.0001 })
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ description: 'Scrap percentage (0-100)', minimum: 0, maximum: 100, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  scrapPercentage?: number;

  @ApiPropertyOptional({ description: 'Defect rate percentage (0-100)', minimum: 0, maximum: 100, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  defectRatePercentage?: number;

  @ApiPropertyOptional({ description: 'Overhead percentage (0-1000)', minimum: 0, maximum: 1000, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  overheadPercentage?: number;

  @ApiPropertyOptional({ description: 'Freight cost in INR', minimum: 0, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  freightCost?: number;

  @ApiPropertyOptional({ description: 'Duty cost in INR', minimum: 0, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dutyCost?: number;

  @ApiPropertyOptional({ description: 'Minimum Order Quantity', minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  moq?: number;

  @ApiPropertyOptional({ description: 'Lead time in days', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @ApiPropertyOptional({ description: 'Currency code', default: 'INR' })
  @IsOptional()
  @IsString()
  currency?: string;

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

export class UpdateProcuredPartsCostDto {
  @ApiPropertyOptional({ description: 'Part name' })
  @IsOptional()
  @IsString()
  partName?: string;

  @ApiPropertyOptional({ description: 'Part number/SKU' })
  @IsOptional()
  @IsString()
  partNumber?: string;

  @ApiPropertyOptional({ description: 'Supplier name' })
  @IsOptional()
  @IsString()
  supplierName?: string;

  @ApiPropertyOptional({ description: 'Supplier ID' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

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

  @ApiPropertyOptional({ description: 'Scrap percentage', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  scrapPercentage?: number;

  @ApiPropertyOptional({ description: 'Defect rate percentage', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  defectRatePercentage?: number;

  @ApiPropertyOptional({ description: 'Overhead percentage', minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  overheadPercentage?: number;

  @ApiPropertyOptional({ description: 'Freight cost', minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  freightCost?: number;

  @ApiPropertyOptional({ description: 'Duty cost', minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dutyCost?: number;

  @ApiPropertyOptional({ description: 'MOQ', minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  moq?: number;

  @ApiPropertyOptional({ description: 'Lead time in days', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @ApiPropertyOptional({ description: 'Currency code' })
  @IsOptional()
  @IsString()
  currency?: string;

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

export class QueryProcuredPartsCostsDto {
  @ApiPropertyOptional({ description: 'Filter by BOM item ID' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;

  @ApiPropertyOptional({ description: 'Filter by supplier name' })
  @IsOptional()
  @IsString()
  supplierName?: string;

  @ApiPropertyOptional({ description: 'Search by part name' })
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

export class ProcuredPartsCostResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() bomItemId: string;
  @ApiProperty() userId: string;
  @ApiProperty() partName: string;
  @ApiPropertyOptional() partNumber?: string;
  @ApiPropertyOptional() supplierName?: string;
  @ApiPropertyOptional() supplierId?: string;
  @ApiProperty() unitCost: number;
  @ApiProperty() quantity: number;
  @ApiProperty() scrapPercentage: number;
  @ApiProperty() defectRatePercentage: number;
  @ApiProperty() overheadPercentage: number;
  @ApiProperty() freightCost: number;
  @ApiProperty() dutyCost: number;
  @ApiProperty() baseCost: number;
  @ApiProperty() scrapAdjustment: number;
  @ApiProperty() defectAdjustment: number;
  @ApiProperty() overheadCost: number;
  @ApiProperty() totalCost: number;
  @ApiPropertyOptional() moq?: number;
  @ApiPropertyOptional() leadTimeDays?: number;
  @ApiProperty() currency: string;
  @ApiPropertyOptional() costBreakdown?: Record<string, any>;
  @ApiPropertyOptional() notes?: string;
  @ApiProperty() isActive: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ProcuredPartsCostListResponseDto {
  @ApiProperty({ type: [ProcuredPartsCostResponseDto] })
  items: ProcuredPartsCostResponseDto[];

  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
