/**
 * Packaging & Logistics Cost Service
 *
 * Production-grade business logic layer
 * - Database operations with Supabase
 * - Error handling and logging
 * - Type-safe operations
 *
 * @class PackagingLogisticsCostService
 * @version 1.0.0
 */

import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  CreatePackagingLogisticsCostDto,
  UpdatePackagingLogisticsCostDto,
  QueryPackagingLogisticsCostsDto,
  PackagingLogisticsCostResponseDto,
  PackagingLogisticsCostListResponseDto,
} from './dto/packaging-logistics-cost.dto';

@Injectable()
export class PackagingLogisticsCostService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  /**
   * Get all packaging/logistics costs with pagination and filtering
   */
  async findAll(
    query: QueryPackagingLogisticsCostsDto,
    userId: string,
    accessToken?: string,
  ): Promise<PackagingLogisticsCostListResponseDto> {
    this.logger.log('Fetching packaging/logistics costs', 'PackagingLogisticsCostService');

    try {
      const page = query.page || 1;
      const limit = Math.min(query.limit || 10, 100);
      const from = (page - 1) * limit;
      const to = from + limit - 1;

let queryBuilder = this.supabaseService
        .getClient(accessToken)
        .from('packaging_logistics_cost_records')
        .select('*', { count: 'exact' })
        .eq('user_id', userId === 'temp-user' ? '00000000-0000-0000-0000-000000000000' : userId)
        .order('created_at', { ascending: false })
        .range(from, to);

      // Apply filters
      if (query.bomItemId) {
        queryBuilder = queryBuilder.eq('bom_item_id', query.bomItemId);
      }

      if (query.logisticsType) {
        queryBuilder = queryBuilder.eq('logistics_type', query.logisticsType);
      }

      if (query.search) {
        queryBuilder = queryBuilder.ilike('cost_name', `%${query.search}%`);
      }

      if (query.isActive !== undefined) {
        queryBuilder = queryBuilder.eq('is_active', query.isActive);
      }

      const { data, error, count } = await queryBuilder;

      if (error) {
        this.logger.error(`Database error: ${error.message}`, 'PackagingLogisticsCostService');
        throw new InternalServerErrorException('Failed to fetch packaging/logistics costs');
      }

      return {
        items: data || [],
        total: count || 0,
        page,
        limit,
      };
    } catch (error) {
      this.logger.error(`Error in findAll: ${error.message}`, 'PackagingLogisticsCostService');
      throw error;
    }
  }

  /**
   * Get single packaging/logistics cost by ID
   */
  async findOne(
    id: string,
    userId: string,
    accessToken?: string,
  ): Promise<PackagingLogisticsCostResponseDto> {
    this.logger.log(`Fetching packaging/logistics cost: ${id}`, 'PackagingLogisticsCostService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('packaging_logistics_cost_records')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Packaging/logistics cost not found: ${id}`);
    }

    return data;
  }

  /**
   * Create new packaging/logistics cost record
   */
  async create(
    dto: CreatePackagingLogisticsCostDto,
    userId: string,
    accessToken?: string,
  ): Promise<PackagingLogisticsCostResponseDto> {
    this.logger.log('Creating packaging/logistics cost', 'PackagingLogisticsCostService');

    try {
      const record = {
        bom_item_id: dto.bomItemId,
        user_id: userId,
        cost_name: dto.costName,
        logistics_type: dto.logisticsType,
        mode_of_transport: dto.modeOfTransport,
        calculator_id: dto.calculatorId,
        calculator_name: dto.calculatorName,
        cost_basis: dto.costBasis,
        parameters: dto.parameters || {},
        unit_cost: dto.unitCost,
        quantity: dto.quantity,
        cost_breakdown: dto.costBreakdown || {},
        notes: dto.notes,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
      };

      const { data, error } = await this.supabaseService
        .getClient(accessToken)
        .from('packaging_logistics_cost_records')
        .insert(record)
        .select()
        .single();

      if (error) {
        this.logger.error(`Insert error: ${error.message}`, 'PackagingLogisticsCostService');
        throw new InternalServerErrorException('Failed to create packaging/logistics cost');
      }

      this.logger.log(`Created cost record: ${data.id}`, 'PackagingLogisticsCostService');
      return data;
    } catch (error) {
      this.logger.error(`Error creating: ${error.message}`, 'PackagingLogisticsCostService');
      throw error;
    }
  }

  /**
   * Update existing packaging/logistics cost
   */
  async update(
    id: string,
    dto: UpdatePackagingLogisticsCostDto,
    userId: string,
    accessToken?: string,
  ): Promise<PackagingLogisticsCostResponseDto> {
    this.logger.log(`Updating packaging/logistics cost: ${id}`, 'PackagingLogisticsCostService');

    // Verify existence and ownership
    await this.findOne(id, userId, accessToken);

    const updateData: any = {};

    if (dto.costName !== undefined) updateData.cost_name = dto.costName;
    if (dto.logisticsType !== undefined) updateData.logistics_type = dto.logisticsType;
    if (dto.modeOfTransport !== undefined) updateData.mode_of_transport = dto.modeOfTransport;
    if (dto.calculatorId !== undefined) updateData.calculator_id = dto.calculatorId;
    if (dto.calculatorName !== undefined) updateData.calculator_name = dto.calculatorName;
    if (dto.costBasis !== undefined) updateData.cost_basis = dto.costBasis;
    if (dto.parameters !== undefined) updateData.parameters = dto.parameters;
    if (dto.unitCost !== undefined) updateData.unit_cost = dto.unitCost;
    if (dto.quantity !== undefined) updateData.quantity = dto.quantity;
    if (dto.costBreakdown !== undefined) updateData.cost_breakdown = dto.costBreakdown;
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (dto.isActive !== undefined) updateData.is_active = dto.isActive;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('packaging_logistics_cost_records')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Update error: ${error.message}`, 'PackagingLogisticsCostService');
      throw new InternalServerErrorException('Failed to update packaging/logistics cost');
    }

    return data;
  }

  /**
   * Delete packaging/logistics cost
   */
  async delete(id: string, userId: string, accessToken?: string): Promise<{ message: string }> {
    this.logger.log(`Deleting packaging/logistics cost: ${id}`, 'PackagingLogisticsCostService');

    // Verify existence
    await this.findOne(id, userId, accessToken);

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('packaging_logistics_cost_records')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`Delete error: ${error.message}`, 'PackagingLogisticsCostService');
      throw new InternalServerErrorException('Failed to delete packaging/logistics cost');
    }

    return { message: 'Packaging/logistics cost deleted successfully' };
  }

  /**
   * Get total packaging/logistics cost for a specific BOM item
   */
  async getTotalCostForBomItem(
    bomItemId: string,
    userId?: string,
    accessToken?: string,
  ): Promise<number> {
    this.logger.log(`Calculating total packaging/logistics cost for BOM item: ${bomItemId}`, 'PackagingLogisticsCostService');

    const client = this.supabaseService.getClient(accessToken);

    // Get all active packaging/logistics costs for this BOM item
    const { data: costs, error } = await client
      .from('packaging_logistics_cost_records')
      .select('total_cost')
      .eq('bom_item_id', bomItemId)
      .eq('is_active', true);

    if (error) {
      this.logger.error('Error fetching packaging/logistics costs for BOM item', error.message, 'PackagingLogisticsCostService');
      throw new InternalServerErrorException('Failed to fetch packaging/logistics costs');
    }

    // Sum up all costs
    const totalCost = costs?.reduce((sum, cost) => {
      const costValue = cost.total_cost || 0;
      return sum + costValue;
    }, 0) || 0;

    this.logger.log(`Total packaging/logistics cost for BOM item ${bomItemId}: ${totalCost}`, 'PackagingLogisticsCostService');
    return totalCost;
  }
}
