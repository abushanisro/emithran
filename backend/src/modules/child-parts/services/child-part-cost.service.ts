/**
 * Child Part Cost Service
 *
 * Business logic layer for child part cost calculations
 * Integrates the calculation engine with database operations
 *
 * @author Manufacturing Cost Engineering Team
 * @version 1.0.0
 */

import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Logger } from '../../../common/logger/logger.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  CreateChildPartCostDto,
  UpdateChildPartCostDto,
  QueryChildPartCostsDto,
  ChildPartCostResponseDto,
  ChildPartCostListResponseDto,
  CalculateChildPartCostDto,
} from '../dto/child-part-cost.dto';
import {
  ChildPartCostCalculationEngine,
  ChildPartCostInput,
} from '../engines/child-part-cost-calculation.engine';

@Injectable()
export class ChildPartCostService {
  private readonly calculationEngine: ChildPartCostCalculationEngine;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {
    this.calculationEngine = new ChildPartCostCalculationEngine();
  }

  /**
   * Get all child part cost records with pagination and filtering
   */
  async findAll(
    query: QueryChildPartCostsDto,
    userId?: string,
    accessToken?: string,
  ): Promise<ChildPartCostListResponseDto> {
    this.logger.log('Fetching all child part costs', 'ChildPartCostService');

    const page = query.page || 1;
    const limit = Math.min(query.limit || 10, 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('child_part_cost_records')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    // Apply filters
    if (query.isActive !== undefined) {
      queryBuilder = queryBuilder.eq('is_active', query.isActive);
    }

    if (query.makeBuy) {
      queryBuilder = queryBuilder.eq('make_buy', query.makeBuy);
    }

    if (query.bomItemId) {
      queryBuilder = queryBuilder.eq('bom_item_id', query.bomItemId);
    }

    if (query.search) {
      queryBuilder = queryBuilder.or(
        `part_number.ilike.%${query.search}%,part_name.ilike.%${query.search}%`
      );
    }

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching child part costs: ${error.message}`, 'ChildPartCostService');
      throw new InternalServerErrorException(`Failed to fetch child part costs: ${error.message}`);
    }

    const childPartCosts = (data || []).map((row) => ChildPartCostResponseDto.fromDatabase(row));

    return {
      childPartCosts,
      count: count || 0,
      page,
      limit,
    };
  }

  /**
   * Get a single child part cost record by ID
   * Recalculates on fetch to ensure accuracy
   */
  async findOne(id: string, userId: string, accessToken: string): Promise<ChildPartCostResponseDto> {
    this.logger.log(`Fetching child part cost: ${id}`, 'ChildPartCostService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('child_part_cost_records')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      this.logger.error(`Child part cost not found: ${id}`, 'ChildPartCostService');
      throw new NotFoundException(`Child part cost with ID ${id} not found`);
    }

    // Recalculate to ensure fresh values
    const recalculatedData = this.recalculateRecord(data);

    return ChildPartCostResponseDto.fromDatabase(recalculatedData);
  }

  /**
   * Get child part cost by BOM item ID
   */
  async findByBomItemId(
    bomItemId: string,
    userId: string,
    accessToken: string
  ): Promise<ChildPartCostResponseDto | null> {
    this.logger.log(`Fetching child part cost for BOM item: ${bomItemId}`, 'ChildPartCostService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('child_part_cost_records')
      .select('*')
      .eq('bom_item_id', bomItemId)
      .single();

    if (error || !data) {
      return null;
    }

    // Recalculate to ensure fresh values
    const recalculatedData = this.recalculateRecord(data);

    return ChildPartCostResponseDto.fromDatabase(recalculatedData);
  }

  /**
   * Create a new child part cost record with calculation
   *
   * Architecture Note:
   * Uses UPSERT to handle the unique constraint (bom_item_id, user_id).
   * This ensures idempotent operations - if a record already exists for this BOM item,
   * it will be updated instead of causing a duplicate key error.
   * This follows production-grade patterns for data consistency.
   */
  async create(
    createDto: CreateChildPartCostDto,
    userId: string,
    accessToken: string,
  ): Promise<ChildPartCostResponseDto> {
    this.logger.log('Creating child part cost record', 'ChildPartCostService');

    // Prepare input for calculation engine
    const calculationInput: ChildPartCostInput = {
      partNumber: createDto.partNumber,
      partName: createDto.partName,
      description: createDto.description,
      makeBuy: createDto.makeBuy,
      unitCost: createDto.unitCost,
      freight: createDto.freight,
      duty: createDto.duty,
      overhead: createDto.overhead,
      rawMaterialCost: createDto.rawMaterialCost,
      processCost: createDto.processCost,
      scrap: createDto.scrap,
      defectRate: createDto.defectRate,
      quantity: createDto.quantity,
      moq: createDto.moq,
      leadTimeDays: createDto.leadTimeDays,
      currency: createDto.currency,
      supplierId: createDto.supplierId,
      supplierName: createDto.supplierName,
      supplierLocation: createDto.supplierLocation,
      notes: createDto.notes,
    };

    // Calculate costs
    const calculationResult = this.calculationEngine.calculate(calculationInput);

    // Prepare database record
    const recordData = {
      // Links
      bom_item_id: createDto.bomItemId,
      user_id: userId,

      // Input parameters
      part_number: createDto.partNumber || '',
      part_name: createDto.partName || '',
      description: createDto.description || '',
      make_buy: createDto.makeBuy,
      currency: createDto.currency || 'USD',

      // For purchased parts
      unit_cost: createDto.unitCost || 0,
      freight_percentage: createDto.freight || 0,
      duty_percentage: createDto.duty || 0,
      overhead_percentage: createDto.overhead || 0,

      // For manufactured parts
      raw_material_cost_input: createDto.rawMaterialCost || 0,
      process_cost_input: createDto.processCost || 0,

      // Quality parameters
      scrap_percentage: createDto.scrap || 0,
      defect_rate_percentage: createDto.defectRate || 0,

      // Quantity parameters
      quantity: createDto.quantity || 1,
      moq: createDto.moq || 1,
      lead_time_days: createDto.leadTimeDays || 0,

      // Calculated results
      base_cost: calculationResult.baseCost,
      freight_cost: calculationResult.freightCost,
      duty_cost: calculationResult.dutyCost,
      overhead_cost: calculationResult.overheadCost,
      cost_before_quality: calculationResult.costBeforeQuality,
      scrap_adjustment: calculationResult.scrapAdjustment,
      defect_adjustment: calculationResult.defectAdjustment,
      quality_factor: calculationResult.qualityFactor,
      total_cost_per_part: calculationResult.totalCostPerPart,
      extended_cost: calculationResult.extendedCost,
      moq_extended_cost: calculationResult.moqExtendedCost,
      calculation_breakdown: calculationResult,

      // Supplier information
      supplier_id: createDto.supplierId,
      supplier_name: createDto.supplierName,
      supplier_location: createDto.supplierLocation,

      // Metadata
      is_active: createDto.isActive !== false,
      notes: createDto.notes,
    };

    // Use UPSERT to handle cases where a record already exists for this bom_item_id
    // This follows the unique constraint: one cost record per BOM item per user
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('child_part_cost_records')
      .upsert(recordData, {
        onConflict: 'bom_item_id,user_id',
        ignoreDuplicates: false, // Always update existing records
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Error creating child part cost: ${error?.message}`, 'ChildPartCostService');
      throw new InternalServerErrorException(`Failed to create child part cost: ${error?.message}`);
    }

