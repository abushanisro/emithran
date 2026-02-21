/**
 * Procured Parts Cost Service
 *
 * Production-grade business logic for procured/purchased parts
 * - CRUD operations with proper error handling
 * - Type-safe database interactions
 * - Comprehensive logging
 *
 * @class ProcuredPartsCostService
 * @version 1.0.0
 */

import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  CreateProcuredPartsCostDto,
  UpdateProcuredPartsCostDto,
  QueryProcuredPartsCostsDto,
  ProcuredPartsCostResponseDto,
  ProcuredPartsCostListResponseDto,
} from './dto/procured-parts-cost.dto';

@Injectable()
export class ProcuredPartsCostService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  /**
   * Get all procured parts costs with pagination
   */
  async findAll(
    query: QueryProcuredPartsCostsDto,
    userId: string,
    accessToken?: string,
  ): Promise<ProcuredPartsCostListResponseDto> {
    this.logger.log('Fetching procured parts costs', 'ProcuredPartsCostService');

    try {
      const page = query.page || 1;
      const limit = Math.min(query.limit || 10, 100);
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      let queryBuilder = this.supabaseService
        .getClient(accessToken)
        .from('procured_parts_cost_records')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(from, to);

      // Apply filters
      if (query.bomItemId) {
        queryBuilder = queryBuilder.eq('bom_item_id', query.bomItemId);
      }

      if (query.supplierName) {
        queryBuilder = queryBuilder.ilike('supplier_name', `%${query.supplierName}%`);
      }

      if (query.search) {
        queryBuilder = queryBuilder.or(
          `part_name.ilike.%${query.search}%,part_number.ilike.%${query.search}%`
        );
      }

      if (query.isActive !== undefined) {
        queryBuilder = queryBuilder.eq('is_active', query.isActive);
      }

      const { data, error, count } = await queryBuilder;

      if (error) {
        this.logger.error(`Database error: ${error.message}`, 'ProcuredPartsCostService');
        throw new InternalServerErrorException('Failed to fetch procured parts costs');
      }

      return {
        items: data || [],
        total: count || 0,
        page,
        limit,
      };
    } catch (error) {
      this.logger.error(`Error in findAll: ${error.message}`, 'ProcuredPartsCostService');
      throw error;
    }
  }

  /**
   * Get single procured part cost by ID
   */
  async findOne(
    id: string,
    userId: string,
    accessToken?: string,
  ): Promise<ProcuredPartsCostResponseDto> {
    this.logger.log(`Fetching procured part cost: ${id}`, 'ProcuredPartsCostService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('procured_parts_cost_records')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Procured part cost not found: ${id}`);
    }

    return data;
  }

  /**
   * Create new procured part cost record
   */
  async create(
    dto: CreateProcuredPartsCostDto,
    userId: string,
    accessToken?: string,
  ): Promise<ProcuredPartsCostResponseDto> {
    this.logger.log('Creating procured part cost', 'ProcuredPartsCostService');

    try {
      const record = {
        bom_item_id: dto.bomItemId,
        user_id: userId,
        part_name: dto.partName,
        part_number: dto.partNumber,
        supplier_name: dto.supplierName,
        supplier_id: dto.supplierId,
        unit_cost: dto.unitCost,
        quantity: dto.quantity,
        scrap_percentage: dto.scrapPercentage || 0,
        defect_rate_percentage: dto.defectRatePercentage || 0,
        overhead_percentage: dto.overheadPercentage || 0,
        freight_cost: dto.freightCost || 0,
        duty_cost: dto.dutyCost || 0,
        moq: dto.moq,
        lead_time_days: dto.leadTimeDays,
        currency: dto.currency || 'INR',
        cost_breakdown: dto.costBreakdown || {},
        notes: dto.notes,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      };

      const { data, error } = await this.supabaseService
        .getClient(accessToken)
        .from('procured_parts_cost_records')
        .insert(record)
        .select()
        .single();

      if (error) {
        this.logger.error(`Insert error: ${error.message}`, 'ProcuredPartsCostService');
        throw new InternalServerErrorException('Failed to create procured part cost');
      }

      this.logger.log(`Created cost record: ${data.id}`, 'ProcuredPartsCostService');
      return data;
    } catch (error) {
      this.logger.error(`Error creating: ${error.message}`, 'ProcuredPartsCostService');
      throw error;
    }
  }

  /**
   * Update existing procured part cost
   */
  async update(
    id: string,
    dto: UpdateProcuredPartsCostDto,
    userId: string,
    accessToken?: string,
  ): Promise<ProcuredPartsCostResponseDto> {
    this.logger.log(`Updating procured part cost: ${id}`, 'ProcuredPartsCostService');

    // Verify existence and ownership
    await this.findOne(id, userId, accessToken);

    const updateData: any = {};

    if (dto.partName !== undefined) updateData.part_name = dto.partName;
    if (dto.partNumber !== undefined) updateData.part_number = dto.partNumber;
    if (dto.supplierName !== undefined) updateData.supplier_name = dto.supplierName;
    if (dto.supplierId !== undefined) updateData.supplier_id = dto.supplierId;
    if (dto.unitCost !== undefined) updateData.unit_cost = dto.unitCost;
    if (dto.quantity !== undefined) updateData.quantity = dto.quantity;
    if (dto.scrapPercentage !== undefined) updateData.scrap_percentage = dto.scrapPercentage;
    if (dto.defectRatePercentage !== undefined) updateData.defect_rate_percentage = dto.defectRatePercentage;
    if (dto.overheadPercentage !== undefined) updateData.overhead_percentage = dto.overheadPercentage;
    if (dto.freightCost !== undefined) updateData.freight_cost = dto.freightCost;
    if (dto.dutyCost !== undefined) updateData.duty_cost = dto.dutyCost;
    if (dto.moq !== undefined) updateData.moq = dto.moq;
    if (dto.leadTimeDays !== undefined) updateData.lead_time_days = dto.leadTimeDays;
    if (dto.currency !== undefined) updateData.currency = dto.currency;
    if (dto.costBreakdown !== undefined) updateData.cost_breakdown = dto.costBreakdown;
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (dto.isActive !== undefined) updateData.is_active = dto.isActive;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('procured_parts_cost_records')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Update error: ${error.message}`, 'ProcuredPartsCostService');
      throw new InternalServerErrorException('Failed to update procured part cost');
    }

    return data;
  }

  /**
   * Delete procured part cost
   */
  async delete(id: string, userId: string, accessToken?: string): Promise<{ message: string }> {
    this.logger.log(`Deleting procured part cost: ${id}`, 'ProcuredPartsCostService');

    // Verify existence
    await this.findOne(id, userId, accessToken);

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('procured_parts_cost_records')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`Delete error: ${error.message}`, 'ProcuredPartsCostService');
      throw new InternalServerErrorException('Failed to delete procured part cost');
    }

    return { message: 'Procured part cost deleted successfully' };
  }

  /**
   * Get total procured parts cost for a specific BOM item
   */
  async getTotalCostForBomItem(
    bomItemId: string,
    userId?: string,
    accessToken?: string,
  ): Promise<number> {
    this.logger.log(`Calculating total procured parts cost for BOM item: ${bomItemId}`, 'ProcuredPartsCostService');

    const client = this.supabaseService.getClient(accessToken);

    // Get all active procured parts costs for this BOM item
    const { data: costs, error } = await client
      .from('procured_parts_cost_records')
      .select('total_cost')
      .eq('bom_item_id', bomItemId)
      .eq('is_active', true);

    if (error) {
      this.logger.error('Error fetching procured parts costs for BOM item', error.message, 'ProcuredPartsCostService');
      throw new InternalServerErrorException('Failed to fetch procured parts costs');
    }

    // Sum up all costs
    const totalCost = costs?.reduce((sum, cost) => {
      const costValue = cost.total_cost || 0;
      return sum + costValue;
    }, 0) || 0;

    this.logger.log(`Total procured parts cost for BOM item ${bomItemId}: ${totalCost}`, 'ProcuredPartsCostService');
    return totalCost;
  }
}
