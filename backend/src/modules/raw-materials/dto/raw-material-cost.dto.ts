/**
 * Raw Material Cost DTOs (INR-Native)
 *
 * Data Transfer Objects for Raw Material Cost calculation API
 * All monetary values in INR (₹)
 *
 * @author Manufacturing Cost Engineering Team
 * @version 2.0.0 (INR-Native)
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
 * DTO for creating a new raw material cost record
 * All costs in INR (₹)
 */
export class CreateRawMaterialCostDto {
  // Material Information
  @ApiPropertyOptional({ description: 'Material category ID', example: '179' })
  @IsOptional()
  @IsString()
  materialCategoryId?: string;

  @ApiPropertyOptional({ description: 'Material type ID', example: '447' })
  @IsOptional()
  @IsString()
  materialTypeId?: string;

  @ApiPropertyOptional({ description: 'Material ID', example: '1908' })
  @IsOptional()
  @IsString()
  materialId?: string;

  @ApiPropertyOptional({ description: 'Material name', example: 'HR STEEL SHEET - 600MC - EN10149' })
  @IsOptional()
  @IsString()
  materialName?: string;

  @ApiPropertyOptional({ description: 'Material category name', example: 'Metals - Ferrous' })
  @IsOptional()
  @IsString()
  materialCategory?: string;

  @ApiPropertyOptional({ description: 'Material type name', example: 'Steel - Hot Worked' })
  @IsOptional()
  @IsString()
  materialType?: string;

  @ApiPropertyOptional({ description: 'Material group', example: 'Plastic & Rubber' })
  @IsOptional()
  @IsString()
  materialGroup?: string;

  @ApiPropertyOptional({ description: 'Material grade', example: 'PP-H' })
  @IsOptional()
  @IsString()
  materialGrade?: string;

  @ApiPropertyOptional({ description: 'Location', example: 'India' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'Quarter', example: 'q1' })
  @IsOptional()
  @IsString()
  quarter?: string;

  // Cost Information (INR)
  @ApiPropertyOptional({ description: 'Material cost ID', example: '1940' })
  @IsOptional()
  @IsString()
  materialCostId?: string;

  @ApiPropertyOptional({ description: 'Cost name', example: '2024 Q1 - India' })
  @IsOptional()
  @IsString()
  costName?: string;

  @ApiProperty({ description: 'Unit cost in INR (₹/unit)', example: 81.0 })
  @IsNumber()
  @Min(0)
  @Max(10000000)
  unitCost: number;

