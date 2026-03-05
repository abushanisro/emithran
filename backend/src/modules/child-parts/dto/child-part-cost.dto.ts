/**
 * Child Part Cost DTOs
 *
 * Data Transfer Objects for child part cost calculations API
 * Provides validation, type safety, and OpenAPI documentation
 *
 * @author Manufacturing Cost Engineering Team
 * @version 1.0.0
 */

import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsUUID,
  IsNumber,
  IsEnum,
  Min,
  Max,
  IsBoolean,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Make/Buy enum for child parts
 */
export enum MakeBuyType {
  MAKE = 'make',
  BUY = 'buy',
}

/**
 * DTO for creating a child part cost record
 */
export class CreateChildPartCostDto {
  @ApiProperty({ description: 'BOM item ID this cost record belongs to' })
  @IsUUID()
  bomItemId: string;

  @ApiPropertyOptional({ description: 'Part number' })
  @IsOptional()
  @IsString()
  partNumber?: string;

  @ApiPropertyOptional({ description: 'Part name' })
  @IsOptional()
  @IsString()
  partName?: string;

  @ApiPropertyOptional({ description: 'Part description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    enum: MakeBuyType,
    description: 'Make or buy decision',
    example: MakeBuyType.BUY,
  })
  @IsEnum(MakeBuyType)
  makeBuy: MakeBuyType;

