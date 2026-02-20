import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  CreateSupplierEvaluationDto,
  UpdateSupplierEvaluationDto,
  QuerySupplierEvaluationDto,
  SupplierEvaluationResponseDto,
  EvaluationStatus,
} from './dto/supplier-evaluation.dto';

@Injectable()
export class SupplierEvaluationService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  // ============================================================================
  // EVALUATION CRUD
  // ============================================================================

  /**
   * Create a new supplier evaluation
   */
  async create(
    dto: CreateSupplierEvaluationDto,
    userId: string,
    accessToken: string,
  ): Promise<SupplierEvaluationResponseDto> {
    this.logger.log('Creating supplier evaluation', 'SupplierEvaluationService');

    // CRITICAL GUARD: Validate vendor has capability for the process
    await this.assertVendorHasProcess(dto.vendorId, dto.processId, userId, accessToken);

    // Build evaluation record
    const record = {
      user_id: userId,
      vendor_id: dto.vendorId,
      project_id: dto.projectId || null,
      bom_item_id: dto.bomItemId || null,
      process_id: dto.processId, // REQUIRED: Process context for evaluation
      material_availability_score: dto.materialAvailabilityScore || 0,
      equipment_capability_score: dto.equipmentCapabilityScore || 0,
      process_feasibility_score: dto.processFeasibilityScore || 0,
      quality_certification_score: dto.qualityCertificationScore || 0,
      financial_stability_score: dto.financialStabilityScore || 0,
      capacity_score: dto.capacityScore || 0,
      lead_time_score: dto.leadTimeScore || 0,
      quoted_cost: dto.quotedCost || null,
      market_average_cost: dto.marketAverageCost || null,
      cost_competitiveness_score: dto.costCompetitivenessScore || null,
      vendor_rating_score: dto.vendorRatingScore || null,
      evaluation_round: dto.evaluationRound || 1,
      evaluator_notes: dto.evaluatorNotes || null,
      recommendation_status: dto.recommendationStatus || 'pending',
      status: 'draft',
    };

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('supplier_evaluation_records')
      .insert(record)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating evaluation: ${error.message}`, 'SupplierEvaluationService');
      
      // Handle duplicate evaluation constraint
      if (error.message.includes('duplicate key') && error.message.includes('supplier_evaluation_records')) {
        if (error.message.includes('vendor_process_evaluation_unique')) {
          throw new ConflictException(
            'A supplier evaluation for this vendor and process combination already exists. Please update the existing evaluation instead.'
          );
        }
        if (error.message.includes('vendor_bom_item_evaluation_unique')) {
          throw new ConflictException(
            'A supplier evaluation for this vendor and BOM item already exists. Please update the existing evaluation instead.'
          );
        }
      }
      
      // Handle foreign key constraints
      if (error.message.includes('violates foreign key constraint')) {
        if (error.message.includes('vendor_id')) {
          throw new BadRequestException('The specified vendor does not exist or you do not have access to it.');
        }
        if (error.message.includes('project_id')) {
          throw new BadRequestException('The specified project does not exist or you do not have access to it.');
        }
        if (error.message.includes('bom_item_id')) {
          throw new BadRequestException('The specified BOM item does not exist or has been deleted.');
        }
        if (error.message.includes('process_id')) {
          throw new BadRequestException('The specified manufacturing process does not exist.');
        }
      }
      
      // Handle validation constraints
      if (error.message.includes('violates check constraint')) {
        if (error.message.includes('evaluation_scores_range')) {
          throw new BadRequestException('Evaluation scores must be between 0 and 100.');
        }
        if (error.message.includes('evaluation_round_positive')) {
          throw new BadRequestException('Evaluation round must be a positive number.');
        }
        if (error.message.includes('cost_values_positive')) {
          throw new BadRequestException('Cost values must be positive numbers.');
        }
      }
      
      throw new InternalServerErrorException(
        'Failed to create supplier evaluation. Please check your input and try again.'
      );
    }

    // Calculate weighted score
    const evaluation = await this.calculateWeightedScore(data, userId, accessToken);

    return this.mapToResponseDto(evaluation);
  }

  /**
   * Find all evaluations with optional filtering
   */
  async findAll(
    query: QuerySupplierEvaluationDto,
    userId: string,
    accessToken: string,
  ): Promise<SupplierEvaluationResponseDto[]> {
    this.logger.log('Fetching supplier evaluations', 'SupplierEvaluationService');

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('supplier_evaluation_summary')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    // Apply filters
    if (query.vendorId) {
      queryBuilder = queryBuilder.eq('vendor_id', query.vendorId);
    }
    if (query.projectId) {
      queryBuilder = queryBuilder.eq('project_id', query.projectId);
    }
    if (query.bomItemId) {
      queryBuilder = queryBuilder.eq('bom_item_id', query.bomItemId);
    }
    if (query.processId) {
      queryBuilder = queryBuilder.eq('process_id', query.processId);
    }
    if (query.status) {
      queryBuilder = queryBuilder.eq('status', query.status);
    }
    if (query.recommendationStatus) {
      queryBuilder = queryBuilder.eq('recommendation_status', query.recommendationStatus);
    }
    if (query.isFrozen !== undefined) {
      queryBuilder = queryBuilder.eq('is_frozen', query.isFrozen);
    }
    if (query.evaluationRound) {
      queryBuilder = queryBuilder.eq('evaluation_round', query.evaluationRound);
    }

    const { data, error } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching evaluations: ${error.message}`, 'SupplierEvaluationService');
      
      // Handle access permissions
      if (error.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access these supplier evaluations.');
      }
      
      throw new InternalServerErrorException(
        'Unable to retrieve supplier evaluations. Please try again later.'
      );
    }

    return data.map((record) => this.mapToResponseDto(record));
  }

  /**
   * Find evaluation by ID
   */
  async findOne(
    id: string,
    userId: string,
    accessToken: string,
  ): Promise<SupplierEvaluationResponseDto> {
    this.logger.log(`Fetching evaluation ${id}`, 'SupplierEvaluationService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('supplier_evaluation_summary')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) {
      this.logger.error(`Error fetching evaluation ${id}: ${error.message}`, 'SupplierEvaluationService');
      
      if (error.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access this supplier evaluation.');
      }
      
      throw new InternalServerErrorException('Unable to retrieve the supplier evaluation. Please try again later.');
    }
    
    if (!data) {
      throw new NotFoundException(`Supplier evaluation with ID ${id} was not found or you do not have access to it.`);
    }

    return this.mapToResponseDto(data);
  }

  /**
   * Update evaluation (only if not frozen)
   */
  async update(
    id: string,
    dto: UpdateSupplierEvaluationDto,
    userId: string,
    accessToken: string,
  ): Promise<SupplierEvaluationResponseDto> {
    this.logger.log(`Updating evaluation ${id}`, 'SupplierEvaluationService');

    // Check if evaluation exists and is not frozen
    const existing = await this.findOne(id, userId, accessToken);
    if (existing.isFrozen) {
      throw new ForbiddenException(
        'This supplier evaluation has been approved and frozen. No further modifications are allowed. Create a new evaluation if changes are needed.'
      );
    }

    // Guard recommendation status changes
    if (dto.recommendationStatus && existing.status === 'draft') {
      throw new BadRequestException(
        'Cannot set recommendation status while evaluation is still in draft. Please complete the evaluation first.'
      );
    }

    // Validate score ranges if provided
    const scoreFields = [
      'materialAvailabilityScore', 'equipmentCapabilityScore', 'processFeasibilityScore',
      'qualityCertificationScore', 'financialStabilityScore', 'capacityScore', 
      'leadTimeScore', 'costCompetitivenessScore', 'vendorRatingScore'
    ];
    
    for (const field of scoreFields) {
      const value = (dto as any)[field];
      if (value !== undefined && (value < 0 || value > 100)) {
        const fieldName = field.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, str => str.toUpperCase());
        throw new BadRequestException(`${fieldName} must be between 0 and 100.`);
      }
    }

    // Validate cost values if provided
    if (dto.quotedCost !== undefined && dto.quotedCost < 0) {
      throw new BadRequestException('Quoted cost must be a positive number.');
    }
    if (dto.marketAverageCost !== undefined && dto.marketAverageCost < 0) {
      throw new BadRequestException('Market average cost must be a positive number.');
    }

    // Build update object
    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    if (dto.materialAvailabilityScore !== undefined) updates.material_availability_score = dto.materialAvailabilityScore;
    if (dto.equipmentCapabilityScore !== undefined) updates.equipment_capability_score = dto.equipmentCapabilityScore;
    if (dto.processFeasibilityScore !== undefined) updates.process_feasibility_score = dto.processFeasibilityScore;
    if (dto.qualityCertificationScore !== undefined) updates.quality_certification_score = dto.qualityCertificationScore;
    if (dto.financialStabilityScore !== undefined) updates.financial_stability_score = dto.financialStabilityScore;
    if (dto.capacityScore !== undefined) updates.capacity_score = dto.capacityScore;
    if (dto.leadTimeScore !== undefined) updates.lead_time_score = dto.leadTimeScore;
    if (dto.quotedCost !== undefined) updates.quoted_cost = dto.quotedCost;
    if (dto.marketAverageCost !== undefined) updates.market_average_cost = dto.marketAverageCost;
    if (dto.costCompetitivenessScore !== undefined) updates.cost_competitiveness_score = dto.costCompetitivenessScore;
    if (dto.vendorRatingScore !== undefined) updates.vendor_rating_score = dto.vendorRatingScore;
    if (dto.evaluatorNotes !== undefined) updates.evaluator_notes = dto.evaluatorNotes;
    if (dto.recommendationStatus !== undefined) updates.recommendation_status = dto.recommendationStatus;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('supplier_evaluation_records')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating evaluation: ${error.message}`, 'SupplierEvaluationService');
      
      // Handle concurrent update conflicts
      if (error.message.includes('row was updated by another user')) {
        throw new ConflictException(
          'This evaluation has been modified by another user. Please refresh and try again.'
        );
      }
      
      // Handle validation constraints
      if (error.message.includes('violates check constraint')) {
        if (error.message.includes('evaluation_scores_range')) {
          throw new BadRequestException('All evaluation scores must be between 0 and 100.');
        }
        if (error.message.includes('cost_values_positive')) {
          throw new BadRequestException('Cost values must be positive numbers.');
        }
      }
      
      throw new InternalServerErrorException(
        'Failed to update supplier evaluation. Please verify your input and try again.'
      );
    }

    // Recalculate weighted score
    const evaluation = await this.calculateWeightedScore(data, userId, accessToken);

    return this.mapToResponseDto(evaluation);
  }

  /**
   * Delete evaluation (only if not frozen)
   */
  async delete(id: string, userId: string, accessToken: string): Promise<void> {
    this.logger.log(`Deleting evaluation ${id}`, 'SupplierEvaluationService');

    // Check if evaluation exists and is not frozen
    const existing = await this.findOne(id, userId, accessToken);
    if (existing.isFrozen) {
      throw new ForbiddenException(
        'This supplier evaluation has been approved and frozen. It cannot be deleted to maintain audit trail integrity.'
      );
    }

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('supplier_evaluation_records')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`Error deleting evaluation: ${error.message}`, 'SupplierEvaluationService');
      
      // Handle foreign key constraint violations (evaluation referenced elsewhere)
      if (error.message.includes('violates foreign key constraint')) {
        throw new ConflictException(
          'This supplier evaluation cannot be deleted as it is referenced by other records. Please archive it instead.'
        );
      }
      
      throw new InternalServerErrorException(
        'Failed to delete supplier evaluation. Please try again later.'
      );
    }
  }

  // ============================================================================
  // STATUS TRANSITIONS (Commands)
  // ============================================================================

  /**
   * Mark evaluation as completed
   */
  async complete(id: string, userId: string, accessToken: string): Promise<SupplierEvaluationResponseDto> {
    this.logger.log(`Marking evaluation ${id} as completed`, 'SupplierEvaluationService');

    const existing = await this.findOne(id, userId, accessToken);
    if (existing.isFrozen) {
      throw new ForbiddenException(
        'This supplier evaluation has been approved and frozen. Its status cannot be changed.'
      );
    }
    
    if (existing.status === 'completed') {
      throw new BadRequestException(
        'This supplier evaluation is already marked as completed.'
      );
    }
    
    // Validate that all required scores are provided before completing
    const requiredFields = [
      'materialAvailabilityScore', 'equipmentCapabilityScore', 'processFeasibilityScore',
      'qualityCertificationScore', 'financialStabilityScore', 'capacityScore', 'leadTimeScore'
    ];
    
    const missingScores = [];
    for (const field of requiredFields) {
      const fieldKey = field.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (!(existing as any)[fieldKey] && (existing as any)[fieldKey] !== 0) {
        missingScores.push(field.replace(/([A-Z])/g, ' $1').toLowerCase());
      }
    }
    
    if (missingScores.length > 0) {
      throw new BadRequestException(
        `Cannot complete evaluation. Missing required scores: ${missingScores.join(', ')}. Please provide all evaluation criteria scores.`
      );
    }

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('supplier_evaluation_records')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error completing evaluation: ${error.message}`, 'SupplierEvaluationService');
      throw new InternalServerErrorException(
        'Failed to mark evaluation as completed. Please try again later.'
      );
    }

    return this.mapToResponseDto(data);
  }

  /**
   * Approve evaluation (freezes it and creates snapshot)
   */
  async approve(id: string, userId: string, accessToken: string): Promise<{ snapshotId: string }> {
    this.logger.log(`Approving and freezing evaluation ${id}`, 'SupplierEvaluationService');

    const existing = await this.findOne(id, userId, accessToken);
    if (existing.isFrozen) {
      throw new BadRequestException(
        'This supplier evaluation has already been approved and frozen. No further action is required.'
      );
    }
    
    if (existing.status !== 'completed') {
      throw new BadRequestException(
        'Only completed evaluations can be approved. Please complete the evaluation first.'
      );
    }
    
    // Validate that evaluation has recommendation status set
    if (!existing.recommendationStatus || existing.recommendationStatus === 'pending') {
      throw new BadRequestException(
        'Please set a recommendation status (approved/rejected/conditional) before approving the evaluation.'
      );
    }

    // Call freeze_evaluation function
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .rpc('freeze_evaluation', {
        p_evaluation_id: id,
        p_user_id: userId,
      });

    if (error) {
      this.logger.error(`Error approving evaluation: ${error.message}`, 'SupplierEvaluationService');
      
      // Handle specific approval errors
      if (error.message.includes('evaluation not found')) {
        throw new NotFoundException('The supplier evaluation to approve was not found.');
      }
      
      if (error.message.includes('already frozen')) {
        throw new BadRequestException('This evaluation has already been approved and frozen.');
      }
      
      throw new InternalServerErrorException(
        'Failed to approve and freeze the supplier evaluation. Please try again later.'
      );
    }

    return { snapshotId: data };
  }

  // ============================================================================
  // VALIDATION GUARDS
  // ============================================================================

  /**
   * Assert that a vendor has capability for a specific process
   * OEM-critical validation: prevents invalid vendor-process combinations
   *
   * @throws BadRequestException if vendor lacks process capability
   */
  private async assertVendorHasProcess(
    vendorId: string,
    processId: string,
    userId: string,
    accessToken: string,
  ): Promise<void> {
    this.logger.log(
      `Validating vendor ${vendorId} has capability for process ${processId}`,
      'SupplierEvaluationService',
    );

    // Query vendor_process_capabilities table
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_process_capabilities')
      .select('id')
      .eq('vendor_id', vendorId)
      .eq('process_id', processId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Error checking vendor-process capability: ${error.message}`,
        'SupplierEvaluationService',
      );
      
      if (error.message.includes('invalid input syntax for type uuid')) {
        throw new BadRequestException(
          'Invalid vendor ID or process ID format provided. Please check your selection.'
        );
      }
      
      throw new InternalServerErrorException(
        'Unable to validate vendor process capability. Please try again later.'
      );
    }

    if (!data) {
      this.logger.warn(
        `Vendor ${vendorId} does not have capability for process ${processId}`,
        'SupplierEvaluationService',
      );
      throw new BadRequestException(
        'The selected vendor does not have registered capability for the specified manufacturing process. ' +
        'Please either select a different vendor or ensure the vendor\'s process capabilities are properly configured in the system.'
      );
    }

    this.logger.log(
      `Vendor ${vendorId} has valid capability for process ${processId}`,
      'SupplierEvaluationService',
    );
  }

  // ============================================================================
  // CALCULATION LOGIC
  // ============================================================================

  /**
   * Calculate weighted score for evaluation
   * Uses criteria weights from evaluation_criteria_weights table
   */
  private async calculateWeightedScore(
    evaluation: any,
    userId: string,
    accessToken: string,
  ): Promise<any> {
    // Get weights for this user/project
    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('evaluation_criteria_weights')
      .select('*')
      .eq('user_id', userId);

    if (evaluation.project_id) {
      queryBuilder = queryBuilder.eq('project_id', evaluation.project_id);
    }

    queryBuilder = queryBuilder.order('project_id', { ascending: false, nullsFirst: false }).limit(1);

    const { data: weights } = await queryBuilder.single();

    // Use defaults if no weights found
    const costWeight = weights?.cost_competency_weight || 30.0;
    const vendorWeight = weights?.vendor_rating_weight || 30.0;
    const technicalWeight = weights?.technical_capability_weight || 40.0;

    // Calculate component scores (0-100 scale)
    const technicalPercentage =
      (evaluation.technical_total_score / (evaluation.technical_max_score || 700)) * 100;
    const costScore = evaluation.cost_competitiveness_score || 0;
    const vendorScore = evaluation.vendor_rating_score || 0;

    // Calculate weighted score
    const weightedScore =
      (costScore * (costWeight / 100)) +
      (vendorScore * (vendorWeight / 100)) +
      (technicalPercentage * (technicalWeight / 100));

    // Update the evaluation record
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('supplier_evaluation_records')
      .update({
        overall_weighted_score: weightedScore,
      })
      .eq('id', evaluation.id)
      .select()
      .single();

    if (error) {
      this.logger.warn(`Error updating weighted score: ${error.message}`, 'SupplierEvaluationService');
      // Don't throw error for weighted score calculation failures as it's not critical
      // The evaluation can still be saved without the weighted score
      return evaluation;
    }

    return data;
  }

  // ============================================================================
  // MAPPING
  // ============================================================================

  private mapToResponseDto(record: any): SupplierEvaluationResponseDto {
    return {
      id: record.id,
      userId: record.user_id,
      vendorId: record.vendor_id,
      vendorName: record.vendor_name,
      projectId: record.project_id,
      bomItemId: record.bom_item_id,
      processId: record.process_id,
      processName: record.process_name,
      materialAvailabilityScore: Number(record.material_availability_score),
      equipmentCapabilityScore: Number(record.equipment_capability_score),
      processFeasibilityScore: Number(record.process_feasibility_score),
      qualityCertificationScore: Number(record.quality_certification_score),
      financialStabilityScore: Number(record.financial_stability_score),
      capacityScore: Number(record.capacity_score),
      leadTimeScore: Number(record.lead_time_score),
      technicalTotalScore: Number(record.technical_total_score),
      technicalMaxScore: Number(record.technical_max_score),
      technicalPercentage: Number(record.technical_percentage),
      quotedCost: record.quoted_cost ? Number(record.quoted_cost) : undefined,
      marketAverageCost: record.market_average_cost ? Number(record.market_average_cost) : undefined,
      costCompetitivenessScore: record.cost_competitiveness_score ? Number(record.cost_competitiveness_score) : undefined,
      vendorRatingScore: record.vendor_rating_score ? Number(record.vendor_rating_score) : undefined,
      overallWeightedScore: record.overall_weighted_score ? Number(record.overall_weighted_score) : undefined,
      status: record.status as EvaluationStatus,
      evaluationRound: record.evaluation_round,
      evaluatorNotes: record.evaluator_notes,
      recommendationStatus: record.recommendation_status,
      isFrozen: record.is_frozen,
      approvedAt: record.approved_at ? new Date(record.approved_at) : undefined,
      approvedBy: record.approved_by,
      createdAt: new Date(record.created_at),
      updatedAt: new Date(record.updated_at),
    };
  }
}