  @ApiPropertyOptional({ description: 'Reclaim rate in INR (recovery value for scrap)', example: 0, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000000)
  reclaimRate?: number;

  @ApiPropertyOptional({ description: 'Unit of measure', example: 'KG', default: 'KG' })
  @IsOptional()
  @IsString()
  uom?: string;

  // Usage Parameters
  @ApiProperty({ description: 'Gross usage (total material required)', example: 247.28 })
  @IsNumber()
  @Min(0)
  @Max(1000000000)
  grossUsage: number;

  @ApiProperty({ description: 'Net usage (material in finished part)', example: 156.50 })
  @IsNumber()
  @Min(0)
  @Max(1000000000)
  netUsage: number;

  @ApiProperty({ description: 'Scrap percentage (additional waste)', example: 0, default: 0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  scrap: number;

  @ApiProperty({ description: 'Overhead percentage', example: 0, default: 0 })
  @IsNumber()
  @Min(0)
  @Max(500)
  overhead: number;

  // Metadata
  @ApiPropertyOptional({ description: 'Is the record active', example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Notes or comments' })
  @IsOptional()
  @IsString()
  notes?: string;

  // Optional linking
  @ApiPropertyOptional({ description: 'BOM item ID to link this cost to' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;

  @ApiPropertyOptional({ description: 'Process route ID to link this cost to' })
  @IsOptional()
  @IsUUID()
  processRouteId?: string;

  @ApiPropertyOptional({ description: 'Project ID to link this cost to' })
  @IsOptional()
  @IsUUID()
  projectId?: string;
}

/**
 * DTO for updating an existing raw material cost record
 */
export class UpdateRawMaterialCostDto {
  // Material Information
  @ApiPropertyOptional({ description: 'Material category ID' })
  @IsOptional()
  @IsString()
  materialCategoryId?: string;

  @ApiPropertyOptional({ description: 'Material type ID' })
  @IsOptional()
  @IsString()
  materialTypeId?: string;

  @ApiPropertyOptional({ description: 'Material ID' })
  @IsOptional()
  @IsString()
  materialId?: string;

  @ApiPropertyOptional({ description: 'Material name' })
  @IsOptional()
  @IsString()
  materialName?: string;

  @ApiPropertyOptional({ description: 'Material category name' })
  @IsOptional()
  @IsString()
  materialCategory?: string;

  @ApiPropertyOptional({ description: 'Material type name' })
  @IsOptional()
  @IsString()
  materialType?: string;

  @ApiPropertyOptional({ description: 'Material group' })
  @IsOptional()
  @IsString()
  materialGroup?: string;

  @ApiPropertyOptional({ description: 'Material grade' })
  @IsOptional()
  @IsString()
  materialGrade?: string;

  @ApiPropertyOptional({ description: 'Location' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'Quarter' })
  @IsOptional()
  @IsString()
  quarter?: string;

  // Cost Information (INR)
  @ApiPropertyOptional({ description: 'Material cost ID' })
  @IsOptional()
  @IsString()
  materialCostId?: string;

  @ApiPropertyOptional({ description: 'Cost name' })
  @IsOptional()
  @IsString()
  costName?: string;

  @ApiPropertyOptional({ description: 'Unit cost in INR (₹/unit)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000000)
  unitCost?: number;

  @ApiPropertyOptional({ description: 'Reclaim rate in INR' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000000)
  reclaimRate?: number;

  @ApiPropertyOptional({ description: 'Unit of measure' })
  @IsOptional()
  @IsString()
  uom?: string;

  // Usage Parameters
  @ApiPropertyOptional({ description: 'Gross usage' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000000000)
  grossUsage?: number;

  @ApiPropertyOptional({ description: 'Net usage' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000000000)
  netUsage?: number;

  @ApiPropertyOptional({ description: 'Scrap percentage' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  scrap?: number;

  @ApiPropertyOptional({ description: 'Overhead percentage' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  overhead?: number;

  // Metadata
  @ApiPropertyOptional({ description: 'Is the record active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Notes or comments' })
  @IsOptional()
  @IsString()
  notes?: string;

  // Optional linking
  @ApiPropertyOptional({ description: 'BOM item ID to link this cost to' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;

  @ApiPropertyOptional({ description: 'Process route ID to link this cost to' })
  @IsOptional()
  @IsUUID()
  processRouteId?: string;

  @ApiPropertyOptional({ description: 'Project ID to link this cost to' })
  @IsOptional()
  @IsUUID()
  projectId?: string;
}

/**
 * DTO for querying raw material cost records
 */
export class QueryRawMaterialCostsDto {
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

  @ApiPropertyOptional({ description: 'Filter by material category' })
  @IsOptional()
  @IsString()
  materialCategory?: string;

  @ApiPropertyOptional({ description: 'Filter by material type' })
  @IsOptional()
  @IsString()
  materialType?: string;

  @ApiPropertyOptional({ description: 'Filter by active status', example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Search in material name or cost name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by BOM item ID' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;

  @ApiPropertyOptional({ description: 'Filter by project ID' })
  @IsOptional()
  @IsUUID()
  projectId?: string;
}

/**
 * DTO for raw material cost calculation response
 * All costs in INR (₹)
 */
export class RawMaterialCostResponseDto {
  @ApiProperty({ description: 'Record ID' })
  id: string;

  // Material Information
  @ApiProperty({ description: 'Material name' })
  materialName: string;

  @ApiProperty({ description: 'Material category' })
  materialCategory: string;

  @ApiProperty({ description: 'Material type' })
  materialType: string;

  @ApiProperty({ description: 'Material group' })
  materialGroup: string;

  @ApiProperty({ description: 'Material grade' })
  materialGrade: string;

  @ApiProperty({ description: 'Material ID' })
  materialId: string;

  @ApiProperty({ description: 'Location' })
  location: string;

  @ApiProperty({ description: 'Quarter' })
  quarter: string;

  // Cost Information
  @ApiProperty({ description: 'Cost name', example: '2024 Q1 - India' })
  costName: string;

  @ApiProperty({ description: 'Unit cost in INR', example: 81.0 })
  unitCost: number;

  @ApiProperty({ description: 'Reclaim rate in INR', example: 0 })
  reclaimRate: number;

  @ApiProperty({ description: 'Unit of measure', example: 'KG' })
  uom: string;

  // Usage Parameters
  @ApiProperty({ description: 'Gross usage', example: 247.28 })
  grossUsage: number;

  @ApiProperty({ description: 'Net usage', example: 156.50 })
  netUsage: number;

  @ApiProperty({ description: 'Scrap percentage', example: 0 })
  scrap: number;

  @ApiProperty({ description: 'Overhead percentage', example: 0 })
  overhead: number;

  // Calculated Results (All in INR)
  @ApiProperty({ description: 'Total cost in INR', example: 20034.68 })
  totalCost: number;

  @ApiProperty({ description: 'Gross material cost in INR', example: 20034.68 })
  grossMaterialCost: number;

  @ApiProperty({ description: 'Reclaim value in INR', example: 0 })
  reclaimValue: number;

  @ApiProperty({ description: 'Net material cost in INR', example: 20034.68 })
  netMaterialCost: number;

  @ApiProperty({ description: 'Scrap adjustment in INR', example: 0 })
  scrapAdjustment: number;

  @ApiProperty({ description: 'Overhead cost in INR', example: 0 })
  overheadCost: number;

  @ApiProperty({ description: 'Total cost per unit in INR', example: 81.0 })
  totalCostPerUnit: number;

  @ApiProperty({ description: 'Effective cost per unit (based on net usage) in INR', example: 128.02 })
  effectiveCostPerUnit: number;

  // Efficiency Metrics
  @ApiProperty({ description: 'Material utilization rate (%)', example: 63.30 })
  materialUtilizationRate: number;

  @ApiProperty({ description: 'Scrap rate (%)', example: 36.70 })
  scrapRate: number;

  // Full calculation breakdown (optional)
  @ApiPropertyOptional({ description: 'Complete calculation breakdown' })
  calculationBreakdown?: any;

  // Metadata
  @ApiProperty({ description: 'Is active' })
  isActive: boolean;

  @ApiPropertyOptional({ description: 'Notes' })
  notes?: string;

  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'Created at' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at' })
  updatedAt: Date;

  /**
   * Transform database row to DTO
   */
  static fromDatabase(row: any): RawMaterialCostResponseDto {
    return {
      id: row.id,
      materialName: row.material_name || '',
      materialCategory: row.material_category || '',
      materialType: row.material_type || '',
      materialGroup: row.material_group || '',
      materialGrade: row.material_grade || '',
      materialId: row.material_id || '',
      location: row.location || '',
      quarter: row.quarter || 'q1',
      costName: row.cost_name || '',
      unitCost: parseFloat(row.unit_cost) || 0,
      reclaimRate: parseFloat(row.reclaim_rate) || 0,
      uom: row.uom || 'KG',
      grossUsage: parseFloat(row.gross_usage) || 0,
      netUsage: parseFloat(row.net_usage) || 0,
      scrap: parseFloat(row.scrap) || 0,
      overhead: parseFloat(row.overhead) || 0,
      totalCost: parseFloat(row.total_cost) || 0,
      grossMaterialCost: parseFloat(row.gross_material_cost) || 0,
      reclaimValue: parseFloat(row.reclaim_value) || 0,
      netMaterialCost: parseFloat(row.net_material_cost) || 0,
      scrapAdjustment: parseFloat(row.scrap_adjustment) || 0,
      overheadCost: parseFloat(row.overhead_cost) || 0,
      totalCostPerUnit: parseFloat(row.total_cost_per_unit) || 0,
      effectiveCostPerUnit: parseFloat(row.effective_cost_per_unit) || 0,
      materialUtilizationRate: parseFloat(row.material_utilization_rate) || 0,
      scrapRate: parseFloat(row.scrap_rate) || 0,
      calculationBreakdown: row.calculation_breakdown,
      isActive: row.is_active !== false,
      notes: row.notes,
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * DTO for raw material cost list response
 */
export class RawMaterialCostListResponseDto {
  @ApiProperty({ description: 'List of raw material cost records', type: [RawMaterialCostResponseDto] })
  records: RawMaterialCostResponseDto[];

  @ApiProperty({ description: 'Total count of records' })
  total: number;

  @ApiProperty({ description: 'Current page' })
  page: number;

  @ApiProperty({ description: 'Items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;
}
