import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsOptional, IsString, IsNumber, IsArray, IsObject, IsDate, IsEnum, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

// =====================================================
// ENUMS
// =====================================================

export enum TrackingStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ON_HOLD = 'ON_HOLD',
  CANCELLED = 'CANCELLED',
  DELAYED = 'DELAYED'
}

export enum ChangeType {
  SCHEDULE_UPDATE = 'schedule_update',
  PROGRESS_UPDATE = 'progress_update',
  STATUS_CHANGE = 'status_change',
  TIMELINE_ADJUSTMENT = 'timeline_adjustment'
}

export enum EntityType {
  TIMELINE = 'timeline',
  PROCESS = 'process',
  SUBTASK = 'subtask',
  BOM_ITEM = 'bom_item'
}

// =====================================================
// TIMELINE MANAGEMENT DTOs
// =====================================================

export class WeekConfigDto {
  @ApiProperty({ description: 'Week number' })
  @IsNumber()
  week: number;

  @ApiProperty({ description: 'Week start date' })
  @IsString()
  start_date: string;

  @ApiProperty({ description: 'Week end date' })
  @IsString()
  end_date: string;

  @ApiProperty({ description: 'Week label' })
  @IsString()
  label: string;
}

export class CreateTimelineDto {
  @ApiProperty({ description: 'Production lot ID' })
  @IsUUID()
  @IsNotEmpty()
  production_lot_id: string;

  @ApiProperty({ description: 'Timeline start date' })
  @IsString()
  @IsNotEmpty()
  timeline_start_date: string;

  @ApiProperty({ description: 'Timeline end date' })
  @IsString()
  @IsNotEmpty()
  timeline_end_date: string;

  @ApiProperty({ description: 'Total weeks in timeline' })
  @IsNumber()
  @Min(1)
  @Max(104) // Max 2 years
  total_weeks: number;

  @ApiProperty({ description: 'Week configuration', type: [WeekConfigDto] })
  @IsArray()
  @Type(() => WeekConfigDto)
  week_config: WeekConfigDto[];
}

export class UpdateTimelineDto {
  @ApiPropertyOptional({ description: 'Timeline start date' })
  @IsString()
  @IsOptional()
  timeline_start_date?: string;

  @ApiPropertyOptional({ description: 'Timeline end date' })
  @IsString()
  @IsOptional()
  timeline_end_date?: string;

