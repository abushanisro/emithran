/**
 * Tooling Cost Service
 *
 * Business logic for tooling cost calculations
 * Production-grade service with error handling and calculation engine
 *
 * @class ToolingCostService
 * @version 1.0.0
 */

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  CreateToolingCostDto,
  UpdateToolingCostDto,
  QueryToolingCostsDto,
  ToolingCostResponseDto,
  ToolingCostListResponseDto,
} from '../dto/tooling-cost.dto';

@Injectable()
export class ToolingCostService {
  private readonly logger = new Logger(ToolingCostService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Calculate tooling cost per part
   */
  private calculateToolingCosts(
    unitCost: number,
    quantity: number,
    amortizationParts: number,
    usagePercentage: number,
  ) {
    // Total tooling investment
    const totalToolingInvestment = unitCost * quantity;

    // Cost per part based on amortization and usage percentage
    const costPerPart = (totalToolingInvestment * (usagePercentage / 100)) / amortizationParts;

    return {
      totalCost: costPerPart,
      totalToolingInvestment,
    };
  }

  /**
   * Get all tooling costs with pagination and filtering
   */
  async findAll(
    query: QueryToolingCostsDto,
    userId: string,
    accessToken: string,
  ): Promise<ToolingCostListResponseDto> {
    try {
      const {
        page = 1,
        limit = 10,
        bomItemId,
        toolingType,
        isActive,
        search,
        isCustom,
      } = query;

      const offset = (page - 1) * limit;
      const client = this.supabaseService.getClient(accessToken);

      // Build query
      let queryBuilder = client
        .from('tooling_cost_records')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });

      // Apply filters
      if (bomItemId) {
        queryBuilder = queryBuilder.eq('bom_item_id', bomItemId);
      }
      if (toolingType) {
        queryBuilder = queryBuilder.eq('tooling_type', toolingType);
      }
      if (isActive !== undefined) {
        queryBuilder = queryBuilder.eq('is_active', isActive);
      }
      if (isCustom !== undefined) {
        queryBuilder = queryBuilder.eq('is_custom', isCustom);
      }
      if (search) {
        queryBuilder = queryBuilder.or(
          `description.ilike.%${search}%,supplier.ilike.%${search}%,specifications.ilike.%${search}%`
        );
      }

      const { data, error, count } = await queryBuilder;

      if (error) {
        this.logger.error('Error fetching tooling costs:', error);
        throw new BadRequestException('Failed to fetch tooling costs');
      }

      const records = data?.map(ToolingCostResponseDto.fromDatabase) || [];
      const totalPages = Math.ceil((count || 0) / limit);

      return {
        records,
        total: count || 0,
        page,
        limit,
        totalPages,
      };
    } catch (error) {
      this.logger.error('Error in findAll:', error);
      throw error;
    }
  }

  /**
   * Get single tooling cost by ID
   */
  async findOne(
    id: string,
    userId: string,
    accessToken: string,
  ): Promise<ToolingCostResponseDto> {
    try {
      const client = this.supabaseService.getClient(accessToken);

      const { data, error } = await client
        .from('tooling_cost_records')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        throw new NotFoundException('Tooling cost record not found');
      }

      return ToolingCostResponseDto.fromDatabase(data);
    } catch (error) {
      this.logger.error('Error in findOne:', error);
      throw error;
    }
  }

  /**
   * Create new tooling cost
   */
  async create(
    dto: CreateToolingCostDto,
    userId: string,
    accessToken: string,
  ): Promise<ToolingCostResponseDto> {
    try {
      const client = this.supabaseService.getClient(accessToken);

      // Calculate costs
      const calculatedCosts = this.calculateToolingCosts(
        dto.unitCost,
        dto.quantity,
        dto.amortizationParts,
        dto.usagePercentage,
      );

      const record = {
        user_id: userId,
        bom_item_id: dto.bomItemId,
        tooling_type: dto.toolingType,
        description: dto.description,
        specifications: dto.specifications,
        unit_cost: dto.unitCost,
        quantity: dto.quantity,
        amortization_parts: dto.amortizationParts,
        usage_percentage: dto.usagePercentage,
        total_cost: calculatedCosts.totalCost,
        total_tooling_investment: calculatedCosts.totalToolingInvestment,
        is_custom: dto.isCustom,
        supplier: dto.supplier,
        lead_time: dto.leadTime,
        notes: dto.notes,
        is_active: dto.isActive ?? true,
        currency: 'INR',
      };

      const { data, error } = await client
        .from('tooling_cost_records')
        .insert(record)
        .select()
        .single();

      if (error) {
        this.logger.error('Error creating tooling cost:', error);
        throw new BadRequestException('Failed to create tooling cost');
      }

      return ToolingCostResponseDto.fromDatabase(data);
    } catch (error) {
      this.logger.error('Error in create:', error);
      throw error;
    }
  }

  /**
   * Update existing tooling cost
   */
  async update(
    id: string,
    dto: UpdateToolingCostDto,
    userId: string,
    accessToken: string,
  ): Promise<ToolingCostResponseDto> {
    try {
      const client = this.supabaseService.getClient(accessToken);

      // First, get the existing record to calculate costs properly
      const { data: existing, error: fetchError } = await client
        .from('tooling_cost_records')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (fetchError || !existing) {
        throw new NotFoundException('Tooling cost record not found');
      }

      // Merge with existing data for calculation
      const unitCost = dto.unitCost ?? existing.unit_cost;
      const quantity = dto.quantity ?? existing.quantity;
      const amortizationParts = dto.amortizationParts ?? existing.amortization_parts;
      const usagePercentage = dto.usagePercentage ?? existing.usage_percentage;

      // Recalculate costs if any cost-affecting fields changed
      let calculatedCosts = {
        totalCost: existing.total_cost,
        totalToolingInvestment: existing.total_tooling_investment,
      };

      if (
        dto.unitCost !== undefined ||
        dto.quantity !== undefined ||
        dto.amortizationParts !== undefined ||
        dto.usagePercentage !== undefined
      ) {
        calculatedCosts = this.calculateToolingCosts(
          unitCost,
          quantity,
          amortizationParts,
          usagePercentage,
        );
      }

      const updateData: any = {};
      if (dto.toolingType !== undefined) updateData.tooling_type = dto.toolingType;
      if (dto.description !== undefined) updateData.description = dto.description;
      if (dto.specifications !== undefined) updateData.specifications = dto.specifications;
      if (dto.unitCost !== undefined) updateData.unit_cost = dto.unitCost;
      if (dto.quantity !== undefined) updateData.quantity = dto.quantity;
      if (dto.amortizationParts !== undefined) updateData.amortization_parts = dto.amortizationParts;
      if (dto.usagePercentage !== undefined) updateData.usage_percentage = dto.usagePercentage;
      if (dto.isCustom !== undefined) updateData.is_custom = dto.isCustom;
      if (dto.supplier !== undefined) updateData.supplier = dto.supplier;
      if (dto.leadTime !== undefined) updateData.lead_time = dto.leadTime;
      if (dto.notes !== undefined) updateData.notes = dto.notes;
      if (dto.isActive !== undefined) updateData.is_active = dto.isActive;
      if (dto.bomItemId !== undefined) updateData.bom_item_id = dto.bomItemId;

      // Always update calculated costs
      updateData.total_cost = calculatedCosts.totalCost;
      updateData.total_tooling_investment = calculatedCosts.totalToolingInvestment;
      updateData.updated_at = new Date().toISOString();

      const { data, error } = await client
        .from('tooling_cost_records')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        this.logger.error('Error updating tooling cost:', error);
        throw new BadRequestException('Failed to update tooling cost');
      }

      return ToolingCostResponseDto.fromDatabase(data);
    } catch (error) {
      this.logger.error('Error in update:', error);
      throw error;
    }
  }

  /**
   * Delete tooling cost
   */
  async remove(
    id: string,
    userId: string,
    accessToken: string,
  ): Promise<void> {
    try {
      const client = this.supabaseService.getClient(accessToken);

      const { error } = await client
        .from('tooling_cost_records')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) {
        this.logger.error('Error deleting tooling cost:', error);
        throw new BadRequestException('Failed to delete tooling cost');
      }
    } catch (error) {
      this.logger.error('Error in remove:', error);
      throw error;
    }
  }

  /**
   * Get total tooling cost for a BOM item
   */
  async getTotalCostForBomItem(
    bomItemId: string,
    userId: string,
    accessToken: string,
  ): Promise<number> {
    try {
      const client = this.supabaseService.getClient(accessToken);

      const { data, error } = await client
        .from('tooling_cost_records')
        .select('total_cost')
        .eq('bom_item_id', bomItemId)
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) {
        this.logger.error('Error calculating total tooling cost:', error);
        throw new BadRequestException('Failed to calculate total tooling cost');
      }

      const totalCost = data?.reduce((sum, record) => sum + (parseFloat(record.total_cost) || 0), 0) || 0;
      return totalCost;
    } catch (error) {
      this.logger.error('Error in getTotalCostForBomItem:', error);
      throw error;
    }
  }
}