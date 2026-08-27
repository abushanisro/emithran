import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsNumber, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { IsOptionalBoolean } from '../../../common/decorators/validation.decorators';

// ============================================================================
// PROCESS CALCULATOR MAPPING DTOs
// ============================================================================

export class CreateProcessCalculatorMappingDto {
  @ApiProperty({ example: 'Plastic & Rubber' })
  @IsString()
  processGroup: string;

  @ApiProperty({ example: 'Injection Molding' })
  @IsString()
  processRoute: string;

  @ApiProperty({ example: 'Injection Molding-Cold Runner' })
  @IsString()
  operation: string;

  @ApiPropertyOptional({ example: 'uuid-here' })
  @IsOptional()
  @IsUUID()
  calculatorId?: string;

  @ApiPropertyOptional({ example: 'Tonnage Calculator' })
  @IsOptional()
  @IsString()
  calculatorName?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  displayOrder?: number;
}

export class UpdateProcessCalculatorMappingDto extends PartialType(CreateProcessCalculatorMappingDto) {}

export class QueryProcessCalculatorMappingsDto {
  @ApiPropertyOptional({ example: 'Plastic & Rubber' })
  @IsOptional()
  @IsString()
  processGroup?: string;

  @ApiPropertyOptional({ example: 'Injection Molding' })
  @IsOptional()
  @IsString()
  processRoute?: string;

  @ApiPropertyOptional({ example: 'Injection Molding-Cold Runner' })
  @IsOptional()
  @IsString()
  operation?: string;

  @ApiPropertyOptional({ example: 'uuid-here' })
  @IsOptional()
  @IsUUID()
  calculatorId?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptionalBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 'injection' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 1, description: 'Page number (starting from 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 50, description: 'Items per page (max 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}

export class ProcessCalculatorMappingResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  processGroup: string;

  @ApiProperty()
  processRoute: string;

  @ApiProperty()
  operation: string;

  @ApiPropertyOptional()
  machineClass?: string;

  @ApiPropertyOptional({ description: 'Real lhr_records/lhr_benchmark_rates process_group this machine class is billed against; undefined means the same as processGroup (migration 424).' })
  lhrProcessGroup?: string;

  @ApiPropertyOptional()
  calculatorId?: string;

  @ApiPropertyOptional()
  calculatorName?: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  displayOrder: number;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  // Real reconciliation-export cross-reference (sm_operation_reference_map,
  // migration 504) — undefined for the majority of operations that have no
  // clean, justified name match in the source export; never guessed. See
  // that migration's own comments for exactly which matches were judged
  // clean enough to include and why.
  @ApiPropertyOptional({ description: 'Reference-tool cross-reference for this operation, if a clean name match exists (migration 504) — informational only, never a live cost input.' })
  referenceHint?: { sourceProcessName: string; exampleMachine: string | null };

  static fromDatabase(row: any, referenceHint?: { sourceProcessName: string; exampleMachine: string | null }): ProcessCalculatorMappingResponseDto {
    return {
      id: row.id,
      processGroup: row.process_group,
      processRoute: row.process_route,
      operation: row.operation,
      machineClass: row.machine_class ?? undefined,
      lhrProcessGroup: row.lhr_process_group ?? undefined,
      calculatorId: row.calculator_id,
      calculatorName: row.calculator_name,
      isActive: row.is_active,
      displayOrder: row.display_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      referenceHint,
    };
  }
}

export class ProcessCalculatorMappingListResponseDto {
  @ApiProperty({ type: [ProcessCalculatorMappingResponseDto] })
  mappings: ProcessCalculatorMappingResponseDto[];

  @ApiProperty()
  count: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}

// DTO for getting unique values for filters
export class ProcessHierarchyDto {
  @ApiProperty({ type: [String] })
  processGroups: string[];

  @ApiProperty({ type: [String] })
  processRoutes: string[];

  @ApiProperty({ type: [String] })
  operations: string[];
}
