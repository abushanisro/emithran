import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsBoolean, Min, Max, IsArray, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProcessDto {
  @ApiProperty({ example: 'CNC Machining' })
  @IsString()
  processName: string;

  @ApiProperty({ example: 'Machining' })
  @IsString()
  processCategory: string;

  @ApiPropertyOptional({ example: 'CNC milling operation for complex geometries' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 120.5 })
  @IsOptional()
  @IsNumber()
  standardTimeMinutes?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsNumber()
  setupTimeMinutes?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsNumber()
  cycleTimeMinutes?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  machineRequired?: boolean;

  @ApiPropertyOptional({ example: 'CNC Mill' })
  @IsOptional()
  @IsString()
  machineType?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  laborRequired?: boolean;

  @ApiPropertyOptional({ example: 'Level 3 - Specialist' })
  @IsOptional()
  @IsString()
  skillLevelRequired?: string;
}

export class UpdateProcessDto extends PartialType(CreateProcessDto) {}

export class QueryProcessesDto {
  @ApiPropertyOptional({ example: 'Machining' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'CNC' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'CNC Mill' })
  @IsOptional()
  @IsString()
  machineType?: string;

  @ApiPropertyOptional({ example: 1, description: 'Page number (starting from 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 10, description: 'Items per page (max 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}

// ============================================================================
// PROCESS REFERENCE TABLES DTOs
// ============================================================================

export class ColumnDefinitionDto {
  @ApiProperty({ example: 'flow_path_ratio' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'number' })
  @IsString()
  type: string;

  @ApiProperty({ example: 'Flow Path Ratio' })
  @IsString()
  label: string;

  @ApiPropertyOptional({ example: 'Bar' })
  @IsOptional()
  @IsString()
  unit?: string;
}

export class CreateReferenceTableDto {
  @ApiProperty({ example: 'uuid-here' })
  @IsString()
  processId: string;

  @ApiProperty({ example: 'Cavity Pressure Table' })
  @IsString()
  tableName: string;

  @ApiPropertyOptional({ example: 'Flow path ratio vs cavity pressure relationship' })
  @IsOptional()
  @IsString()
  tableDescription?: string;

  @ApiProperty({
    example: [
      { name: 'flow_path_ratio', type: 'number', label: 'Flow Path Ratio' },
      { name: 'pressure', type: 'number', label: 'Pressure (Bar)' }
    ]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ColumnDefinitionDto)
  columnDefinitions: ColumnDefinitionDto[];

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  displayOrder?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isEditable?: boolean;
}

export class UpdateReferenceTableDto extends PartialType(CreateReferenceTableDto) {}

export class CreateTableRowDto {
  @ApiProperty({ example: 'uuid-here' })
  @IsString()
  tableId: string;

  @ApiProperty({ example: { flow_path_ratio: 50, pressure: 100 } })
  @IsObject()
  rowData: Record<string, any>;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  rowOrder?: number;
}

export class UpdateTableRowDto {
  @ApiPropertyOptional({ example: { flow_path_ratio: 50, pressure: 100 } })
  @IsOptional()
  @IsObject()
  rowData?: Record<string, any>;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  rowOrder?: number;
}

export class BulkUpdateTableRowsDto {
  @ApiProperty({ example: 'uuid-here' })
  @IsString()
  tableId: string;

  @ApiProperty({
    example: [
      { row_data: { flow_path_ratio: 50, pressure: 100 }, row_order: 1 },
      { row_data: { flow_path_ratio: 60, pressure: 110 }, row_order: 2 }
    ]
  })
  @IsArray()
  rows: Array<{ row_data: Record<string, any>; row_order: number }>;
}
