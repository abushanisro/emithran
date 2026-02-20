/**
 * Process Cost Service
 *
 * Business logic layer for process cost calculations
 * Integrates the calculation engine with database operations
 *
 * @author Manufacturing Cost Engineering Team
 * @version 1.0.0
 */

import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Logger } from '../../../common/logger/logger.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  CreateProcessCostDto,
  UpdateProcessCostDto,
  QueryProcessCostsDto,
  ProcessCostResponseDto,
  ProcessCostListResponseDto,
} from '../dto/process-cost.dto';
import {
  ProcessCostCalculationEngine,
  ProcessCostInput,
} from '../engines/process-cost-calculation.engine';

@Injectable()
export class ProcessCostService {
  private readonly calculationEngine: ProcessCostCalculationEngine;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {
    this.calculationEngine = new ProcessCostCalculationEngine();
  }

  /**
   * Get all process cost records with pagination and filtering
   */
  async findAll(
    query: QueryProcessCostsDto,
    userId?: string,
    accessToken?: string,
  ): Promise<ProcessCostListResponseDto> {
    this.logger.log('Fetching all process costs', 'ProcessCostService');

    const page = query.page || 1;
    const limit = Math.min(query.limit || 10, 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('process_cost_records')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    // Apply filters
    if (query.isActive !== undefined) {
      queryBuilder = queryBuilder.eq('is_active', query.isActive);
    }

    // Search removed - description field no longer exists

    if (query.processId) {
      queryBuilder = queryBuilder.eq('process_id', query.processId);
    }

    if (query.bomItemId) {
      queryBuilder = queryBuilder.eq('bom_item_id', query.bomItemId);
    }

    // Handle multiple BOM item IDs
    if (query.bomItemIds && query.bomItemIds.length > 0) {
      queryBuilder = queryBuilder.in('bom_item_id', query.bomItemIds);
    }

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching process costs: ${error.message}`, 'ProcessCostService');
      
      // Handle access permissions
      if (error.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access these process cost records.');
      }
      
      // Handle invalid filter values
      if (error.message.includes('invalid input syntax for type uuid')) {
        throw new BadRequestException('One or more filter values have invalid format. Please check your process ID, BOM item ID filters.');
      }
      
      throw new InternalServerErrorException('Unable to retrieve process cost records. Please try again later.');
    }

    const records = (data || []).map((row) => ProcessCostResponseDto.fromDatabase(row));
    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return {
      records,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Get a single process cost record by ID
   * Recalculates on fetch to ensure accuracy
   */
  async findOne(id: string, userId: string, accessToken: string): Promise<ProcessCostResponseDto> {
    this.logger.log(`Fetching process cost: ${id}`, 'ProcessCostService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_cost_records')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      this.logger.error(`Error fetching process cost ${id}: ${error.message}`, 'ProcessCostService');
      
      if (error.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access this process cost record.');
      }
      
      if (error.message.includes('invalid input syntax for type uuid')) {
        throw new BadRequestException('Invalid process cost ID format provided.');
      }
      
      throw new InternalServerErrorException('Unable to retrieve process cost record. Please try again later.');
    }
    
    if (!data) {
      this.logger.error(`Process cost not found: ${id}`, 'ProcessCostService');
      throw new NotFoundException(`Process cost record with ID ${id} was not found or you do not have access to it.`);
    }

    // Recalculate to ensure fresh values
    const recalculatedData = this.recalculateRecord(data);

    return ProcessCostResponseDto.fromDatabase(recalculatedData);
  }

  /**
   * Create a new process cost record with calculation
   */
  async create(
    createDto: CreateProcessCostDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessCostResponseDto> {
    this.logger.log('Creating process cost record', 'ProcessCostService');

    // Prepare input for calculation engine
    const calculationInput: ProcessCostInput = {
      opNbr: createDto.opNbr,
      directRate: createDto.directRate,
      indirectRate: createDto.indirectRate,
      fringeRate: createDto.fringeRate,
      machineRate: createDto.machineRate,
      machineValue: createDto.machineValue,
      currency: createDto.currency,
      shiftPatternHoursPerDay: createDto.shiftPatternHoursPerDay,
      setupManning: createDto.setupManning,
      setupTime: createDto.setupTime,
      batchSize: createDto.batchSize,
      heads: createDto.heads,
      cycleTime: createDto.cycleTime,
      partsPerCycle: createDto.partsPerCycle,
      scrap: createDto.scrap,
      facilityId: createDto.facilityId,
      facilityRateId: createDto.facilityRateId,
      shiftPatternId: createDto.shiftPatternId,
    };

    // Calculate costs
    const calculationResult = this.calculationEngine.calculate(calculationInput);

    // Prepare database record
    const recordData = {
      // Input parameters
      op_nbr: createDto.opNbr || 0,
      process_group: createDto.processGroup,
      process_route: createDto.processRoute,
      operation: createDto.operation,
      mhr_id: createDto.mhrId,
      lsr_id: createDto.lsrId,
      facility_category_id: createDto.facilityCategoryId,
      facility_type_id: createDto.facilityTypeId,
      supplier_id: createDto.supplierId,
      supplier_location_id: createDto.supplierLocationId,
      facility_id: createDto.facilityId,
      facility_rate_id: createDto.facilityRateId,
      direct_rate: createDto.directRate,
      indirect_rate: createDto.indirectRate || 0,
      fringe_rate: createDto.fringeRate || 0,
      machine_rate: createDto.machineRate || 0,
      machine_value: createDto.machineValue || 0,
      labor_rate: createDto.laborRate || 0,
      currency: createDto.currency || 'INR',
      shift_pattern_id: createDto.shiftPatternId,
      shift_pattern_hours_per_day: createDto.shiftPatternHoursPerDay,
      setup_manning: createDto.setupManning,
      setup_time: createDto.setupTime,
      batch_size: createDto.batchSize,
      heads: createDto.heads,
      cycle_time: createDto.cycleTime,
      parts_per_cycle: createDto.partsPerCycle,
      scrap: createDto.scrap,

      // Calculated results
      total_cost_per_part: calculationResult.totalCostPerPart,
      setup_cost_per_part: calculationResult.setupCostPerPart,
      total_cycle_cost_per_part: calculationResult.totalCycleCostPerPart,
      total_cost_before_scrap: calculationResult.totalCostBeforeScrap,
      scrap_adjustment: calculationResult.scrapAdjustment,
      total_batch_cost: calculationResult.totalBatchCost,
      calculation_breakdown: calculationResult,

      // Metadata
      is_active: createDto.isActive !== false,
      notes: createDto.notes,
      user_id: userId,

      // Links
      process_id: createDto.processId,
      process_route_id: createDto.processRouteId,
      bom_item_id: createDto.bomItemId,
    };

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_cost_records')
      .insert(recordData)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Error creating process cost: ${error?.message}`, 'ProcessCostService');
      
      if (error) {
        // Handle duplicate constraint
        if (error.message.includes('duplicate key')) {
          throw new ConflictException(
            'A process cost record with this configuration already exists. Please modify your input or update the existing record.'
          );
        }
        
        // Handle foreign key constraints
        if (error.message.includes('violates foreign key constraint')) {
          if (error.message.includes('process_id')) {
            throw new BadRequestException('The specified process does not exist or you do not have access to it.');
          }
          if (error.message.includes('bom_item_id')) {
            throw new BadRequestException('The specified BOM item does not exist or has been deleted.');
          }
          if (error.message.includes('mhr_id')) {
            throw new BadRequestException('The specified MHR record does not exist or is not accessible.');
          }
          if (error.message.includes('user_id')) {
            throw new BadRequestException('User account is not valid. Please log in again.');
          }
        }
        
        // Handle validation constraints
        if (error.message.includes('violates check constraint')) {
          if (error.message.includes('positive_rates')) {
            throw new BadRequestException('All rate values must be positive numbers.');
          }
          if (error.message.includes('positive_values')) {
            throw new BadRequestException('Time, quantity, and cost values must be positive numbers.');
          }
          if (error.message.includes('cycle_time_positive')) {
            throw new BadRequestException('Cycle time must be greater than zero.');
          }
          if (error.message.includes('batch_size_positive')) {
            throw new BadRequestException('Batch size must be greater than zero.');
          }
        }
      }
      
      throw new InternalServerErrorException('Failed to create process cost record. Please check your input and try again.');
    }

