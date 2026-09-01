import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsNumber, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { IsOptionalBoolean } from '../../../common/decorators/validation.decorators';

// ============================================================================
// PROCESS CALCULATOR MAPPING DTOs
// ============================================================================

export class CreateProcessCalculatorMappingDto {
  @ApiProperty({ example: 'Injection Molding' })
  @IsString()
  processGroup!: string;

  @ApiProperty({ example: 'Injection Molding' })
  @IsString()
  processRoute!: string;

  @ApiProperty({ example: 'Injection Molding-Cold Runner' })
  @IsString()
  operation!: string;

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
  @ApiPropertyOptional({ example: 'Injection Molding' })
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

// Real cross-domain taxonomy data (process_taxonomy, migration 609) for the
// operation this mapping row's canonical_process_id (migration 610) links
// to — real feature-type-granular operations, aliases, and default
// machine/tool-shop, sourced from process_operations.json/
// process_machine_data.json (Sheet Metal), the Injection Molding
// digital-factory file, and Machining's operations_full.json. Absent
// (mapping.taxonomy undefined) for rows with no canonical link at all;
// operations/aliases are empty arrays (not absent) for a linked row that
// genuinely has none of either — an honest "no further detail available",
// never fabricated.
export interface ProcessTaxonomyHint {
  defaultMachineName: string | null;
  defaultToolShopName: string | null;
  roadmapStatus: string;
  aliases: string[];
  operations: { operationCategory: string | null; featureType: string | null; raw: string }[];
}

export class ProcessCalculatorMappingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  processGroup!: string;

  @ApiProperty()
  processRoute!: string;

  @ApiProperty()
  operation!: string;

  @ApiPropertyOptional()
  machineClass?: string;

  @ApiPropertyOptional({ description: 'Real lhr_records/lhr_benchmark_rates process_group this machine class is billed against; undefined means the same as processGroup (migration 424).' })
  lhrProcessGroup?: string;

  @ApiPropertyOptional()
  calculatorId?: string;

  @ApiPropertyOptional()
  calculatorName?: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  displayOrder!: number;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiPropertyOptional()
  canonicalProcessId?: string;

  // Real cross-domain taxonomy data (process_taxonomy, migration 609) —
  // undefined only for rows with no canonical link (shouldn't happen after
  // migration 610's NOT NULL guard, kept optional defensively). Supersedes
  // the old sm_operation_reference_map hint (migration 504, ~25 hand-picked
  // Sheet Metal matches, one string each) with real per-operation
  // feature-type granularity, aliases, and default machine across all 6
  // groups.
  @ApiPropertyOptional({ description: 'Cross-domain process taxonomy data for this operation (migration 609/610) — feature-type-granular operations, aliases, default machine/tool-shop.' })
  taxonomy?: ProcessTaxonomyHint;

  static fromDatabase(row: any, taxonomy?: ProcessTaxonomyHint): ProcessCalculatorMappingResponseDto {
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
      canonicalProcessId: row.canonical_process_id ?? undefined,
      taxonomy,
    };
  }
}

export class ProcessCalculatorMappingListResponseDto {
  @ApiProperty({ type: [ProcessCalculatorMappingResponseDto] })
  mappings!: ProcessCalculatorMappingResponseDto[];

  @ApiProperty()
  count!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}

// DTO for getting unique values for filters
export class ProcessHierarchyDto {
  @ApiProperty({ type: [String] })
  processGroups!: string[];

  @ApiProperty({ type: [String] })
  processRoutes!: string[];

  @ApiProperty({ type: [String] })
  operations!: string[];
}