    // Update BOM item cost with this child part cost
    await this.updateBomItemCostFromChildPart(createDto.bomItemId, calculationResult.totalCostPerPart, userId, accessToken);

    return ChildPartCostResponseDto.fromDatabase(data);
  }

  /**
   * Update an existing child part cost record
   * Recalculates automatically when relevant fields change
   */
  async update(
    id: string,
    updateDto: UpdateChildPartCostDto,
    userId: string,
    accessToken: string,
  ): Promise<ChildPartCostResponseDto> {
    this.logger.log(`Updating child part cost: ${id}`, 'ChildPartCostService');

    // Get existing record
    const { data: existing, error: fetchError } = await this.supabaseService
      .getClient(accessToken)
      .from('child_part_cost_records')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      this.logger.error(`Child part cost not found: ${id}`, 'ChildPartCostService');
      throw new NotFoundException(`Child part cost with ID ${id} not found`);
    }

    // Merge with update values
    const merged: ChildPartCostInput = {
      partNumber: updateDto.partNumber ?? existing.part_number,
      partName: updateDto.partName ?? existing.part_name,
      description: updateDto.description ?? existing.description,
      makeBuy: updateDto.makeBuy ?? existing.make_buy,
      unitCost: updateDto.unitCost ?? parseFloat(existing.unit_cost),
      freight: updateDto.freight ?? parseFloat(existing.freight_percentage),
      duty: updateDto.duty ?? parseFloat(existing.duty_percentage),
      overhead: updateDto.overhead ?? parseFloat(existing.overhead_percentage),
      rawMaterialCost: updateDto.rawMaterialCost ?? parseFloat(existing.raw_material_cost_input),
      processCost: updateDto.processCost ?? parseFloat(existing.process_cost_input),
      scrap: updateDto.scrap ?? parseFloat(existing.scrap_percentage),
      defectRate: updateDto.defectRate ?? parseFloat(existing.defect_rate_percentage),
      quantity: updateDto.quantity ?? parseFloat(existing.quantity),
      moq: updateDto.moq ?? parseFloat(existing.moq),
      leadTimeDays: updateDto.leadTimeDays ?? parseFloat(existing.lead_time_days),
      currency: updateDto.currency ?? existing.currency,
      supplierId: updateDto.supplierId ?? existing.supplier_id,
      supplierName: updateDto.supplierName ?? existing.supplier_name,
      supplierLocation: updateDto.supplierLocation ?? existing.supplier_location,
      notes: updateDto.notes ?? existing.notes,
    };

    // Recalculate
    const calculationResult = this.calculationEngine.calculate(merged);

    // Prepare update data
    const updateData: any = {};

    // Update input fields if provided
    if (updateDto.partNumber !== undefined) updateData.part_number = updateDto.partNumber;
    if (updateDto.partName !== undefined) updateData.part_name = updateDto.partName;
    if (updateDto.description !== undefined) updateData.description = updateDto.description;
    if (updateDto.makeBuy !== undefined) updateData.make_buy = updateDto.makeBuy;
    if (updateDto.unitCost !== undefined) updateData.unit_cost = updateDto.unitCost;
    if (updateDto.freight !== undefined) updateData.freight_percentage = updateDto.freight;
    if (updateDto.duty !== undefined) updateData.duty_percentage = updateDto.duty;
    if (updateDto.overhead !== undefined) updateData.overhead_percentage = updateDto.overhead;
    if (updateDto.rawMaterialCost !== undefined) updateData.raw_material_cost_input = updateDto.rawMaterialCost;
    if (updateDto.processCost !== undefined) updateData.process_cost_input = updateDto.processCost;
    if (updateDto.scrap !== undefined) updateData.scrap_percentage = updateDto.scrap;
    if (updateDto.defectRate !== undefined) updateData.defect_rate_percentage = updateDto.defectRate;
    if (updateDto.quantity !== undefined) updateData.quantity = updateDto.quantity;
    if (updateDto.moq !== undefined) updateData.moq = updateDto.moq;
    if (updateDto.leadTimeDays !== undefined) updateData.lead_time_days = updateDto.leadTimeDays;
    if (updateDto.currency !== undefined) updateData.currency = updateDto.currency;
    if (updateDto.supplierId !== undefined) updateData.supplier_id = updateDto.supplierId;
    if (updateDto.supplierName !== undefined) updateData.supplier_name = updateDto.supplierName;
    if (updateDto.supplierLocation !== undefined) updateData.supplier_location = updateDto.supplierLocation;
    if (updateDto.isActive !== undefined) updateData.is_active = updateDto.isActive;
    if (updateDto.notes !== undefined) updateData.notes = updateDto.notes;

    // Always update calculated fields
    updateData.base_cost = calculationResult.baseCost;
    updateData.freight_cost = calculationResult.freightCost;
    updateData.duty_cost = calculationResult.dutyCost;
    updateData.overhead_cost = calculationResult.overheadCost;
    updateData.cost_before_quality = calculationResult.costBeforeQuality;
    updateData.scrap_adjustment = calculationResult.scrapAdjustment;
    updateData.defect_adjustment = calculationResult.defectAdjustment;
    updateData.quality_factor = calculationResult.qualityFactor;
    updateData.total_cost_per_part = calculationResult.totalCostPerPart;
    updateData.extended_cost = calculationResult.extendedCost;
    updateData.moq_extended_cost = calculationResult.moqExtendedCost;
    updateData.calculation_breakdown = calculationResult;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('child_part_cost_records')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Error updating child part cost: ${error?.message}`, 'ChildPartCostService');
      throw new NotFoundException(`Failed to update child part cost with ID ${id}`);
    }

    // Update BOM item cost
    await this.updateBomItemCostFromChildPart(existing.bom_item_id, calculationResult.totalCostPerPart, userId, accessToken);

    return ChildPartCostResponseDto.fromDatabase(data);
  }

  /**
   * Delete a child part cost record
   */
  async remove(id: string, userId: string, accessToken: string): Promise<{ message: string }> {
    this.logger.log(`Deleting child part cost: ${id}`, 'ChildPartCostService');

    // Get record to get bom_item_id
    const { data: existing } = await this.supabaseService
      .getClient(accessToken)
      .from('child_part_cost_records')
      .select('bom_item_id')
      .eq('id', id)
      .single();

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('child_part_cost_records')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting child part cost: ${error.message}`, 'ChildPartCostService');
      throw new InternalServerErrorException(`Failed to delete child part cost: ${error.message}`);
    }

    // Update BOM item cost to remove this child part cost
    if (existing?.bom_item_id) {
      await this.updateBomItemCostFromChildPart(existing.bom_item_id, 0, userId, accessToken);
    }

    return { message: 'Child part cost deleted successfully' };
  }

  /**
   * Calculate child part cost without saving to database
   * Useful for preview/what-if analysis
   */
  async calculateOnly(input: CalculateChildPartCostDto): Promise<any> {
    this.logger.log('Calculating child part cost (no save)', 'ChildPartCostService');

    try {
      const calculationInput: ChildPartCostInput = {
        partNumber: input.partNumber,
        partName: input.partName,
        makeBuy: input.makeBuy,
        unitCost: input.unitCost,
        freight: input.freight,
        duty: input.duty,
        overhead: input.overhead,
        rawMaterialCost: input.rawMaterialCost,
        processCost: input.processCost,
        scrap: input.scrap,
        defectRate: input.defectRate,
        quantity: input.quantity,
        moq: input.moq,
        leadTimeDays: input.leadTimeDays,
        currency: input.currency,
      };

      const result = this.calculationEngine.calculate(calculationInput);
      return result;
    } catch (error) {
      this.logger.error(`Calculation error: ${error.message}`, 'ChildPartCostService');
      throw new InternalServerErrorException(`Calculation failed: ${error.message}`);
    }
  }

  /**
   * Recalculate an existing record
   * Used when fetching records to ensure fresh calculations
   */
  private recalculateRecord(record: any): any {
    const input: ChildPartCostInput = {
      partNumber: record.part_number,
      partName: record.part_name,
      description: record.description,
      makeBuy: record.make_buy,
      unitCost: parseFloat(record.unit_cost) || 0,
      freight: parseFloat(record.freight_percentage) || 0,
      duty: parseFloat(record.duty_percentage) || 0,
      overhead: parseFloat(record.overhead_percentage) || 0,
      rawMaterialCost: parseFloat(record.raw_material_cost_input) || 0,
      processCost: parseFloat(record.process_cost_input) || 0,
      scrap: parseFloat(record.scrap_percentage) || 0,
      defectRate: parseFloat(record.defect_rate_percentage) || 0,
      quantity: parseFloat(record.quantity) || 1,
      moq: parseFloat(record.moq) || 1,
      leadTimeDays: parseFloat(record.lead_time_days) || 0,
      currency: record.currency,
      supplierId: record.supplier_id,
      supplierName: record.supplier_name,
      supplierLocation: record.supplier_location,
      notes: record.notes,
    };

    const calculationResult = this.calculationEngine.calculate(input);

    return {
      ...record,
      base_cost: calculationResult.baseCost,
      freight_cost: calculationResult.freightCost,
      duty_cost: calculationResult.dutyCost,
      overhead_cost: calculationResult.overheadCost,
      cost_before_quality: calculationResult.costBeforeQuality,
      scrap_adjustment: calculationResult.scrapAdjustment,
      defect_adjustment: calculationResult.defectAdjustment,
      quality_factor: calculationResult.qualityFactor,
      total_cost_per_part: calculationResult.totalCostPerPart,
      extended_cost: calculationResult.extendedCost,
      moq_extended_cost: calculationResult.moqExtendedCost,
      calculation_breakdown: calculationResult,
    };
  }

  /**
   * Update BOM item cost record with child part cost
   * This integrates child part costs into the BOM cost aggregation system
   */
  private async updateBomItemCostFromChildPart(
    bomItemId: string,
    childPartCost: number,
    userId: string,
    accessToken: string
  ): Promise<void> {
    try {
      // Update or insert bom_item_costs record
      const { error } = await this.supabaseService
        .getClient(accessToken)
        .from('bom_item_costs')
        .upsert(
          {
            bom_item_id: bomItemId,
            user_id: userId,
            raw_material_cost: childPartCost,
            own_cost: childPartCost,
            total_cost: childPartCost,
            unit_cost: childPartCost,
            is_stale: false,
            last_calculated_at: new Date().toISOString(),
          },
          {
            onConflict: 'bom_item_id,user_id',
          }
        );

      if (error) {
        this.logger.error(
          `Error updating BOM item cost: ${error.message}`,
          'ChildPartCostService'
        );
      } else {
        this.logger.log(
          `Updated BOM item ${bomItemId} with child part cost: ${childPartCost}`,
          'ChildPartCostService'
        );
      }
    } catch (error) {
      this.logger.error(
        `Exception updating BOM item cost: ${error.message}`,
        'ChildPartCostService'
      );
    }
  }
}