  // Purchased Part Fields (makeBuy = 'buy')
  @ApiPropertyOptional({
    description: 'Unit cost for purchased parts (INR)',
    example: 125.50,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000000)
  unitCost?: number;

  @ApiPropertyOptional({
    description: 'Freight percentage (0-100%)',
    example: 5.0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  freight?: number;

  @ApiPropertyOptional({
    description: 'Import duty percentage (0-100%)',
    example: 10.0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  duty?: number;

  @ApiPropertyOptional({
    description: 'Overhead percentage (0-500%)',
    example: 15.0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  overhead?: number;

  // Manufactured Part Fields (makeBuy = 'make')
  @ApiPropertyOptional({
    description: 'Raw material cost for manufactured parts (INR)',
    example: 75.25,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rawMaterialCost?: number;

  @ApiPropertyOptional({
    description: 'Process cost for manufactured parts (INR)',
    example: 50.00,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  processCost?: number;

  // Quality Parameters
  @ApiPropertyOptional({
    description: 'Scrap percentage (0-50%)',
    example: 2.0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  scrap?: number;

  @ApiPropertyOptional({
    description: 'Defect rate percentage (0-50%)',
    example: 1.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  defectRate?: number;

  // Quantity Parameters
  @ApiPropertyOptional({
    description: 'Quantity per parent assembly',
    example: 4,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  quantity?: number;

  @ApiPropertyOptional({
    description: 'Minimum order quantity (MOQ)',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  moq?: number;

  @ApiPropertyOptional({
    description: 'Lead time in days',
    example: 30,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(365)
  leadTimeDays?: number;

  // Currency
  @ApiPropertyOptional({
    description: 'Currency code',
    example: 'INR',
    default: 'INR',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  // Supplier Information
  @ApiPropertyOptional({ description: 'Supplier ID' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Supplier name' })
  @IsOptional()
  @IsString()
  supplierName?: string;

  @ApiPropertyOptional({ description: 'Supplier location' })
  @IsOptional()
  @IsString()
  supplierLocation?: string;

  // Metadata
  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Is record active', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * DTO for updating a child part cost record
 */
export class UpdateChildPartCostDto extends PartialType(CreateChildPartCostDto) { }

/**
 * DTO for querying child part cost records
 */
export class QueryChildPartCostsDto {
  @ApiPropertyOptional({ description: 'BOM item ID to filter by' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;

  @ApiPropertyOptional({ description: 'Make/buy filter', enum: MakeBuyType })
  @IsOptional()
  @IsEnum(MakeBuyType)
  makeBuy?: MakeBuyType;

  @ApiPropertyOptional({ description: 'Search term for part number or name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Page number', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 10, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}

/**
 * DTO for child part cost response
 */
export class ChildPartCostResponseDto {
  @ApiProperty({ description: 'Unique identifier' })
  id: string;

  @ApiProperty({ description: 'BOM item ID' })
  bomItemId: string;

  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'Part number' })
  partNumber: string;

  @ApiProperty({ description: 'Part name' })
  partName: string;

  @ApiProperty({ description: 'Make/buy decision', enum: MakeBuyType })
  makeBuy: MakeBuyType;

  @ApiProperty({ description: 'Currency code' })
  currency: string;

  // Cost Components
  @ApiProperty({ description: 'Base cost (unit cost or raw+process)' })
  baseCost: number;

  @ApiProperty({ description: 'Freight cost' })
  freightCost: number;

  @ApiProperty({ description: 'Duty cost' })
  dutyCost: number;

  @ApiProperty({ description: 'Overhead cost' })
  overheadCost: number;

  @ApiProperty({ description: 'Cost before quality adjustments' })
  costBeforeQuality: number;

  @ApiProperty({ description: 'Scrap adjustment' })
  scrapAdjustment: number;

  @ApiProperty({ description: 'Defect adjustment' })
  defectAdjustment: number;

  @ApiProperty({ description: 'Total cost per part (final)' })
  totalCostPerPart: number;

  @ApiProperty({ description: 'Extended cost (total × quantity)' })
  extendedCost: number;

  // Quality Parameters
  @ApiProperty({ description: 'Scrap percentage' })
  scrapPercentage: number;

  @ApiProperty({ description: 'Defect rate percentage' })
  defectRatePercentage: number;

  @ApiProperty({ description: 'Quality factor (combined scrap & defect)' })
  qualityFactor: number;

  // Quantity Economics
  @ApiProperty({ description: 'Quantity per parent assembly' })
  quantity: number;

  @ApiProperty({ description: 'Minimum order quantity' })
  moq: number;

  @ApiProperty({ description: 'Lead time in days' })
  leadTimeDays: number;

  @ApiProperty({ description: 'Extended cost for MOQ' })
  moqExtendedCost: number;

  // Detailed Breakdown
  @ApiProperty({ description: 'Complete calculation breakdown', type: 'object', additionalProperties: true })
  calculationBreakdown: Record<string, any>;

  // Metadata
  @ApiProperty({ description: 'Is record active' })
  isActive: boolean;

  @ApiProperty({ description: 'Supplier ID', required: false })
  supplierId?: string;

  @ApiProperty({ description: 'Supplier name', required: false })
  supplierName?: string;

  @ApiProperty({ description: 'Supplier location', required: false })
  supplierLocation?: string;

  @ApiProperty({ description: 'Additional notes', required: false })
  notes?: string;

  @ApiProperty({ description: 'Created at timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at timestamp' })
  updatedAt: Date;

  /**
   * Transform database record to DTO
   */
  static fromDatabase(record: any): ChildPartCostResponseDto {
    return {
      id: record.id,
      bomItemId: record.bom_item_id,
      userId: record.user_id,
      partNumber: record.part_number || '',
      partName: record.part_name || '',
      makeBuy: record.make_buy,
      currency: record.currency || 'INR',
      baseCost: parseFloat(record.base_cost) || 0,
      freightCost: parseFloat(record.freight_cost) || 0,
      dutyCost: parseFloat(record.duty_cost) || 0,
      overheadCost: parseFloat(record.overhead_cost) || 0,
      costBeforeQuality: parseFloat(record.cost_before_quality) || 0,
      scrapAdjustment: parseFloat(record.scrap_adjustment) || 0,
      defectAdjustment: parseFloat(record.defect_adjustment) || 0,
      totalCostPerPart: parseFloat(record.total_cost_per_part) || 0,
      extendedCost: parseFloat(record.extended_cost) || 0,
      scrapPercentage: parseFloat(record.scrap_percentage) || 0,
      defectRatePercentage: parseFloat(record.defect_rate_percentage) || 0,
      qualityFactor: parseFloat(record.quality_factor) || 1,
      quantity: parseFloat(record.quantity) || 1,
      moq: parseFloat(record.moq) || 1,
      leadTimeDays: parseFloat(record.lead_time_days) || 0,
      moqExtendedCost: parseFloat(record.moq_extended_cost) || 0,
      calculationBreakdown: record.calculation_breakdown || {},
      isActive: record.is_active !== false,
      supplierId: record.supplier_id,
      supplierName: record.supplier_name,
      supplierLocation: record.supplier_location,
      notes: record.notes,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    };
  }
}

/**
 * DTO for child part cost list response with pagination
 */
export class ChildPartCostListResponseDto {
  @ApiProperty({ description: 'Child part cost records', type: [ChildPartCostResponseDto] })
  childPartCosts: ChildPartCostResponseDto[];

  @ApiProperty({ description: 'Total count' })
  count: number;

  @ApiProperty({ description: 'Current page' })
  page: number;

  @ApiProperty({ description: 'Items per page' })
  limit: number;
}

/**
 * DTO for calculating child part cost without saving
 */
export class CalculateChildPartCostDto {
  @ApiProperty({
    enum: MakeBuyType,
    description: 'Make or buy decision',
    example: MakeBuyType.BUY,
  })
  @IsEnum(MakeBuyType)
  makeBuy: MakeBuyType;

  @ApiPropertyOptional({ description: 'Part number' })
  @IsOptional()
  @IsString()
  partNumber?: string;

  @ApiPropertyOptional({ description: 'Part name' })
  @IsOptional()
  @IsString()
  partName?: string;

  @ApiPropertyOptional({ description: 'Unit cost for purchased parts (INR)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({ description: 'Freight percentage' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  freight?: number;

  @ApiPropertyOptional({ description: 'Duty percentage' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  duty?: number;

  @ApiPropertyOptional({ description: 'Overhead percentage' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  overhead?: number;

  @ApiPropertyOptional({ description: 'Raw material cost' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rawMaterialCost?: number;

  @ApiPropertyOptional({ description: 'Process cost' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  processCost?: number;

  @ApiPropertyOptional({ description: 'Scrap percentage' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  scrap?: number;

  @ApiPropertyOptional({ description: 'Defect rate percentage' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  defectRate?: number;

  @ApiPropertyOptional({ description: 'Quantity per parent' })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Minimum order quantity' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  moq?: number;

  @ApiPropertyOptional({ description: 'Lead time in days' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  leadTimeDays?: number;

  @ApiPropertyOptional({ description: 'Currency code', default: 'INR' })
  @IsOptional()
  @IsString()
  currency?: string;
}
