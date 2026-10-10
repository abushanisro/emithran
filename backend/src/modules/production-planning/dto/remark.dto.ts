import { IsUUID, IsString, IsEnum, IsOptional, IsDateString, IsInt, IsArray, Min, Max, MaxLength, IsNotEmpty } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

enum RemarkType {
  DELAY = 'DELAY',
  QUALITY = 'QUALITY',
  SUGGESTION = 'SUGGESTION',
  SAFETY = 'SAFETY',
  PROCESS = 'PROCESS',
  MATERIAL = 'MATERIAL',
  OTHER = 'OTHER',
}

enum RemarkPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

enum RemarkStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum RemarkScope {
  LOT = 'LOT',
  PROCESS = 'PROCESS',
  SUBTASK = 'SUBTASK',
  BOM_PART = 'BOM_PART',
}

export class CreateRemarkDto {
  @ApiProperty({ 
    description: 'Production lot ID',
    format: 'uuid',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsNotEmpty({ message: 'Lot ID is required' })
  @IsUUID(4, { message: 'Lot ID must be a valid UUID' })
  lotId: string;

  @ApiProperty({ 
    description: 'Title of the remark',
    minLength: 1,
    maxLength: 255,
    example: 'Material delivery delay'
  })
  @IsNotEmpty({ message: 'Title is required' })
  @IsString({ message: 'Title must be a string' })
  @MaxLength(255, { message: 'Title must not exceed 255 characters' })
  @Transform(({ value }) => value?.trim())
  title: string;

  @ApiPropertyOptional({ 
    description: 'Detailed description of the remark',
    example: 'Steel plates delivery is delayed by 2 days due to supplier transport issues.'
  })
  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  @Transform(({ value }) => value?.trim() || undefined)
  description?: string;

  @ApiProperty({ 
    enum: RemarkType,
    description: 'Type of remark',
    example: RemarkType.DELAY
  })
  @IsNotEmpty({ message: 'Remark type is required' })
  @IsEnum(RemarkType, { message: 'Invalid remark type' })
  remarkType: RemarkType;

  @ApiProperty({ 
    enum: RemarkPriority,
    description: 'Priority level',
    example: RemarkPriority.HIGH
  })
  @IsNotEmpty({ message: 'Priority is required' })
  @IsEnum(RemarkPriority, { message: 'Invalid priority level' })
  priority: RemarkPriority;

  @ApiProperty({ 
    enum: RemarkScope,
    description: 'Scope of the remark',
    example: RemarkScope.LOT
  })
  @IsNotEmpty({ message: 'Applies to scope is required' })
  @IsEnum(RemarkScope, { message: 'Invalid scope' })
  appliesTo: RemarkScope;

  @ApiPropertyOptional({ 
    description: 'Process ID if scope is PROCESS or SUBTASK',
    format: 'uuid'
  })
  @IsOptional()
  @IsUUID(4, { message: 'Process ID must be a valid UUID' })
  processId?: string;

  @ApiPropertyOptional({ 
    description: 'Subtask ID if scope is SUBTASK',
    format: 'uuid'
  })
  @IsOptional()
  @IsUUID(4, { message: 'Subtask ID must be a valid UUID' })
  subtaskId?: string;

  @ApiPropertyOptional({ 
    description: 'BOM Part ID if scope is BOM_PART',
    format: 'uuid'
  })
  @IsOptional()
  @IsUUID(4, { message: 'BOM Part ID must be a valid UUID' })
  bomPartId?: string;

  @ApiPropertyOptional({ 
    description: 'Context reference',
    maxLength: 255
  })
  @IsOptional()
  @IsString({ message: 'Context reference must be a string' })
  @MaxLength(255, { message: 'Context reference must not exceed 255 characters' })
  @Transform(({ value }) => value?.trim() || undefined)
  contextReference?: string;

  @ApiPropertyOptional({ 
    description: 'Assigned user name or identifier',
    maxLength: 100
  })
  @IsOptional()
  @IsString({ message: 'Assigned to must be a string' })
  @MaxLength(100, { message: 'Assigned to must not exceed 100 characters' })
  @Transform(({ value }) => value?.trim() || undefined)
  assignedTo?: string;

  @ApiPropertyOptional({ 
    description: 'Due date',
    format: 'date-time'
  })
  @IsOptional()
  @IsDateString({}, { message: 'Due date must be a valid date' })
  dueDate?: string;

  @ApiPropertyOptional({ 
    enum: RemarkPriority,
    description: 'Impact level'
  })
  @IsOptional()
  @IsEnum(RemarkPriority, { message: 'Invalid impact level' })
  impactLevel?: RemarkPriority;

  @ApiPropertyOptional({ 
    description: 'Estimated delay in hours',
    minimum: 0
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Estimated delay hours must be an integer' })
  @Min(0, { message: 'Estimated delay hours cannot be negative' })
  estimatedDelayHours?: number;

  @ApiPropertyOptional({ 
    description: 'Tags for categorization',
    type: [String],
    example: ['material', 'delivery', 'supplier']
  })
  @IsOptional()
  @IsArray({ message: 'Tags must be an array' })
  @IsString({ each: true, message: 'Each tag must be a string' })
  @Transform(({ value }) => Array.isArray(value) ? value.filter(tag => tag?.trim()).map(tag => tag.trim()) : [])
  tags?: string[];
}

export class UpdateRemarkDto {
  @ApiPropertyOptional({ 
    description: 'Title of the remark',
    maxLength: 255
  })
  @IsOptional()
  @IsString({ message: 'Title must be a string' })
  @MaxLength(255, { message: 'Title must not exceed 255 characters' })
  @Transform(({ value }) => value?.trim())
  title?: string;

  @ApiPropertyOptional({ description: 'Detailed description' })
  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  @Transform(({ value }) => value?.trim() || undefined)
  description?: string;

  @ApiPropertyOptional({ enum: RemarkPriority, description: 'Priority level' })
  @IsOptional()
  @IsEnum(RemarkPriority, { message: 'Invalid priority level' })
  priority?: RemarkPriority;

  @ApiPropertyOptional({ enum: RemarkStatus, description: 'Current status' })
  @IsOptional()
  @IsEnum(RemarkStatus, { message: 'Invalid status' })
  status?: RemarkStatus;

  @ApiPropertyOptional({ description: 'Assigned user name or identifier' })
  @IsOptional()
  @IsString({ message: 'Assigned to must be a string' })
  @MaxLength(100, { message: 'Assigned to must not exceed 100 characters' })
  @Transform(({ value }) => value?.trim() || undefined)
  assignedTo?: string;

  @ApiPropertyOptional({ description: 'Due date', format: 'date-time' })
  @IsOptional()
  @IsDateString({}, { message: 'Due date must be a valid date' })
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Resolution notes' })
  @IsOptional()
  @IsString({ message: 'Resolution notes must be a string' })
  @Transform(({ value }) => value?.trim() || undefined)
  resolutionNotes?: string;

  @ApiPropertyOptional({ description: 'Resolved date', format: 'date-time' })
  @IsOptional()
  @IsDateString({}, { message: 'Resolved date must be a valid date' })
  resolvedDate?: string;

  @ApiPropertyOptional({ enum: RemarkPriority, description: 'Impact level' })
  @IsOptional()
  @IsEnum(RemarkPriority, { message: 'Invalid impact level' })
  impactLevel?: RemarkPriority;

  @ApiPropertyOptional({ description: 'Estimated delay in hours', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Estimated delay hours must be an integer' })
  @Min(0, { message: 'Estimated delay hours cannot be negative' })
  estimatedDelayHours?: number;

  @ApiPropertyOptional({ description: 'Actual delay in hours', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Actual delay hours must be an integer' })
  @Min(0, { message: 'Actual delay hours cannot be negative' })
  actualDelayHours?: number;

  @ApiPropertyOptional({ description: 'Tags for categorization', type: [String] })
  @IsOptional()
  @IsArray({ message: 'Tags must be an array' })
  @IsString({ each: true, message: 'Each tag must be a string' })
  @Transform(({ value }) => Array.isArray(value) ? value.filter(tag => tag?.trim()).map(tag => tag.trim()) : [])
  tags?: string[];
}

export class RemarkFilterDto {
  @ApiPropertyOptional({ description: 'Production lot ID', format: 'uuid' })
  @IsOptional()
  @IsUUID(4, { message: 'Lot ID must be a valid UUID' })
  lotId?: string;

  @ApiPropertyOptional({ enum: RemarkType, description: 'Filter by remark type' })
  @IsOptional()
  @IsEnum(RemarkType, { message: 'Invalid remark type' })
  remarkType?: RemarkType;

  @ApiPropertyOptional({ enum: RemarkPriority, description: 'Filter by priority' })
  @IsOptional()
  @IsEnum(RemarkPriority, { message: 'Invalid priority' })
  priority?: RemarkPriority;

  @ApiPropertyOptional({ enum: RemarkStatus, description: 'Filter by status' })
  @IsOptional()
  @IsEnum(RemarkStatus, { message: 'Invalid status' })
  status?: RemarkStatus;

  @ApiPropertyOptional({ enum: RemarkScope, description: 'Filter by scope' })
  @IsOptional()
  @IsEnum(RemarkScope, { message: 'Invalid scope' })
  appliesTo?: RemarkScope;

  @ApiPropertyOptional({ description: 'Assigned user identifier' })
  @IsOptional()
  @IsString({ message: 'Assigned to must be a string' })
  @Transform(({ value }) => value?.trim())
  assignedTo?: string;

  @ApiPropertyOptional({ description: 'Created by user ID', format: 'uuid' })
  @IsOptional()
  @IsUUID(4, { message: 'Created by must be a valid UUID' })
  createdBy?: string;

  @ApiPropertyOptional({ description: 'Search in title and description' })
  @IsOptional()
  @IsString({ message: 'Search term must be a string' })
  @Transform(({ value }) => value?.trim())
  search?: string;

  @ApiPropertyOptional({ description: 'Page number', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be an integer' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit must be an integer' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(100, { message: 'Limit cannot exceed 100' })
  limit?: number = 20;
}

export class CreateCommentDto {
  @ApiProperty({ description: 'Remark ID', format: 'uuid' })
  @IsNotEmpty({ message: 'Remark ID is required' })
  @IsUUID(4, { message: 'Remark ID must be a valid UUID' })
  remarkId: string;

  @ApiProperty({ description: 'Comment text' })
  @IsNotEmpty({ message: 'Comment text is required' })
  @IsString({ message: 'Comment text must be a string' })
  @Transform(({ value }) => value?.trim())
  commentText: string;

  @ApiPropertyOptional({ description: 'Parent comment ID for threading', format: 'uuid' })
  @IsOptional()
  @IsUUID(4, { message: 'Parent comment ID must be a valid UUID' })
  parentCommentId?: string;
}

export class UpdateCommentDto {
  @ApiProperty({ description: 'Updated comment text' })
  @IsNotEmpty({ message: 'Comment text is required' })
  @IsString({ message: 'Comment text must be a string' })
  @Transform(({ value }) => value?.trim())
  commentText: string;
}

// Response DTOs (interfaces for clean separation)
export interface RemarkResponseDto {
  id: string;
  lotId: string;
  title: string;
  description?: string;
  remarkType: RemarkType;
  priority: RemarkPriority;
  status: RemarkStatus;
  appliesTo: RemarkScope;
  processId?: string;
  subtaskId?: string;
  bomPartId?: string;
  contextReference?: string;
  createdBy: string;
  assignedTo?: string;
  reportedDate: string;
  dueDate?: string;
  resolvedDate?: string;
  resolutionNotes?: string;
  impactLevel?: RemarkPriority;
  estimatedDelayHours: number;
  actualDelayHours: number;
  tags: string[];
  attachments: any[];
  createdAt: string;
  updatedAt: string;
  commentsCount?: number;
}

export interface CommentResponseDto {
  id: string;
  remarkId: string;
  commentText: string;
  authorId: string;
  authorName?: string;
  parentCommentId?: string;
  threadLevel: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedRemarksResponseDto {
  data: RemarkResponseDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}