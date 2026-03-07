/**
 * Tooling Cost DTOs (INR-Native)
 *
 * Data Transfer Objects for Tooling Cost calculation API
 * All monetary values in INR (₹)
 *
 * @author Manufacturing Cost Engineering Team
 * @version 1.0.0 (INR-Native)
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for creating a new tooling cost record
 * All costs in INR (₹)
 */
export class CreateToolingCostDto {
  @ApiProperty({ description: 'Type of tooling', example: 'cutting_tool' })
  @IsString()
  toolingType: string;

  @ApiProperty({ description: 'Description of the tooling item', example: 'End Mill - 10mm Carbide' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ description: 'Technical specifications', example: '4-flute, TiAlN coated, for steel' })
  @IsOptional()
  @IsString()
  specifications?: string;

  @ApiProperty({ description: 'Unit cost in INR (₹/unit)', example: 2500.0 })
  @IsNumber()
  @Min(0)
  @Max(10000000)
  unitCost: number;

  @ApiProperty({ description: 'Quantity required', example: 1.0 })
  @IsNumber()
  @Min(0)
  @Max(1000000)
  quantity: number;

  @ApiProperty({ description: 'Number of parts to amortize tooling cost over', example: 10000 })
  @IsNumber()
  @Min(1)
  @Max(100000000)
  amortizationParts: number;

  @ApiProperty({ description: 'Percentage of tooling capacity used (0-100)', example: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  usagePercentage: number;

  @ApiProperty({ description: 'Is this custom tooling', example: false })
  @IsBoolean()
  isCustom: boolean;

  @ApiPropertyOptional({ description: 'Supplier information', example: 'Sandvik Coromant' })
  @IsOptional()
  @IsString()
  supplier?: string;

  @ApiPropertyOptional({ description: 'Lead time in days', example: 14 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(365)
  leadTime?: number;

  @ApiPropertyOptional({ description: 'Notes or comments' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Is the record active', example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'BOM item ID to link this cost to' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;
}

/**
 * DTO for updating an existing tooling cost record
 */
export class UpdateToolingCostDto {
  @ApiPropertyOptional({ description: 'Type of tooling' })
  @IsOptional()
  @IsString()
  toolingType?: string;

  @ApiPropertyOptional({ description: 'Description of the tooling item' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Technical specifications' })
  @IsOptional()
  @IsString()
  specifications?: string;

  @ApiPropertyOptional({ description: 'Unit cost in INR (₹/unit)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000000)
  unitCost?: number;

  @ApiPropertyOptional({ description: 'Quantity required' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000000)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Number of parts to amortize tooling cost over' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100000000)
  amortizationParts?: number;

  @ApiPropertyOptional({ description: 'Percentage of tooling capacity used (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  usagePercentage?: number;

  @ApiPropertyOptional({ description: 'Is this custom tooling' })
  @IsOptional()
  @IsBoolean()
  isCustom?: boolean;

  @ApiPropertyOptional({ description: 'Supplier information' })
  @IsOptional()
  @IsString()
  supplier?: string;

  @ApiPropertyOptional({ description: 'Lead time in days' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(365)
  leadTime?: number;

  @ApiPropertyOptional({ description: 'Notes or comments' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Is the record active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'BOM item ID to link this cost to' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;
}

/**
 * DTO for querying tooling cost records
 */
export class QueryToolingCostsDto {
  @ApiPropertyOptional({ description: 'Page number', example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', example: 10, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Filter by tooling type' })
  @IsOptional()
  @IsString()
  toolingType?: string;

  @ApiPropertyOptional({ description: 'Filter by active status', example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Search in description or supplier' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by BOM item ID' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;

  @ApiPropertyOptional({ description: 'Filter by custom tooling', example: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isCustom?: boolean;
}

/**
 * DTO for tooling cost calculation response
 * All costs in INR (₹)
 */
export class ToolingCostResponseDto {
  @ApiProperty({ description: 'Record ID' })
  id: string;

  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'BOM item ID' })
  bomItemId: string;

  @ApiProperty({ description: 'Type of tooling' })
  toolingType: string;

  @ApiProperty({ description: 'Description of the tooling item' })
  description: string;

  @ApiProperty({ description: 'Technical specifications' })
  specifications: string;

  @ApiProperty({ description: 'Unit cost in INR', example: 2500.0 })
  unitCost: number;

  @ApiProperty({ description: 'Quantity required', example: 1.0 })
  quantity: number;

  @ApiProperty({ description: 'Number of parts to amortize over', example: 10000 })
  amortizationParts: number;

  @ApiProperty({ description: 'Percentage of tooling capacity used', example: 100 })
  usagePercentage: number;

  @ApiProperty({ description: 'Total cost per part in INR', example: 0.25 })
  totalCost: number;

  @ApiProperty({ description: 'Total tooling investment in INR', example: 2500.0 })
  totalToolingInvestment: number;

  @ApiProperty({ description: 'Is this custom tooling' })
  isCustom: boolean;

  @ApiProperty({ description: 'Supplier information' })
  supplier: string;

  @ApiProperty({ description: 'Lead time in days' })
  leadTime: number;

  @ApiProperty({ description: 'Notes or comments' })
  notes: string;

  @ApiProperty({ description: 'Is active' })
  isActive: boolean;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at' })
  updatedAt: Date;

  /**
   * Transform database row to DTO
   */
  static fromDatabase(row: any): ToolingCostResponseDto {
    return {
      id: row.id,
      userId: row.user_id,
      bomItemId: row.bom_item_id,
      toolingType: row.tooling_type || '',
      description: row.description || '',
      specifications: row.specifications || '',
      unitCost: parseFloat(row.unit_cost) || 0,
      quantity: parseFloat(row.quantity) || 1,
      amortizationParts: parseInt(row.amortization_parts) || 1,
      usagePercentage: parseFloat(row.usage_percentage) || 100,
      totalCost: parseFloat(row.total_cost) || 0,
      totalToolingInvestment: parseFloat(row.total_tooling_investment) || 0,
      isCustom: row.is_custom === true,
      supplier: row.supplier || '',
      leadTime: parseFloat(row.lead_time) || 0,
      notes: row.notes || '',
      isActive: row.is_active !== false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * DTO for tooling cost list response
 */
export class ToolingCostListResponseDto {
  @ApiProperty({ description: 'List of tooling cost records', type: [ToolingCostResponseDto] })
  records: ToolingCostResponseDto[];

  @ApiProperty({ description: 'Total count of records' })
  total: number;

  @ApiProperty({ description: 'Current page' })
  page: number;

  @ApiProperty({ description: 'Items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;
}