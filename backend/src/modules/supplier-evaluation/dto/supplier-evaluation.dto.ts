/**
 * Supplier Evaluation DTOs
 *
 * Data Transfer Objects for Supplier Evaluation API
 * Contextual evaluation of vendors for specific parts/projects
 *
 * @author Manufacturing Cost Engineering Team
 * @version 1.0.0
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  Min,
  Max,
  IsInt,
} from 'class-validator';
import { IsOptionalBoolean } from '../../../common/decorators/validation.decorators';

/**
 * Evaluation status enum
 */
export enum EvaluationStatus {
  DRAFT = 'draft',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  APPROVED = 'approved',
  ARCHIVED = 'archived',
}

/**
 * Recommendation status enum
 */
export enum RecommendationStatus {
  RECOMMENDED = 'recommended',
  CONDITIONAL = 'conditional',
  NOT_RECOMMENDED = 'not_recommended',
  PENDING = 'pending',
}

/**
 * DTO for creating a new supplier evaluation
 */
export class CreateSupplierEvaluationDto {
  @ApiProperty({ description: 'Vendor ID from vendors table', example: 'uuid' })
  @IsUUID()
  vendorId: string;

  @ApiPropertyOptional({ description: 'Project ID', example: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'BOM Item ID being evaluated', example: 'uuid' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;

  @ApiProperty({
    description: 'Process ID - Manufacturing process being evaluated (REQUIRED for process-aware evaluation)',
    example: 'uuid',
  })
  @IsUUID()
  processId: string;

  // Technical Evaluation Scores (0-100 each)
  @ApiPropertyOptional({ description: 'Material availability score (0-100)', example: 85, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  materialAvailabilityScore?: number;

  @ApiPropertyOptional({ description: 'Equipment capability score (0-100)', example: 90, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  equipmentCapabilityScore?: number;

  @ApiPropertyOptional({ description: 'Process feasibility score (0-100)', example: 80, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  processFeasibilityScore?: number;

  @ApiPropertyOptional({ description: 'Quality certification score (0-100)', example: 95, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  qualityCertificationScore?: number;

  @ApiPropertyOptional({ description: 'Financial stability score (0-100)', example: 75, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  financialStabilityScore?: number;

  @ApiPropertyOptional({ description: 'Capacity score (0-100)', example: 85, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  capacityScore?: number;

  @ApiPropertyOptional({ description: 'Lead time score (0-100)', example: 70, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  leadTimeScore?: number;

  // Cost competitiveness
  @ApiPropertyOptional({ description: 'Quoted cost from supplier', example: 125.50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quotedCost?: number;

  @ApiPropertyOptional({ description: 'Market average cost', example: 150.00 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  marketAverageCost?: number;

  @ApiPropertyOptional({ description: 'Cost competitiveness score (0-100)', example: 85, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  costCompetitivenessScore?: number;

  // Vendor rating
  @ApiPropertyOptional({ description: 'Vendor rating score (0-100)', example: 80, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  vendorRatingScore?: number;

  // Metadata
  @ApiPropertyOptional({ description: 'Evaluation round number', example: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  evaluationRound?: number;

  @ApiPropertyOptional({ description: 'Evaluator notes', example: 'Vendor shows strong technical capability' })
  @IsOptional()
  @IsString()
  evaluatorNotes?: string;

  @ApiPropertyOptional({
    description: 'Recommendation status (guarded by service layer - can only be set when status >= completed)',
    enum: RecommendationStatus,
  })
  @IsOptional()
  @IsEnum(RecommendationStatus)
  recommendationStatus?: RecommendationStatus;
}

/**
 * DTO for updating an existing supplier evaluation
 * NOTE: Status transitions must use command endpoints (complete, approve), not PATCH
 */
export class UpdateSupplierEvaluationDto {
  // Technical Evaluation Scores
  @ApiPropertyOptional({ description: 'Material availability score (0-100)', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  materialAvailabilityScore?: number;

  @ApiPropertyOptional({ description: 'Equipment capability score (0-100)', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  equipmentCapabilityScore?: number;

  @ApiPropertyOptional({ description: 'Process feasibility score (0-100)', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  processFeasibilityScore?: number;

  @ApiPropertyOptional({ description: 'Quality certification score (0-100)', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  qualityCertificationScore?: number;

  @ApiPropertyOptional({ description: 'Financial stability score (0-100)', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  financialStabilityScore?: number;

  @ApiPropertyOptional({ description: 'Capacity score (0-100)', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  capacityScore?: number;

  @ApiPropertyOptional({ description: 'Lead time score (0-100)', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  leadTimeScore?: number;

  // Cost competitiveness
  @ApiPropertyOptional({ description: 'Quoted cost from supplier' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quotedCost?: number;

  @ApiPropertyOptional({ description: 'Market average cost' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  marketAverageCost?: number;

  @ApiPropertyOptional({ description: 'Cost competitiveness score (0-100)', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  costCompetitivenessScore?: number;

  // Vendor rating
  @ApiPropertyOptional({ description: 'Vendor rating score (0-100)', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  vendorRatingScore?: number;

  @ApiPropertyOptional({ description: 'Evaluator notes' })
  @IsOptional()
  @IsString()
  evaluatorNotes?: string;

  @ApiPropertyOptional({
    description: 'Recommendation status (guarded by service layer - cannot change after frozen)',
    enum: RecommendationStatus,
  })
  @IsOptional()
  @IsEnum(RecommendationStatus)
  recommendationStatus?: RecommendationStatus;

  // NOTE: Status is NOT included here - use command endpoints:
  // POST /evaluations/:id/complete
  // POST /evaluations/:id/approve
}

/**
 * DTO for querying supplier evaluations
 * TODO P1: Add pagination (limit, offset)
 */
export class QuerySupplierEvaluationDto {
  @ApiPropertyOptional({ description: 'Filter by vendor ID' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ description: 'Filter by project ID' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Filter by BOM item ID' })
  @IsOptional()
  @IsUUID()
  bomItemId?: string;

  @ApiPropertyOptional({ description: 'Filter by process ID' })
  @IsOptional()
  @IsUUID()
  processId?: string;

  @ApiPropertyOptional({ description: 'Filter by status', enum: EvaluationStatus })
  @IsOptional()
  @IsEnum(EvaluationStatus)
  status?: EvaluationStatus;

  @ApiPropertyOptional({ description: 'Filter by recommendation status', enum: RecommendationStatus })
  @IsOptional()
  @IsEnum(RecommendationStatus)
  recommendationStatus?: RecommendationStatus;

  @ApiPropertyOptional({ description: 'Filter frozen evaluations only', example: true })
  @IsOptionalBoolean()
  isFrozen?: boolean;

  @ApiPropertyOptional({ description: 'Evaluation round number' })
  @IsOptional()
  @IsInt()
  evaluationRound?: number;
}

/**
 * Response DTO for supplier evaluation
 *
 * NOTE: Approved evaluations must be accessed via snapshot APIs for nomination.
 * This DTO represents live evaluation state only.
 * Snapshots are internal audit primitives - clients should not reason about snapshot_hash.
 */
export class SupplierEvaluationResponseDto {
  @ApiProperty({ description: 'Evaluation ID' })
  id: string;

  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'Vendor ID' })
  vendorId: string;

  @ApiProperty({ description: 'Vendor name' })
  vendorName: string;

  @ApiPropertyOptional({ description: 'Project ID' })
  projectId?: string;

  @ApiPropertyOptional({ description: 'BOM Item ID' })
  bomItemId?: string;

  @ApiProperty({ description: 'Process ID - Manufacturing process context' })
  processId: string;

  @ApiProperty({ description: 'Process name' })
  processName: string;

  // Technical scores
  @ApiProperty({ description: 'Material availability score' })
  materialAvailabilityScore: number;

  @ApiProperty({ description: 'Equipment capability score' })
  equipmentCapabilityScore: number;

  @ApiProperty({ description: 'Process feasibility score' })
  processFeasibilityScore: number;

  @ApiProperty({ description: 'Quality certification score' })
  qualityCertificationScore: number;

  @ApiProperty({ description: 'Financial stability score' })
  financialStabilityScore: number;

  @ApiProperty({ description: 'Capacity score' })
  capacityScore: number;

  @ApiProperty({ description: 'Lead time score' })
  leadTimeScore: number;

  @ApiProperty({ description: 'Technical total score (sum of all technical scores)' })
  technicalTotalScore: number;

  @ApiProperty({ description: 'Technical max score' })
  technicalMaxScore: number;

  @ApiProperty({ description: 'Technical percentage (0-100)' })
  technicalPercentage: number;

  // Cost & vendor rating
  @ApiPropertyOptional({ description: 'Quoted cost' })
  quotedCost?: number;

  @ApiPropertyOptional({ description: 'Market average cost' })
  marketAverageCost?: number;

  @ApiPropertyOptional({ description: 'Cost competitiveness score' })
  costCompetitivenessScore?: number;

  @ApiPropertyOptional({ description: 'Vendor rating score' })
  vendorRatingScore?: number;

  @ApiPropertyOptional({ description: 'Overall weighted score' })
  overallWeightedScore?: number;

  // Status
  @ApiProperty({ description: 'Evaluation status', enum: EvaluationStatus })
  status: EvaluationStatus;

  @ApiProperty({ description: 'Evaluation round' })
  evaluationRound: number;

  @ApiPropertyOptional({ description: 'Evaluator notes' })
  evaluatorNotes?: string;

  @ApiPropertyOptional({ description: 'Recommendation status', enum: RecommendationStatus })
  recommendationStatus?: RecommendationStatus;

  @ApiProperty({ description: 'Is frozen (immutable)' })
  isFrozen: boolean;

  @ApiPropertyOptional({ description: 'Approved at timestamp' })
  approvedAt?: Date;

  @ApiPropertyOptional({ description: 'Approved by user ID' })
  approvedBy?: string;

  @ApiProperty({ description: 'Created at timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at timestamp' })
  updatedAt: Date;
}
