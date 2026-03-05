/**
 * Process Cost DTOs
 *
 * Data Transfer Objects for Process Cost calculation API
 *
 * @author Manufacturing Cost Engineering Team
 * @version 1.0.0
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
  ValidateIf,
  IsArray,
  ArrayMinSize,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
} from 'class-validator';
import { Type } from 'class-transformer';

@ValidatorConstraint({ name: 'IsUUIDOrArrayOfUUIDs', async: false })
export class IsUUIDOrArrayOfUUIDs implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments) {
    if (!value) return true; // Optional field

    // Check if it's a single UUID string
    if (typeof value === 'string') {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    }

    // Check if it's an array of UUID strings
    if (Array.isArray(value)) {
      return value.every(item =>
        typeof item === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item)
      );
    }

    return false;
  }

  defaultMessage(args: ValidationArguments) {
    return 'bomItemId must be a valid UUID or an array of valid UUIDs';
  }
}

/**
 * DTO for creating a new process cost record
 */
export class CreateProcessCostDto {
  @ApiPropertyOptional({ description: 'Operation number', example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  opNbr?: number;

  // Process Information (denormalized for display)
  @ApiPropertyOptional({ description: 'Process group name', example: 'Assembly' })
  @IsOptional()
  @IsString()
  processGroup?: string;

  @ApiPropertyOptional({ description: 'Process route name', example: 'Manual Assembly' })
  @IsOptional()
  @IsString()
  processRoute?: string;

  @ApiPropertyOptional({ description: 'Operation name', example: 'Part Assembly' })
  @IsOptional()
  @IsString()
  operation?: string;

  // Resource References
  @ApiPropertyOptional({ description: 'Machine Hour Record ID', example: 'uuid' })
  @IsOptional()
  @IsUUID()
  mhrId?: string;

  @ApiPropertyOptional({ description: 'Labour Standard Record ID', example: 'uuid' })
  @IsOptional()
  @IsUUID()
  lsrId?: string;

  // Facility Information
  @ApiPropertyOptional({ description: 'Facility category ID', example: '844' })
  @IsOptional()
  @IsString()
  facilityCategoryId?: string;

  @ApiPropertyOptional({ description: 'Facility type ID', example: '2070' })
  @IsOptional()
  @IsString()
  facilityTypeId?: string;

  @ApiPropertyOptional({ description: 'Supplier ID', example: '151' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Supplier location ID', example: '421' })
  @IsOptional()
  @IsString()
  supplierLocationId?: string;

  @ApiPropertyOptional({ description: 'Facility ID', example: '4131' })
  @IsOptional()
  @IsString()
  facilityId?: string;

  @ApiPropertyOptional({ description: 'Facility rate ID', example: '4215' })
  @IsOptional()
  @IsString()
  facilityRateId?: string;

  // Facility Rates
  @ApiProperty({ description: 'Direct labor rate (currency/hour)', example: 102 })
  @IsNumber()
  @Min(0)
  @Max(100000)
  directRate: number;

  @ApiPropertyOptional({ description: 'Indirect cost rate (currency/hour)', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  indirectRate?: number;

  @ApiPropertyOptional({ description: 'Fringe benefits rate (currency/hour)', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  fringeRate?: number;

  @ApiPropertyOptional({ description: 'Machine/equipment rate (currency/hour)', example: 80 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  machineRate?: number;

  @ApiPropertyOptional({ description: 'Machine/equipment value (currency)', example: 500000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999)
  machineValue?: number;

  @ApiPropertyOptional({ description: 'Labor rate (currency/hour)', example: 150 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  laborRate?: number;

  @ApiPropertyOptional({ description: 'Currency code', example: 'INR' })
  @IsOptional()
  @IsString()
  currency?: string;

  // Shift Pattern
  @ApiPropertyOptional({ description: 'Shift pattern ID', example: '710' })
  @IsOptional()
  @IsString()
  shiftPatternId?: string;

  @ApiPropertyOptional({ description: 'Hours per day based on shift pattern', example: 8 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  shiftPatternHoursPerDay?: number;

  // Setup Parameters
  @ApiProperty({ description: 'Number of workers during setup', example: 1 })
  @IsNumber()
  @Min(0)
  @Max(1000)
  setupManning: number;

  @ApiProperty({ description: 'Setup time in minutes', example: 120 })
  @IsNumber()
  @Min(0)
  @Max(100000)
  setupTime: number;

  // Production Parameters
  @ApiProperty({ description: 'Batch size (number of parts)', example: 12500 })
  @IsNumber()
  @Min(1)
  @Max(100000000)
  batchSize: number;

  @ApiProperty({ description: 'Number of operators/stations during production', example: 1 })
  @IsNumber()
  @Min(0)
  @Max(1000)
  heads: number;

  @ApiProperty({ description: 'Cycle time in seconds', example: 80 })
  @IsNumber()
  @Min(1)
  @Max(1000000)
  cycleTime: number;

  @ApiProperty({ description: 'Parts produced per cycle', example: 1 })
  @IsNumber()
  @Min(1)
  @Max(100000)
  partsPerCycle: number;

  // Quality Parameters
  @ApiProperty({ description: 'Scrap percentage (0-100)', example: 2 })
  @IsNumber()
  @Min(0)
  @Max(99.99)
  scrap: number;

  // Metadata
  @ApiPropertyOptional({ description: 'Is the record active', example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Notes or comments', example: 'Standard assembly process' })
  @IsOptional()
  @IsString()
  notes?: string;

  // Optional linking
  @ApiPropertyOptional({ description: 'Process ID to link this cost to', example: 'uuid' })
  @IsOptional()
  @IsUUID()
  processId?: string;

  @ApiPropertyOptional({ description: 'Process route ID to link this cost to', example: 'uuid' })
  @IsOptional()
  @IsUUID()
  processRouteId?: string;

  @ApiPropertyOptional({ description: 'BOM item ID to link this cost to', example: 'uuid' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;
}

/**
 * DTO for updating an existing process cost record
 */
export class UpdateProcessCostDto {
  @ApiPropertyOptional({ description: 'Operation number', example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  opNbr?: number;

  // Process Information (denormalized for display)
  @ApiPropertyOptional({ description: 'Process group name', example: 'Assembly' })
  @IsOptional()
  @IsString()
  processGroup?: string;

  @ApiPropertyOptional({ description: 'Process route name', example: 'Manual Assembly' })
  @IsOptional()
  @IsString()
  processRoute?: string;

  @ApiPropertyOptional({ description: 'Operation name', example: 'Part Assembly' })
  @IsOptional()
  @IsString()
  operation?: string;

  // Resource References
  @ApiPropertyOptional({ description: 'Machine Hour Record ID', example: 'uuid' })
  @IsOptional()
  @IsUUID()
  mhrId?: string;

  @ApiPropertyOptional({ description: 'Labour Standard Record ID', example: 'uuid' })
  @IsOptional()
  @IsUUID()
  lsrId?: string;

  // Facility Information
  @ApiPropertyOptional({ description: 'Facility category ID' })
  @IsOptional()
  @IsString()
  facilityCategoryId?: string;

  @ApiPropertyOptional({ description: 'Facility type ID' })
  @IsOptional()
  @IsString()
  facilityTypeId?: string;

  @ApiPropertyOptional({ description: 'Supplier ID' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Supplier location ID' })
  @IsOptional()
  @IsString()
  supplierLocationId?: string;

  @ApiPropertyOptional({ description: 'Facility ID' })
  @IsOptional()
  @IsString()
  facilityId?: string;

  @ApiPropertyOptional({ description: 'Facility rate ID' })
  @IsOptional()
  @IsString()
  facilityRateId?: string;

  // Facility Rates
  @ApiPropertyOptional({ description: 'Direct labor rate (currency/hour)', example: 102 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  directRate?: number;

  @ApiPropertyOptional({ description: 'Indirect cost rate (currency/hour)', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  indirectRate?: number;

  @ApiPropertyOptional({ description: 'Fringe benefits rate (currency/hour)', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  fringeRate?: number;

  @ApiPropertyOptional({ description: 'Machine/equipment rate (currency/hour)', example: 80 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  machineRate?: number;

  @ApiPropertyOptional({ description: 'Machine/equipment value (currency)', example: 500000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999)
  machineValue?: number;

  @ApiPropertyOptional({ description: 'Labor rate (currency/hour)', example: 150 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  laborRate?: number;

  @ApiPropertyOptional({ description: 'Currency code', example: 'INR' })
  @IsOptional()
  @IsString()
  currency?: string;

  // Shift Pattern
  @ApiPropertyOptional({ description: 'Shift pattern ID' })
  @IsOptional()
  @IsString()
  shiftPatternId?: string;

  @ApiPropertyOptional({ description: 'Hours per day based on shift pattern' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  shiftPatternHoursPerDay?: number;

  // Setup Parameters
  @ApiPropertyOptional({ description: 'Number of workers during setup', example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  setupManning?: number;

  @ApiPropertyOptional({ description: 'Setup time in minutes', example: 120 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  setupTime?: number;

  // Production Parameters
  @ApiPropertyOptional({ description: 'Batch size (number of parts)', example: 12500 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100000000)
  batchSize?: number;

  @ApiPropertyOptional({ description: 'Number of operators/stations during production', example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  heads?: number;

  @ApiPropertyOptional({ description: 'Cycle time in seconds', example: 80 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000000)
  cycleTime?: number;

  @ApiPropertyOptional({ description: 'Parts produced per cycle', example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100000)
  partsPerCycle?: number;

  // Quality Parameters
  @ApiPropertyOptional({ description: 'Scrap percentage (0-100)', example: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(99.99)
  scrap?: number;

  // Metadata
  @ApiPropertyOptional({ description: 'Is the record active', example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Notes or comments' })
  @IsOptional()
  @IsString()
  notes?: string;

  // Optional linking
  @ApiPropertyOptional({ description: 'Process ID to link this cost to' })
  @IsOptional()
  @IsUUID()
  processId?: string;

  @ApiPropertyOptional({ description: 'Process route ID to link this cost to' })
  @IsOptional()
  @IsUUID()
  processRouteId?: string;

  @ApiPropertyOptional({ description: 'BOM item ID to link this cost to' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;
}

/**
 * DTO for querying process cost records
 */
export class QueryProcessCostsDto {
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

  @ApiPropertyOptional({ description: 'Filter by facility category' })
  @IsOptional()
  @IsString()
  facilityCategory?: string;

  @ApiPropertyOptional({ description: 'Filter by facility type' })
  @IsOptional()
  @IsString()
  facilityType?: string;

  @ApiPropertyOptional({ description: 'Filter by supplier' })
  @IsOptional()
  @IsString()
  supplier?: string;

  @ApiPropertyOptional({ description: 'Filter by active status', example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Search in description', example: 'Assembly' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by process ID' })
  @IsOptional()
  @IsUUID()
  processId?: string;

  @ApiPropertyOptional({ description: 'Filter by BOM item ID (single or multiple)' })
  @IsOptional()
  @Validate(IsUUIDOrArrayOfUUIDs)
  bomItemId?: string | string[];

  @ApiPropertyOptional({
    description: 'Filter by multiple BOM item IDs',
    type: [String],
    example: ['uuid1', 'uuid2']
  })
  @IsOptional()
  bomItemIds?: string[];
}

/**
 * DTO for process cost calculation response
 */
export class ProcessCostResponseDto {
  @ApiProperty({ description: 'Record ID' })
  id: string;

  @ApiProperty({ description: 'Operation number', example: 10 })
  opNbr: number;

  // Process Information
  @ApiPropertyOptional({ description: 'Process group name', example: 'Assembly' })
  processGroup?: string;

  @ApiPropertyOptional({ description: 'Process route name', example: 'Manual Assembly' })
  processRoute?: string;

  @ApiPropertyOptional({ description: 'Operation name', example: 'Part Assembly' })
  operation?: string;

  // Resource References
  @ApiPropertyOptional({ description: 'Machine Hour Record ID' })
  mhrId?: string;

  @ApiPropertyOptional({ description: 'Labour Standard Record ID' })
  lsrId?: string;

  @ApiProperty({ description: 'Currency code', example: 'INR' })
  currency: string;

  // Input Parameters
  @ApiProperty({ description: 'Direct labor rate', example: 102 })
  directRate: number;

  @ApiProperty({ description: 'Indirect cost rate', example: 0 })
  indirectRate: number;

  @ApiProperty({ description: 'Fringe benefits rate', example: 0 })
  fringeRate: number;

  @ApiProperty({ description: 'Machine rate', example: 80 })
  machineRate: number;

  @ApiProperty({ description: 'Machine value', example: 500000 })
  machineValue: number;

  @ApiProperty({ description: 'Labor rate', example: 150 })
  laborRate: number;

  @ApiProperty({ description: 'Setup manning', example: 1 })
  setupManning: number;

  @ApiProperty({ description: 'Setup time (minutes)', example: 120 })
  setupTime: number;

  @ApiProperty({ description: 'Batch size', example: 12500 })
  batchSize: number;

  @ApiProperty({ description: 'Heads', example: 1 })
  heads: number;

  @ApiProperty({ description: 'Cycle time (seconds)', example: 80 })
  cycleTime: number;

  @ApiProperty({ description: 'Parts per cycle', example: 1 })
  partsPerCycle: number;

  @ApiProperty({ description: 'Scrap percentage', example: 2 })
  scrap: number;

  // Calculated Results
  @ApiProperty({ description: 'Total cost per part (final result)', example: 4.154452 })
  totalCostPerPart: number;

  @ApiProperty({ description: 'Setup cost per part', example: 0.408 })
  setupCostPerPart: number;

  @ApiProperty({ description: 'Cycle cost per part', example: 3.688889 })
  totalCycleCostPerPart: number;

  @ApiProperty({ description: 'Total cost before scrap', example: 4.096889 })
  totalCostBeforeScrap: number;

  @ApiProperty({ description: 'Scrap adjustment', example: 0.057563 })
  scrapAdjustment: number;

  @ApiProperty({ description: 'Total batch cost', example: 51931.65 })
  totalBatchCost: number;

  // Full calculation breakdown (optional - can be expanded)
  @ApiPropertyOptional({ description: 'Complete calculation breakdown' })
  calculationBreakdown?: any;

  // Links to other entities
  @ApiPropertyOptional({ description: 'BOM item ID' })
  bomItemId?: string;

  @ApiPropertyOptional({ description: 'Process ID' })
  processId?: string;

  @ApiPropertyOptional({ description: 'Process route ID' })
  processRouteId?: string;

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
  static fromDatabase(row: any): ProcessCostResponseDto {
    return {
      id: row.id,
      opNbr: row.op_nbr || 0,
      processGroup: row.process_group,
      processRoute: row.process_route,
      operation: row.operation,
      mhrId: row.mhr_id,
      lsrId: row.lsr_id,
      currency: row.currency || 'INR',
      directRate: parseFloat(row.direct_rate) || 0,
      indirectRate: parseFloat(row.indirect_rate) || 0,
      fringeRate: parseFloat(row.fringe_rate) || 0,
      machineRate: parseFloat(row.machine_rate) || 0,
      machineValue: parseFloat(row.machine_value) || 0,
      laborRate: parseFloat(row.labor_rate) || 0,
      setupManning: parseFloat(row.setup_manning) || 0,
      setupTime: parseFloat(row.setup_time) || 0,
      batchSize: parseFloat(row.batch_size) || 1,
      heads: parseFloat(row.heads) || 0,
      cycleTime: parseFloat(row.cycle_time) || 0,
      partsPerCycle: parseFloat(row.parts_per_cycle) || 1,
      scrap: parseFloat(row.scrap) || 0,
      totalCostPerPart: parseFloat(row.total_cost_per_part) || 0,
      setupCostPerPart: parseFloat(row.setup_cost_per_part) || 0,
      totalCycleCostPerPart: parseFloat(row.total_cycle_cost_per_part) || 0,
      totalCostBeforeScrap: parseFloat(row.total_cost_before_scrap) || 0,
      scrapAdjustment: parseFloat(row.scrap_adjustment) || 0,
      totalBatchCost: parseFloat(row.total_batch_cost) || 0,
      calculationBreakdown: row.calculation_breakdown,
      bomItemId: row.bom_item_id,
      processId: row.process_id,
      processRouteId: row.process_route_id,
      isActive: row.is_active !== false,
      notes: row.notes,
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * DTO for process cost list response
 */
export class ProcessCostListResponseDto {
  @ApiProperty({ description: 'List of process cost records', type: [ProcessCostResponseDto] })
  records: ProcessCostResponseDto[];

  @ApiProperty({ description: 'Total count of records' })
  total: number;

  @ApiProperty({ description: 'Current page' })
  page: number;

  @ApiProperty({ description: 'Items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;
}