    return ProcessCostResponseDto.fromDatabase(data);
  }

  /**
   * Update an existing process cost record
   * Recalculates automatically when relevant fields change
   */
  async update(
    id: string,
    updateDto: UpdateProcessCostDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessCostResponseDto> {
    this.logger.log(`Updating process cost: ${id}`, 'ProcessCostService');

    // Get existing record
    const { data: existing, error: fetchError } = await this.supabaseService
      .getClient(accessToken)
      .from('process_cost_records')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      this.logger.error(`Error fetching process cost for update ${id}: ${fetchError.message}`, 'ProcessCostService');
      
      if (fetchError.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to update this process cost record.');
      }
      
      if (fetchError.message.includes('invalid input syntax for type uuid')) {
        throw new BadRequestException('Invalid process cost ID format provided.');
      }
      
      throw new InternalServerErrorException('Unable to retrieve process cost record for update.');
    }
    
    if (!existing) {
      this.logger.error(`Process cost not found: ${id}`, 'ProcessCostService');
      throw new NotFoundException(`Process cost record with ID ${id} was not found or you do not have access to it.`);
    }

    // Merge with update values
    const merged = {
      opNbr: updateDto.opNbr ?? existing.op_nbr,
      directRate: updateDto.directRate ?? existing.direct_rate,
      indirectRate: updateDto.indirectRate ?? existing.indirect_rate,
      fringeRate: updateDto.fringeRate ?? existing.fringe_rate,
      machineRate: updateDto.machineRate ?? existing.machine_rate,
      machineValue: updateDto.machineValue ?? existing.machine_value,
      currency: updateDto.currency ?? existing.currency,
      shiftPatternHoursPerDay: updateDto.shiftPatternHoursPerDay ?? existing.shift_pattern_hours_per_day,
      setupManning: updateDto.setupManning ?? existing.setup_manning,
      setupTime: updateDto.setupTime ?? existing.setup_time,
      batchSize: updateDto.batchSize ?? existing.batch_size,
      heads: updateDto.heads ?? existing.heads,
      cycleTime: updateDto.cycleTime ?? existing.cycle_time,
      partsPerCycle: updateDto.partsPerCycle ?? existing.parts_per_cycle,
      scrap: updateDto.scrap ?? existing.scrap,
      facilityId: updateDto.facilityId ?? existing.facility_id,
      facilityRateId: updateDto.facilityRateId ?? existing.facility_rate_id,
      shiftPatternId: updateDto.shiftPatternId ?? existing.shift_pattern_id,
    };

    // Recalculate
    const calculationResult = this.calculationEngine.calculate(merged);

    // Prepare update data
    const updateData: any = {};

    // Update input fields if provided
    if (updateDto.opNbr !== undefined) updateData.op_nbr = updateDto.opNbr;
    if (updateDto.processGroup !== undefined) updateData.process_group = updateDto.processGroup;
    if (updateDto.processRoute !== undefined) updateData.process_route = updateDto.processRoute;
    if (updateDto.operation !== undefined) updateData.operation = updateDto.operation;
    if (updateDto.mhrId !== undefined) updateData.mhr_id = updateDto.mhrId;
    if (updateDto.lsrId !== undefined) updateData.lsr_id = updateDto.lsrId;
    if (updateDto.facilityCategoryId !== undefined) updateData.facility_category_id = updateDto.facilityCategoryId;
    if (updateDto.facilityTypeId !== undefined) updateData.facility_type_id = updateDto.facilityTypeId;
    if (updateDto.supplierId !== undefined) updateData.supplier_id = updateDto.supplierId;
    if (updateDto.supplierLocationId !== undefined) updateData.supplier_location_id = updateDto.supplierLocationId;
    if (updateDto.facilityId !== undefined) updateData.facility_id = updateDto.facilityId;
    if (updateDto.facilityRateId !== undefined) updateData.facility_rate_id = updateDto.facilityRateId;
    if (updateDto.directRate !== undefined) updateData.direct_rate = updateDto.directRate;
    if (updateDto.indirectRate !== undefined) updateData.indirect_rate = updateDto.indirectRate;
    if (updateDto.fringeRate !== undefined) updateData.fringe_rate = updateDto.fringeRate;
    if (updateDto.machineRate !== undefined) updateData.machine_rate = updateDto.machineRate;
    if (updateDto.machineValue !== undefined) updateData.machine_value = updateDto.machineValue;
    if (updateDto.laborRate !== undefined) updateData.labor_rate = updateDto.laborRate;
    if (updateDto.currency !== undefined) updateData.currency = updateDto.currency;
    if (updateDto.shiftPatternId !== undefined) updateData.shift_pattern_id = updateDto.shiftPatternId;
    if (updateDto.shiftPatternHoursPerDay !== undefined) updateData.shift_pattern_hours_per_day = updateDto.shiftPatternHoursPerDay;
    if (updateDto.setupManning !== undefined) updateData.setup_manning = updateDto.setupManning;
    if (updateDto.setupTime !== undefined) updateData.setup_time = updateDto.setupTime;
    if (updateDto.batchSize !== undefined) updateData.batch_size = updateDto.batchSize;
    if (updateDto.heads !== undefined) updateData.heads = updateDto.heads;
    if (updateDto.cycleTime !== undefined) updateData.cycle_time = updateDto.cycleTime;
    if (updateDto.partsPerCycle !== undefined) updateData.parts_per_cycle = updateDto.partsPerCycle;
    if (updateDto.scrap !== undefined) updateData.scrap = updateDto.scrap;
    if (updateDto.isActive !== undefined) updateData.is_active = updateDto.isActive;
    if (updateDto.notes !== undefined) updateData.notes = updateDto.notes;
    if (updateDto.processId !== undefined) updateData.process_id = updateDto.processId;
    if (updateDto.processRouteId !== undefined) updateData.process_route_id = updateDto.processRouteId;
    if (updateDto.bomItemId !== undefined) updateData.bom_item_id = updateDto.bomItemId;

    // Always update calculated fields
    updateData.total_cost_per_part = calculationResult.totalCostPerPart;
    updateData.setup_cost_per_part = calculationResult.setupCostPerPart;
    updateData.total_cycle_cost_per_part = calculationResult.totalCycleCostPerPart;
    updateData.total_cost_before_scrap = calculationResult.totalCostBeforeScrap;
    updateData.scrap_adjustment = calculationResult.scrapAdjustment;
    updateData.total_batch_cost = calculationResult.totalBatchCost;
    updateData.calculation_breakdown = calculationResult;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_cost_records')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Error updating process cost: ${error?.message}`, 'ProcessCostService');
      
      if (error) {
        // Handle concurrent update conflicts
        if (error.message.includes('row was updated by another user')) {
          throw new ConflictException(
            'This process cost record has been modified by another user. Please refresh and try again.'
          );
        }
        
        // Handle validation constraints
        if (error.message.includes('violates check constraint')) {
          if (error.message.includes('positive_rates')) {
            throw new BadRequestException('All rate values must be positive numbers.');
          }
          if (error.message.includes('positive_values')) {
            throw new BadRequestException('Time, quantity, and cost values must be positive numbers.');
          }
        }
        
        // Handle foreign key constraints
        if (error.message.includes('violates foreign key constraint')) {
          if (error.message.includes('process_id')) {
            throw new BadRequestException('The specified process does not exist or you do not have access to it.');
          }
          if (error.message.includes('bom_item_id')) {
            throw new BadRequestException('The specified BOM item does not exist or has been deleted.');
          }
        }
      }
      
      throw new InternalServerErrorException('Failed to update process cost record. Please verify your input and try again.');
    }

    return ProcessCostResponseDto.fromDatabase(data);
  }

  /**
   * Delete a process cost record
   */
  async remove(id: string, userId: string, accessToken: string): Promise<{ message: string }> {
    this.logger.log(`Deleting process cost: ${id}`, 'ProcessCostService');

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_cost_records')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting process cost: ${error.message}`, 'ProcessCostService');
      
      // Handle foreign key constraint violations (process cost referenced elsewhere)
      if (error.message.includes('violates foreign key constraint')) {
        throw new ConflictException(
          'This process cost record cannot be deleted as it is being referenced by other calculations or processes. Please remove those references first.'
        );
      }
      
      throw new InternalServerErrorException('Failed to delete process cost record. Please try again later.');
    }

    return { message: 'Process cost deleted successfully' };
  }

  /**
   * Calculate process cost without saving to database
   * Useful for preview/what-if analysis
   */
  async calculateOnly(input: ProcessCostInput): Promise<any> {
    this.logger.log('Calculating process cost (no save)', 'ProcessCostService');

    try {
      // Validate input before calculation
      if (!input || typeof input !== 'object') {
        throw new BadRequestException('Invalid calculation input provided.');
      }
      
      if (input.cycleTime <= 0) {
        throw new BadRequestException('Cycle time must be greater than zero for cost calculation.');
      }
      
      if (input.batchSize <= 0) {
        throw new BadRequestException('Batch size must be greater than zero for cost calculation.');
      }
      
      const result = this.calculationEngine.calculate(input);
      return result;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Calculation error: ${error.message}`, 'ProcessCostService');
      
      // Handle specific calculation errors
      if (error.message.includes('division by zero')) {
        throw new BadRequestException('Invalid calculation parameters detected. Please check that all time and quantity values are greater than zero.');
      }
      
      if (error.message.includes('invalid number')) {
        throw new BadRequestException('All numeric input values must be valid numbers.');
      }
      
      throw new InternalServerErrorException('Process cost calculation failed due to an unexpected error. Please verify your input values.');
    }
  }

  /**
   * Recalculate an existing record
   * Used when fetching records to ensure fresh calculations
   */
  private recalculateRecord(record: any): any {
    const input: ProcessCostInput = {
      opNbr: record.op_nbr,
      directRate: parseFloat(record.direct_rate) || 0,
      indirectRate: parseFloat(record.indirect_rate) || 0,
      fringeRate: parseFloat(record.fringe_rate) || 0,
      machineRate: parseFloat(record.machine_rate) || 0,
      machineValue: parseFloat(record.machine_value) || 0,
      currency: record.currency,
      shiftPatternHoursPerDay: parseFloat(record.shift_pattern_hours_per_day),
      setupManning: parseFloat(record.setup_manning) || 0,
      setupTime: parseFloat(record.setup_time) || 0,
      batchSize: parseFloat(record.batch_size) || 1,
      heads: parseFloat(record.heads) || 0,
      cycleTime: parseFloat(record.cycle_time) || 0,
      partsPerCycle: parseFloat(record.parts_per_cycle) || 1,
      scrap: parseFloat(record.scrap) || 0,
      facilityId: record.facility_id,
      facilityRateId: record.facility_rate_id,
      shiftPatternId: record.shift_pattern_id,
    };

    const calculationResult = this.calculationEngine.calculate(input);

    return {
      ...record,
      total_cost_per_part: calculationResult.totalCostPerPart,
      setup_cost_per_part: calculationResult.setupCostPerPart,
      total_cycle_cost_per_part: calculationResult.totalCycleCostPerPart,
      total_cost_before_scrap: calculationResult.totalCostBeforeScrap,
      scrap_adjustment: calculationResult.scrapAdjustment,
      total_batch_cost: calculationResult.totalBatchCost,
      calculation_breakdown: calculationResult,
    };
  }
}
