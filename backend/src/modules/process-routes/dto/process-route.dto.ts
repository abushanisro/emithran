import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsUUID,
  IsEnum,
  IsObject,
  Min,
  Max,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum WorkflowState {
  DRAFT = 'draft',
  IN_REVIEW = 'in_review',
  APPROVED = 'approved',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

export enum Priority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum UserRole {
  PROCESS_PLANNER = 'process_planner',
  PRODUCTION_MANAGER = 'production_manager',
  SHOP_FLOOR_USER = 'shop_floor_user',
  DESIGN_ENGINEER = 'design_engineer',
}

// ============================================================================
// Process Route DTOs
// ============================================================================

export class CreateProcessRouteDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  bomItemId: string;

  @ApiProperty({ example: 'Injection Molding Route for Housing' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Complete manufacturing sequence for plastic housing' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Plastic & Rubber' })
  @IsOptional()
  @IsString()
  processGroup?: string;

  @ApiPropertyOptional({ example: 'Injection Molding' })
  @IsOptional()
  @IsString()
  processCategory?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isTemplate?: boolean;

  @ApiPropertyOptional({ example: 'Standard Plastic Molding Template' })
  @IsOptional()
  @IsString()
  templateName?: string;

  @ApiPropertyOptional({ example: 'process_planner', enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  createdByRole?: UserRole;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional({ example: 'normal', enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;
}

export class UpdateProcessRouteDto extends PartialType(CreateProcessRouteDto) {}

export class QueryProcessRoutesDto {
  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;

  @ApiPropertyOptional({ example: 'draft', enum: WorkflowState })
  @IsOptional()
  @IsEnum(WorkflowState)
  workflowState?: WorkflowState;

  @ApiPropertyOptional({ example: 'Machining' })
  @IsOptional()
  @IsString()
  processGroup?: string;

  @ApiPropertyOptional({ example: 'Turning' })
  @IsOptional()
  @IsString()
  processCategory?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isTemplate?: boolean;

  @ApiPropertyOptional({ example: 'process_planner', enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  createdByRole?: UserRole;

  @ApiPropertyOptional({ example: 'high', enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: 'created_at' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ example: 'desc' })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// Workflow Transition DTOs
// ============================================================================

export class WorkflowTransitionDto {
  @ApiPropertyOptional({ example: 'Approved for production with modifications' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ example: 'production_manager', enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

// ============================================================================
// Process Route Step DTOs
// ============================================================================

export class CreateProcessRouteStepDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  processRouteId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  processId: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsNumber()
  @Min(1)
  stepNumber: number;

  @ApiProperty({ example: 'Injection Molding - Cold Runner' })
  @IsString()
  operationName: string;

  @ApiPropertyOptional({ example: 30.5 })
  @IsOptional()
  @IsNumber()
  setupTimeMinutes?: number;

  @ApiPropertyOptional({ example: 2.5 })
  @IsOptional()
  @IsNumber()
  cycleTimeMinutes?: number;

  @ApiPropertyOptional({ example: 5.0 })
  @IsOptional()
  @IsNumber()
  laborHours?: number;

  @ApiPropertyOptional({ example: 3.5 })
  @IsOptional()
  @IsNumber()
  machineHours?: number;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsOptional()
  @IsUUID()
  machineHourRateId?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsOptional()
  @IsUUID()
  laborHourRateId?: string;

  @ApiPropertyOptional({ example: 125.50 })
  @IsOptional()
  @IsNumber()
  calculatedCost?: number;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsOptional()
  @IsUUID()
  calculatorMappingId?: string;

  @ApiPropertyOptional({
    example: { tonnage: 150, shotWeight: 45.5, cycleTime: 30 },
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  extractedValues?: Record<string, any>;

  @ApiPropertyOptional({ example: 'Use standard cooling time parameters' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateProcessRouteStepDto extends PartialType(CreateProcessRouteStepDto) {}

export class ReorderProcessRouteStepsDto {
  @ApiProperty({
    example: [
      '123e4567-e89b-12d3-a456-426614174000',
      '123e4567-e89b-12d3-a456-426614174001',
      '123e4567-e89b-12d3-a456-426614174002',
    ],
    description: 'Array of step IDs in the desired order',
  })
  @IsArray()
  @IsUUID(4, { each: true })
  stepIds: string[];
}

export class ExecuteCalculatorDto {
  @ApiProperty({
    example: { weight: 100, volume: 50, material: 'ABS' },
    type: 'object',
    description: 'Input parameters for the calculator',
    additionalProperties: true,
  })
  @IsObject()
  inputs: Record<string, any>;
}

// ============================================================================
// Session DTOs
// ============================================================================

export class SaveSessionDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  bomItemId: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsOptional()
  @IsUUID()
  processRouteId?: string;

  @ApiPropertyOptional({ example: 'Machining' })
  @IsOptional()
  @IsString()
  activeCategory?: string;

  @ApiPropertyOptional({ example: 'process_planner', enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  activeRole?: UserRole;

  @ApiPropertyOptional({
    example: { expandedRoutes: ['123e4567-e89b-12d3-a456-426614174000'], filters: {} },
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  sessionData?: Record<string, any>;
}

// ============================================================================
// User Role DTOs
// ============================================================================

export class AssignRoleDto {
  @ApiProperty({ example: 'process_planner', enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
