import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkflowState, Priority, UserRole } from './process-route.dto';

export class ProcessRouteResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  bomItemId: string;

  @ApiProperty({ example: 'Injection Molding Route for Housing' })
  name: string;

  @ApiPropertyOptional({ example: 'Complete manufacturing sequence for plastic housing' })
  description?: string;

  @ApiPropertyOptional({ example: false })
  isTemplate?: boolean;

  @ApiPropertyOptional({ example: 'Standard Plastic Molding Template' })
  templateName?: string;

  @ApiProperty({ example: 'Plastic Molding' })
  processGroup: string;

  @ApiPropertyOptional({ example: 'Injection Molding' })
  processCategory?: string;

  @ApiProperty({ example: 'draft', enum: WorkflowState })
  workflowState: WorkflowState;

  @ApiPropertyOptional({ example: '2024-01-15T10:30:00Z' })
  workflowUpdatedAt?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  workflowUpdatedBy?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  approvedBy?: string;

  @ApiPropertyOptional({ example: '2024-01-15T10:30:00Z' })
  approvedAt?: string;

  @ApiProperty({ example: 'process_planner', enum: UserRole })
  createdByRole: UserRole;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  assignedTo?: string;

  @ApiProperty({ example: 'normal', enum: Priority })
  priority: Priority;

  @ApiProperty({ example: 60.0 })
  totalSetupTimeMinutes: number;

  @ApiProperty({ example: 15.5 })
  totalCycleTimeMinutes: number;

  @ApiProperty({ example: 350.75 })
  totalCost: number;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  userId: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  organizationId?: string;

  @ApiProperty({ example: '2024-01-10T08:00:00Z' })
  createdAt: string;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  updatedAt: string;

  // Optional joined data
  @ApiPropertyOptional({ example: 'Housing-001' })
  partNumber?: string;

  @ApiPropertyOptional({ example: 'Main Housing' })
  bomItemName?: string;

  @ApiPropertyOptional({ example: 'Product BOM v1' })
  bomName?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  createdByEmail?: string;

  @ApiPropertyOptional({ example: 'manager@example.com' })
  approvedByEmail?: string;
}

export class ProcessRouteStepResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  processRouteId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  processId: string;

  @ApiProperty({ example: 1 })
  stepNumber: number;

  @ApiProperty({ example: 'Injection Molding - Cold Runner' })
  operationName: string;

  @ApiPropertyOptional({ example: 30.5 })
  setupTimeMinutes?: number;

  @ApiPropertyOptional({ example: 2.5 })
  cycleTimeMinutes?: number;

  @ApiPropertyOptional({ example: 5.0 })
  laborHours?: number;

  @ApiPropertyOptional({ example: 3.5 })
  machineHours?: number;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  machineHourRateId?: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  laborHourRateId?: string;

  @ApiPropertyOptional({ example: 125.50 })
  calculatedCost?: number;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  calculatorMappingId?: string;

  @ApiPropertyOptional({
    example: { tonnage: 150, shotWeight: 45.5, cycleTime: 30 },
  })
  extractedValues?: Record<string, any>;

  @ApiProperty({ example: false })
  isCompleted: boolean;

  @ApiPropertyOptional({ example: 'Use standard cooling time parameters' })
  notes?: string;

  @ApiProperty({ example: '2024-01-10T08:00:00Z' })
  createdAt: string;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  updatedAt: string;

  // Optional joined data
  @ApiPropertyOptional({ example: 'Injection Molding' })
  processName?: string;

  @ApiPropertyOptional({ example: 'Plastic Forming' })
  processCategory?: string;

  @ApiPropertyOptional({ example: 'Injection Molding Calculator' })
  calculatorName?: string;
}

export class WorkflowHistoryResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  processRouteId: string;

  @ApiPropertyOptional({ example: 'draft' })
  fromState?: string;

  @ApiProperty({ example: 'in_review' })
  toState: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  changedBy: string;

  @ApiPropertyOptional({ example: 'process_planner' })
  changedByRole?: string;

  @ApiPropertyOptional({ example: 'Ready for production review' })
  comment?: string;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  createdAt: string;

  // Optional joined data
  @ApiPropertyOptional({ example: 'Injection Molding Route for Housing' })
  routeName?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  changedByEmail?: string;
}

export class UserRoleResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  userId: string;

  @ApiProperty({ example: 'process_planner', enum: UserRole })
  role: UserRole;

  @ApiProperty({ example: true })
  isPrimary: boolean;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  organizationId?: string;

  @ApiProperty({ example: '2024-01-10T08:00:00Z' })
  createdAt: string;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  updatedAt: string;
}

export class SessionResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  userId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  bomItemId: string;

  @ApiPropertyOptional({ example: '123e4567-e89b-12d3-a456-426614174000' })
  processRouteId?: string;

  @ApiPropertyOptional({ example: 'Machining' })
  activeCategory?: string;

  @ApiPropertyOptional({ example: 'process_planner' })
  activeRole?: string;

  @ApiPropertyOptional({
    example: { expandedRoutes: ['123e4567-e89b-12d3-a456-426614174000'], filters: {} },
  })
  sessionData?: Record<string, any>;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  lastAccessedAt: string;

  @ApiProperty({ example: '2024-01-10T08:00:00Z' })
  createdAt: string;
}

export class PaginatedProcessRoutesResponseDto {
  @ApiProperty({ type: [ProcessRouteResponseDto] })
  routes: ProcessRouteResponseDto[];

  @ApiProperty({ example: 45 })
  count: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 50 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class CostSummaryResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  processRouteId: string;

  @ApiProperty({ example: 60.0 })
  totalSetupTimeMinutes: number;

  @ApiProperty({ example: 15.5 })
  totalCycleTimeMinutes: number;

  @ApiProperty({ example: 350.75 })
  totalCost: number;

  @ApiProperty({ example: 3 })
  totalSteps: number;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        stepNumber: { type: 'number', example: 1 },
        operationName: { type: 'string', example: 'Injection Molding' },
        setupTimeMinutes: { type: 'number', example: 30.5 },
        cycleTimeMinutes: { type: 'number', example: 2.5 },
        calculatedCost: { type: 'number', example: 125.50 },
      },
    },
  })
  steps: Array<{
    stepNumber: number;
    operationName: string;
    setupTimeMinutes: number;
    cycleTimeMinutes: number;
    calculatedCost: number;
  }>;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  calculatedAt: string;
}
