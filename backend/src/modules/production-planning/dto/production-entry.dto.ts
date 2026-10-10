import { IsString, IsNumber, IsEnum, IsOptional, IsUUID, IsDateString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

enum ProductionShift {
  MORNING = 'MORNING',
  AFTERNOON = 'AFTERNOON',
  NIGHT = 'NIGHT'
}

export class CreateProductionEntryDto {
  @ApiProperty({ description: 'Production lot ID' })
  @IsUUID()
  lotId: string;

  @ApiProperty({ description: 'Process ID (optional)' })
  @IsOptional()
  @IsUUID()
  processId?: string;

  @ApiProperty({ description: 'Process name' })
  @IsString()
  processName: string;

  @ApiProperty({ description: 'Entry date in YYYY-MM-DD format' })
  @IsDateString()
  entryDate: string;

  @ApiProperty({ enum: ProductionShift, description: 'Work shift' })
  @IsEnum(ProductionShift)
  shift: ProductionShift;

  @ApiProperty({ description: 'Target production quantity' })
  @IsNumber()
  @Min(0)
  targetQuantity: number;

  @ApiProperty({ description: 'Actual produced quantity' })
  @IsNumber()
  @Min(0)
  producedQuantity: number;

  @ApiProperty({ description: 'Rejected quantity', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rejectedQuantity?: number;

  @ApiProperty({ description: 'Rework quantity', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  reworkQuantity?: number;

  @ApiProperty({ description: 'Downtime in minutes', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  downtimeMinutes?: number;

  @ApiProperty({ description: 'Reason for downtime', required: false })
  @IsOptional()
  @IsString()
  downtimeReason?: string;

  @ApiProperty({ description: 'Quality issues description', required: false })
  @IsOptional()
  @IsString()
  qualityIssues?: string;

  @ApiProperty({ description: 'Operator notes', required: false })
  @IsOptional()
  @IsString()
  operatorNotes?: string;
}

export class UpdateProductionEntryDto {
  @ApiProperty({ description: 'Process ID (optional)', required: false })
  @IsOptional()
  @IsUUID()
  processId?: string;

  @ApiProperty({ description: 'Process name', required: false })
  @IsOptional()
  @IsString()
  processName?: string;

  @ApiProperty({ description: 'Entry date in YYYY-MM-DD format', required: false })
  @IsOptional()
  @IsDateString()
  entryDate?: string;

  @ApiProperty({ enum: ProductionShift, description: 'Work shift', required: false })
  @IsOptional()
  @IsEnum(ProductionShift)
  shift?: ProductionShift;

  @ApiProperty({ description: 'Target production quantity', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetQuantity?: number;

  @ApiProperty({ description: 'Actual produced quantity', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  producedQuantity?: number;

  @ApiProperty({ description: 'Rejected quantity', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  rejectedQuantity?: number;

  @ApiProperty({ description: 'Rework quantity', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  reworkQuantity?: number;

  @ApiProperty({ description: 'Downtime in minutes', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  downtimeMinutes?: number;

  @ApiProperty({ description: 'Reason for downtime', required: false })
  @IsOptional()
  @IsString()
  downtimeReason?: string;

  @ApiProperty({ description: 'Quality issues description', required: false })
  @IsOptional()
  @IsString()
  qualityIssues?: string;

  @ApiProperty({ description: 'Operator notes', required: false })
  @IsOptional()
  @IsString()
  operatorNotes?: string;
}

export class ProductionEntryResponseDto {
  @ApiProperty({ description: 'Entry ID' })
  id: string;

  @ApiProperty({ description: 'Production lot ID' })
  lotId: string;

  @ApiProperty({ description: 'Process ID' })
  processId: string;

  @ApiProperty({ description: 'Process name' })
  processName: string;

  @ApiProperty({ description: 'Entry date' })
  entryDate: string;

  @ApiProperty({ enum: ProductionShift, description: 'Work shift' })
  shift: ProductionShift;

  @ApiProperty({ description: 'Target production quantity' })
  targetQuantity: number;

  @ApiProperty({ description: 'Actual produced quantity' })
  producedQuantity: number;

  @ApiProperty({ description: 'Rejected quantity' })
  rejectedQuantity: number;

  @ApiProperty({ description: 'Rework quantity' })
  reworkQuantity: number;

  @ApiProperty({ description: 'Downtime in minutes' })
  downtimeMinutes: number;

  @ApiProperty({ description: 'Reason for downtime' })
  downtimeReason: string;

  @ApiProperty({ description: 'Quality issues description' })
  qualityIssues: string;

  @ApiProperty({ description: 'Operator notes' })
  operatorNotes: string;

  @ApiProperty({ description: 'User who entered the data' })
  enteredBy: string;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: string;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: string;
}

export class WeeklySummaryDto {
  @ApiProperty({ description: 'Week description' })
  week: string;

  @ApiProperty({ description: 'Week start date' })
  weekStart: string;

  @ApiProperty({ description: 'Week end date' })
  weekEnd: string;

  @ApiProperty({ description: 'Total target quantity for the week' })
  targetQuantity: number;

  @ApiProperty({ description: 'Total produced quantity for the week' })
  producedQuantity: number;

  @ApiProperty({ description: 'Total rejected quantity for the week' })
  rejectedQuantity: number;

  @ApiProperty({ description: 'Total rework quantity for the week' })
  reworkQuantity: number;

  @ApiProperty({ description: 'Total downtime in minutes for the week' })
  totalDowntimeMinutes: number;

  @ApiProperty({ description: 'Production efficiency percentage' })
  efficiency: number;
}

export class ProductionEntriesQueryDto {
  @ApiProperty({ description: 'Production lot ID' })
  @IsUUID()
  lotId: string;

  @ApiProperty({ description: 'Filter by date (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty({ description: 'Filter by process ID', required: false })
  @IsOptional()
  @IsUUID()
  processId?: string;

  @ApiProperty({ enum: ProductionShift, description: 'Filter by shift', required: false })
  @IsOptional()
  @IsEnum(ProductionShift)
  shift?: ProductionShift;

  @ApiProperty({ description: 'Start date for range filter (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ description: 'End date for range filter (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}