  @ApiPropertyOptional({ description: 'Total weeks in timeline' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(104)
  total_weeks?: number;

  @ApiPropertyOptional({ description: 'Week configuration', type: [WeekConfigDto] })
  @IsArray()
  @IsOptional()
  @Type(() => WeekConfigDto)
  week_config?: WeekConfigDto[];
}

// =====================================================
// PROCESS TRACKING DTOs
// =====================================================

export class TimelinePositionDto {
  @ApiProperty({ description: 'Left position percentage' })
  @IsNumber()
  @Min(0)
  @Max(100)
  left_percent: number;

  @ApiProperty({ description: 'Width percentage' })
  @IsNumber()
  @Min(0)
  @Max(100)
  width_percent: number;

  @ApiProperty({ description: 'Weeks covered by this item' })
  @IsArray()
  @IsNumber({}, { each: true })
  weeks_covered: number[];
}

export class CreateProcessTrackingDto {
  @ApiProperty({ description: 'Production process ID' })
  @IsUUID()
  @IsNotEmpty()
  production_process_id: string;

  @ApiProperty({ description: 'Production lot ID' })
  @IsUUID()
  @IsNotEmpty()
  production_lot_id: string;

  @ApiProperty({ description: 'Timeline ID' })
  @IsUUID()
  @IsNotEmpty()
  timeline_id: string;

  @ApiPropertyOptional({ description: 'Scheduled start week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  scheduled_start_week?: number;

  @ApiPropertyOptional({ description: 'Scheduled end week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  scheduled_end_week?: number;

  @ApiPropertyOptional({ description: 'Scheduled duration in weeks' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  scheduled_weeks_duration?: number;

  @ApiPropertyOptional({ description: 'Completion percentage' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  completion_percentage?: number;

  @ApiPropertyOptional({ enum: TrackingStatus })
  @IsEnum(TrackingStatus)
  @IsOptional()
  status?: TrackingStatus;

  @ApiPropertyOptional({ description: 'Timeline position data', type: TimelinePositionDto })
  @IsObject()
  @IsOptional()
  @Type(() => TimelinePositionDto)
  timeline_position?: TimelinePositionDto;
}

export class UpdateProcessTrackingDto {
  @ApiPropertyOptional({ description: 'Scheduled start week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  scheduled_start_week?: number;

  @ApiPropertyOptional({ description: 'Scheduled end week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  scheduled_end_week?: number;

  @ApiPropertyOptional({ description: 'Actual start week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  actual_start_week?: number;

  @ApiPropertyOptional({ description: 'Actual end week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  actual_end_week?: number;

  @ApiPropertyOptional({ description: 'Completion percentage' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  completion_percentage?: number;

  @ApiPropertyOptional({ enum: TrackingStatus })
  @IsEnum(TrackingStatus)
  @IsOptional()
  status?: TrackingStatus;

  @ApiPropertyOptional({ description: 'Timeline position data', type: TimelinePositionDto })
  @IsObject()
  @IsOptional()
  @Type(() => TimelinePositionDto)
  timeline_position?: TimelinePositionDto;
}

// =====================================================
// SUBTASK TRACKING DTOs
// =====================================================

export class CreateSubtaskTrackingDto {
  @ApiProperty({ description: 'Subtask ID' })
  @IsUUID()
  @IsNotEmpty()
  subtask_id: string;

  @ApiProperty({ description: 'Production process ID' })
  @IsUUID()
  @IsNotEmpty()
  production_process_id: string;

  @ApiProperty({ description: 'Timeline ID' })
  @IsUUID()
  @IsNotEmpty()
  timeline_id: string;

  @ApiPropertyOptional({ description: 'Scheduled start week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  scheduled_start_week?: number;

  @ApiPropertyOptional({ description: 'Scheduled end week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  scheduled_end_week?: number;

  @ApiPropertyOptional({ description: 'Completion percentage' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  completion_percentage?: number;

  @ApiPropertyOptional({ enum: TrackingStatus })
  @IsEnum(TrackingStatus)
  @IsOptional()
  status?: TrackingStatus;

  @ApiPropertyOptional({ description: 'Timeline position data', type: TimelinePositionDto })
  @IsObject()
  @IsOptional()
  @Type(() => TimelinePositionDto)
  timeline_position?: TimelinePositionDto;

  @ApiPropertyOptional({ description: 'Background color' })
  @IsString()
  @IsOptional()
  background_color?: string;

  @ApiPropertyOptional({ description: 'Opacity' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  opacity?: number;
}

export class UpdateSubtaskTrackingDto {
  @ApiPropertyOptional({ description: 'Scheduled start week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  scheduled_start_week?: number;

  @ApiPropertyOptional({ description: 'Scheduled end week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  scheduled_end_week?: number;

  @ApiPropertyOptional({ description: 'Actual start week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  actual_start_week?: number;

  @ApiPropertyOptional({ description: 'Actual end week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  actual_end_week?: number;

  @ApiPropertyOptional({ description: 'Completion percentage' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  completion_percentage?: number;

  @ApiPropertyOptional({ enum: TrackingStatus })
  @IsEnum(TrackingStatus)
  @IsOptional()
  status?: TrackingStatus;

  @ApiPropertyOptional({ description: 'Timeline position data', type: TimelinePositionDto })
  @IsObject()
  @IsOptional()
  @Type(() => TimelinePositionDto)
  timeline_position?: TimelinePositionDto;

  @ApiPropertyOptional({ description: 'Background color' })
  @IsString()
  @IsOptional()
  background_color?: string;

  @ApiPropertyOptional({ description: 'Opacity' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  opacity?: number;
}

// =====================================================
// BOM ITEM TRACKING DTOs
// =====================================================

export class CreateBomTrackingDto {
  @ApiProperty({ description: 'BOM requirement ID' })
  @IsUUID()
  @IsNotEmpty()
  bom_requirement_id: string;

  @ApiProperty({ description: 'Subtask tracking ID' })
  @IsUUID()
  @IsNotEmpty()
  subtask_tracking_id: string;

  @ApiProperty({ description: 'Timeline ID' })
  @IsUUID()
  @IsNotEmpty()
  timeline_id: string;

  @ApiProperty({ description: 'BOM item ID' })
  @IsUUID()
  @IsNotEmpty()
  bom_item_id: string;

  @ApiPropertyOptional({ description: 'Part number' })
  @IsString()
  @IsOptional()
  part_number?: string;

  @ApiPropertyOptional({ description: 'Description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Required quantity' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  required_quantity: number;

  @ApiPropertyOptional({ description: 'Completed quantity' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  completed_quantity?: number;

  @ApiPropertyOptional({ description: 'Unit' })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiPropertyOptional({ description: 'Timeline position data', type: TimelinePositionDto })
  @IsObject()
  @IsOptional()
  @Type(() => TimelinePositionDto)
  timeline_position?: TimelinePositionDto;

  @ApiPropertyOptional({ description: 'Background color' })
  @IsString()
  @IsOptional()
  background_color?: string;

  @ApiPropertyOptional({ description: 'Opacity' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  opacity?: number;
}

export class UpdateBomTrackingDto {
  @ApiPropertyOptional({ description: 'Scheduled start week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  scheduled_start_week?: number;

  @ApiPropertyOptional({ description: 'Scheduled end week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  scheduled_end_week?: number;

  @ApiPropertyOptional({ description: 'Actual start week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  actual_start_week?: number;

  @ApiPropertyOptional({ description: 'Actual end week' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  actual_end_week?: number;

  @ApiPropertyOptional({ description: 'Completed quantity' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  completed_quantity?: number;

  @ApiPropertyOptional({ description: 'Completion percentage' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  completion_percentage?: number;

  @ApiPropertyOptional({ enum: TrackingStatus })
  @IsEnum(TrackingStatus)
  @IsOptional()
  status?: TrackingStatus;

  @ApiPropertyOptional({ description: 'Timeline position data', type: TimelinePositionDto })
  @IsObject()
  @IsOptional()
  @Type(() => TimelinePositionDto)
  timeline_position?: TimelinePositionDto;

  @ApiPropertyOptional({ description: 'Background color' })
  @IsString()
  @IsOptional()
  background_color?: string;

  @ApiPropertyOptional({ description: 'Opacity' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  opacity?: number;
}

// =====================================================
// QUERY DTOs
// =====================================================

export class QueryTrackingDto {
  @ApiPropertyOptional({ description: 'Status filter', enum: TrackingStatus })
  @IsEnum(TrackingStatus)
  @IsOptional()
  status?: TrackingStatus;

  @ApiPropertyOptional({ description: 'Entity type filter', enum: EntityType })
  @IsEnum(EntityType)
  @IsOptional()
  entity_type?: EntityType;

  @ApiPropertyOptional({ description: 'Start date filter' })
  @IsString()
  @IsOptional()
  start_date?: string;

  @ApiPropertyOptional({ description: 'End date filter' })
  @IsString()
  @IsOptional()
  end_date?: string;

  @ApiPropertyOptional({ description: 'Page number for pagination' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}

// =====================================================
// RESPONSE DTOs
// =====================================================

export class TimelineResponseDto {
  @ApiProperty({ description: 'Timeline ID' })
  id: string;

  @ApiProperty({ description: 'Production lot ID' })
  production_lot_id: string;

  @ApiProperty({ description: 'Timeline start date' })
  timeline_start_date: string;

  @ApiProperty({ description: 'Timeline end date' })
  timeline_end_date: string;

  @ApiProperty({ description: 'Total weeks' })
  total_weeks: number;

  @ApiProperty({ description: 'Week configuration' })
  week_config: WeekConfigDto[];

  @ApiProperty({ description: 'Created timestamp' })
  created_at: string;

  @ApiProperty({ description: 'Updated timestamp' })
  updated_at: string;
}

export class TrackingHistoryDto {
  @ApiProperty({ description: 'Change ID' })
  id: string;

  @ApiProperty({ description: 'Entity type', enum: EntityType })
  entity_type: EntityType;

  @ApiProperty({ description: 'Entity ID' })
  entity_id: string;

  @ApiProperty({ description: 'Change type', enum: ChangeType })
  change_type: ChangeType;

  @ApiProperty({ description: 'Old data before change' })
  old_data: any;

  @ApiProperty({ description: 'New data after change' })
  new_data: any;

  @ApiProperty({ description: 'User who made the change' })
  changed_by: string;

  @ApiProperty({ description: 'Reason for change' })
  change_reason: string;

  @ApiProperty({ description: 'Change timestamp' })
  created_at: string;
}