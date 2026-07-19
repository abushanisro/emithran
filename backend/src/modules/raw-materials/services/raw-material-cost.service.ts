/**
 * Raw Material Cost Service
 *
 * Business logic layer for raw material cost calculations
 * Integrates the calculation engine with database operations
 *
 * @author Manufacturing Cost Engineering Team
 * @version 2.0.0
 */

import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { Logger } from '../../../common/logger/logger.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  CreateRawMaterialCostDto,
  UpdateRawMaterialCostDto,
  QueryRawMaterialCostsDto,
  RawMaterialCostResponseDto,
  RawMaterialCostListResponseDto,
} from '../dto/raw-material-cost.dto';
import {
  RawMaterialCostCalculationEngine,
  RawMaterialCostInput,
} from '../engines/raw-material-cost-calculation.engine';

@Injectable()
export class RawMaterialCostService {
  private readonly calculationEngine: RawMaterialCostCalculationEngine;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {
    this.calculationEngine = new RawMaterialCostCalculationEngine();
  }

  /**
   * Get all raw material cost records with pagination and filtering
   */
  async findAll(
    query: QueryRawMaterialCostsDto,
    userId?: string,
    accessToken?: string,
  ): Promise<RawMaterialCostListResponseDto> {
    this.logger.log('Fetching all raw material costs', 'RawMaterialCostService');

    const page = query.page || 1;
    const limit = Math.min(query.limit || 10, 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('raw_material_cost_records')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    // Apply filters
    if (query.isActive !== undefined) {
      queryBuilder = queryBuilder.eq('is_active', query.isActive);
    }

    if (query.search) {
      queryBuilder = queryBuilder.or(
        `material_name.ilike.%${query.search}%,cost_name.ilike.%${query.search}%`
      );
    }

    if (query.materialCategory) {
      queryBuilder = queryBuilder.eq('material_category', query.materialCategory);
    }

    if (query.materialType) {
      queryBuilder = queryBuilder.eq('material_type', query.materialType);
    }

    if (query.bomItemId) {
      queryBuilder = queryBuilder.eq('bom_item_id', query.bomItemId);
    }

    if (query.projectId) {
      queryBuilder = queryBuilder.eq('project_id', query.projectId);
    }

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching raw material costs: ${error.message}`, 'RawMaterialCostService');
      throw new InternalServerErrorException(`Failed to fetch raw material costs: ${error.message}`);
    }

    // Back-fill material_name for old AI-applied records that stored only material_id
    const rows = data || [];
    const missingIds = [...new Set(
      rows.filter(r => !r.material_name && r.material_id).map(r => String(r.material_id))
    )];
    const materialMap = new Map<string, string>();
    if (missingIds.length > 0) {
      const { data: mats } = await this.supabaseService
        .getClient(accessToken)
        .from('raw_materials')
        .select('id, material')
        .in('id', missingIds);
      (mats || []).forEach(m => materialMap.set(String(m.id), m.material));
    }
    const enriched = rows.map(r =>
      !r.material_name && r.material_id && materialMap.has(String(r.material_id))
        ? { ...r, material_name: materialMap.get(String(r.material_id)) }
        : r
    );

    const records = enriched.map((row) => RawMaterialCostResponseDto.fromDatabase(row));
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
   * Get a single raw material cost record by ID
   * Recalculates on fetch to ensure accuracy
   */
  async findOne(id: string, userId: string, accessToken: string): Promise<RawMaterialCostResponseDto> {
    this.logger.log(`Fetching raw material cost: ${id}`, 'RawMaterialCostService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_material_cost_records')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      this.logger.error(`Raw material cost not found: ${id}`, 'RawMaterialCostService');
      throw new NotFoundException(`Raw material cost with ID ${id} not found`);
    }

    // Back-fill material_name from master if missing
    let row = data;
    if (!row.material_name && row.material_id) {
      const { data: mat } = await this.supabaseService
        .getClient(accessToken)
        .from('raw_materials')
        .select('material')
        .eq('id', String(row.material_id))
        .single();
      if (mat?.material) row = { ...row, material_name: mat.material };
    }

    // Recalculate to ensure fresh values
    const recalculatedData = this.recalculateRecord(row);

    return RawMaterialCostResponseDto.fromDatabase(recalculatedData);
  }

  /**
   * Create a new raw material cost record with calculation
   */
  async create(
    createDto: CreateRawMaterialCostDto,
    userId: string,
    accessToken: string,
  ): Promise<RawMaterialCostResponseDto> {
    this.logger.log('Creating raw material cost record', 'RawMaterialCostService');

    // Auto-populate unit cost from raw_materials DB when the caller sends 0 and a material name.
    // This happens when the material is applied from the BOM item grade without a manual price entry.
    // Looks up the location-specific price column so India materials (cost_india) aren't silently zeroed.
    let resolvedUnitCost = createDto.unitCost ?? 0;
    if (resolvedUnitCost === 0 && createDto.materialName) {
      resolvedUnitCost = await this.lookupMaterialPrice(
        accessToken, createDto.materialName, createDto.country ?? '',
      );
    }

    // Prepare input for calculation engine
    const calculationInput: RawMaterialCostInput = {
      materialId: createDto.materialId,
      materialName: createDto.materialName,
      materialCategory: createDto.materialCategory,
      materialType: createDto.materialType,
      materialCostId: createDto.materialCostId,
      costName: createDto.costName,
      unitCost: resolvedUnitCost,
      reclaimRate: createDto.reclaimRate || 0,
      uom: createDto.uom || 'KG',
      grossUsage: createDto.grossUsage,
      netUsage: createDto.netUsage,
      scrap: createDto.scrap,
      overhead: createDto.overhead,
    };

    // Calculate costs
    let calculationResult: ReturnType<typeof this.calculationEngine.calculate>;
    try {
      calculationResult = this.calculationEngine.calculate(calculationInput);
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Invalid raw material cost input');
    }

    // Prepare database record
    const recordData = {
      // Material Information
      material_category_id: createDto.materialCategoryId,
      material_type_id: createDto.materialTypeId,
      material_id: createDto.materialId,
      material_name: createDto.materialName || '',
      material_category: createDto.materialCategory || '',
      material_type: createDto.materialType || '',
      material_group: createDto.materialGroup || '',
      material_description: createDto.materialDescription || '',
      country: createDto.country || '',
      quarter: createDto.quarter || 'q1',

      // Cost Information
      material_cost_id: createDto.materialCostId,
      cost_name: createDto.costName || '',
      unit_cost: resolvedUnitCost,
      reclaim_rate: createDto.reclaimRate || 0,
      uom: createDto.uom || 'KG',

      // Usage Parameters
      gross_usage: createDto.grossUsage,
      net_usage: createDto.netUsage,
      scrap: createDto.scrap,
      overhead: createDto.overhead,

      // Calculated Results
      total_cost: calculationResult.totalCost,
      gross_material_cost: calculationResult.grossMaterialCost,
      reclaim_value: calculationResult.reclaimValue,
      net_material_cost: calculationResult.netMaterialCost,
      scrap_adjustment: calculationResult.scrapAdjustment,
      overhead_cost: calculationResult.overheadCost,
      total_cost_per_unit: calculationResult.totalCostPerUnit,
      effective_cost_per_unit: calculationResult.effectiveCostPerUnit,
      material_utilization_rate: calculationResult.materialUtilizationRate,
      scrap_rate: calculationResult.scrapRate,

      // Calculation breakdown
      calculation_breakdown: calculationResult,

      // Metadata
      is_active: createDto.isActive !== false,
      notes: createDto.notes,
      user_id: userId,

      // Links
      bom_item_id: createDto.bomItemId,
      process_route_id: createDto.processRouteId,
      project_id: createDto.projectId,
    };

    // Debug log the data being inserted
    this.logger.log(`Inserting data: ${JSON.stringify(recordData, null, 2)}`, 'RawMaterialCostService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_material_cost_records')
      .insert(recordData)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Error creating raw material cost: ${error?.message}`, 'RawMaterialCostService');
      throw new InternalServerErrorException(`Failed to create raw material cost: ${error?.message}`);
    }

    return RawMaterialCostResponseDto.fromDatabase(data);
  }

  /**
   * Update an existing raw material cost record
   * Recalculates automatically when relevant fields change
   */
  async update(
    id: string,
    updateDto: UpdateRawMaterialCostDto,
    userId: string,
    accessToken: string,
  ): Promise<RawMaterialCostResponseDto> {
    this.logger.log(`Updating raw material cost: ${id}`, 'RawMaterialCostService');

    // Get existing record
    const { data: existing, error: fetchError } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_material_cost_records')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      this.logger.error(`Raw material cost not found: ${id}`, 'RawMaterialCostService');
      throw new NotFoundException(`Raw material cost with ID ${id} not found`);
    }

    // Merge with update values
    const merged = {
      materialId: updateDto.materialId ?? existing.material_id,
      materialName: updateDto.materialName ?? existing.material_name,
      materialCategory: updateDto.materialCategory ?? existing.material_category,
      materialType: updateDto.materialType ?? existing.material_type,
      materialCostId: updateDto.materialCostId ?? existing.material_cost_id,
      costName: updateDto.costName ?? existing.cost_name,
      unitCost: updateDto.unitCost ?? parseFloat(existing.unit_cost),
      reclaimRate: updateDto.reclaimRate ?? parseFloat(existing.reclaim_rate || '0'),
      uom: updateDto.uom ?? existing.uom,
      grossUsage: updateDto.grossUsage ?? parseFloat(existing.gross_usage),
      netUsage: updateDto.netUsage ?? parseFloat(existing.net_usage),
      scrap: updateDto.scrap ?? parseFloat(existing.scrap),
      overhead: updateDto.overhead ?? parseFloat(existing.overhead),
    };

    // Recalculate
    const calculationResult = this.calculationEngine.calculate(merged);

    // Prepare update data
    const updateData: any = {};

    // Update input fields if provided
    if (updateDto.materialCategoryId !== undefined) updateData.material_category_id = updateDto.materialCategoryId;
    if (updateDto.materialTypeId !== undefined) updateData.material_type_id = updateDto.materialTypeId;
    if (updateDto.materialId !== undefined) updateData.material_id = updateDto.materialId;
    if (updateDto.materialName !== undefined) updateData.material_name = updateDto.materialName;
    if (updateDto.materialCategory !== undefined) updateData.material_category = updateDto.materialCategory;
    if (updateDto.materialType !== undefined) updateData.material_type = updateDto.materialType;
    if (updateDto.materialGroup !== undefined) updateData.material_group = updateDto.materialGroup;
    if (updateDto.materialDescription !== undefined) updateData.material_description = updateDto.materialDescription;
    if (updateDto.country !== undefined) updateData.country = updateDto.country;
    if (updateDto.quarter !== undefined) updateData.quarter = updateDto.quarter;
    if (updateDto.materialCostId !== undefined) updateData.material_cost_id = updateDto.materialCostId;
    if (updateDto.costName !== undefined) updateData.cost_name = updateDto.costName;
    if (updateDto.unitCost !== undefined) updateData.unit_cost = updateDto.unitCost;
    if (updateDto.reclaimRate !== undefined) updateData.reclaim_rate = updateDto.reclaimRate;
    if (updateDto.uom !== undefined) updateData.uom = updateDto.uom;
    if (updateDto.grossUsage !== undefined) updateData.gross_usage = updateDto.grossUsage;
    if (updateDto.netUsage !== undefined) updateData.net_usage = updateDto.netUsage;
    if (updateDto.scrap !== undefined) updateData.scrap = updateDto.scrap;
    if (updateDto.overhead !== undefined) updateData.overhead = updateDto.overhead;
    if (updateDto.isActive !== undefined) updateData.is_active = updateDto.isActive;
    if (updateDto.notes !== undefined) updateData.notes = updateDto.notes;
    if (updateDto.bomItemId !== undefined) updateData.bom_item_id = updateDto.bomItemId;
    if (updateDto.processRouteId !== undefined) updateData.process_route_id = updateDto.processRouteId;
    if (updateDto.projectId !== undefined) updateData.project_id = updateDto.projectId;

    // Always update calculated fields
    updateData.total_cost = calculationResult.totalCost;
    updateData.gross_material_cost = calculationResult.grossMaterialCost;
    updateData.reclaim_value = calculationResult.reclaimValue;
    updateData.net_material_cost = calculationResult.netMaterialCost;
    updateData.scrap_adjustment = calculationResult.scrapAdjustment;
    updateData.overhead_cost = calculationResult.overheadCost;
    updateData.total_cost_per_unit = calculationResult.totalCostPerUnit;
    updateData.effective_cost_per_unit = calculationResult.effectiveCostPerUnit;
    updateData.material_utilization_rate = calculationResult.materialUtilizationRate;
    updateData.scrap_rate = calculationResult.scrapRate;
    updateData.calculation_breakdown = calculationResult;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_material_cost_records')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Error updating raw material cost: ${error?.message}`, 'RawMaterialCostService');
      throw new NotFoundException(`Failed to update raw material cost with ID ${id}`);
    }

    return RawMaterialCostResponseDto.fromDatabase(data);
  }

  /**
   * Delete a raw material cost record
   */
  async remove(id: string, userId: string, accessToken: string): Promise<{ message: string }> {
    this.logger.log(`Deleting raw material cost: ${id}`, 'RawMaterialCostService');

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_material_cost_records')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting raw material cost: ${error.message}`, 'RawMaterialCostService');
      throw new InternalServerErrorException(`Failed to delete raw material cost: ${error.message}`);
    }

    return { message: 'Raw material cost deleted successfully' };
  }

  /**
   * Calculate raw material cost without saving to database
   * Useful for preview/what-if analysis
   */
  async calculateOnly(input: RawMaterialCostInput): Promise<any> {
    this.logger.log('Calculating raw material cost (no save)', 'RawMaterialCostService');

    try {
      const result = this.calculationEngine.calculate(input);
      return result;
    } catch (error) {
      this.logger.error(`Calculation error: ${error.message}`, 'RawMaterialCostService');
      throw new InternalServerErrorException(`Calculation failed: ${error.message}`);
    }
  }

  /**
   * Recalculate an existing record
   * Used when fetching records to ensure fresh calculations
   */
  private recalculateRecord(record: any): any {
    const input: RawMaterialCostInput = {
      materialId: record.material_id,
      materialName: record.material_name,
      materialCategory: record.material_category,
      materialType: record.material_type,
      materialCostId: record.material_cost_id,
      costName: record.cost_name,
      unitCost: parseFloat(record.unit_cost) || 0,
      reclaimRate: parseFloat(record.reclaim_rate) || 0,
      uom: record.uom,
      grossUsage: parseFloat(record.gross_usage) || 0,
      netUsage: parseFloat(record.net_usage) || 0,
      scrap: parseFloat(record.scrap) || 0,
      overhead: parseFloat(record.overhead) || 0,
    };

    const calculationResult = this.calculationEngine.calculate(input);

    return {
      ...record,
      total_cost: calculationResult.totalCost,
      gross_material_cost: calculationResult.grossMaterialCost,
      reclaim_value: calculationResult.reclaimValue,
      net_material_cost: calculationResult.netMaterialCost,
      scrap_adjustment: calculationResult.scrapAdjustment,
      overhead_cost: calculationResult.overheadCost,
      total_cost_per_unit: calculationResult.totalCostPerUnit,
      effective_cost_per_unit: calculationResult.effectiveCostPerUnit,
      material_utilization_rate: calculationResult.materialUtilizationRate,
      scrap_rate: calculationResult.scrapRate,
      calculation_breakdown: calculationResult,
    };
  }

  /**
   * Get total raw material cost for a specific BOM item
   */
  async getTotalCostForBomItem(
    bomItemId: string,
    userId?: string,
    accessToken?: string,
  ): Promise<number> {
    this.logger.log(`Calculating total raw material cost for BOM item: ${bomItemId}`, 'RawMaterialCostService');

    const client = this.supabaseService.getClient(accessToken);

    // Get all active raw material costs for this BOM item — compute from source fields
    // Formula: gross_usage × unit_cost × (1 + overhead/100)
    // We never read stored total_cost which may be null for AI-applied records.
    const { data: costs, error } = await client
      .from('raw_material_cost_records')
      .select('gross_usage, unit_cost, overhead')
      .eq('bom_item_id', bomItemId)
      .eq('is_active', true);

    if (error) {
      this.logger.error('Error fetching raw material costs for BOM item', error.message, 'RawMaterialCostService');
      throw new InternalServerErrorException('Failed to fetch raw material costs');
    }

    const totalCost = costs?.reduce((sum, r) => {
      const computed = (parseFloat(r.gross_usage) || 0) * (parseFloat(r.unit_cost) || 0) * (1 + (parseFloat(r.overhead) || 0) / 100);
      return sum + computed;
    }, 0) || 0;

    this.logger.log(`Total raw material cost for BOM item ${bomItemId}: ${totalCost}`, 'RawMaterialCostService');
    return totalCost;
  }

  async getBulkTotalCosts(
    bomItemIds: string[],
    accessToken?: string,
  ): Promise<Record<string, number>> {
    if (bomItemIds.length === 0) return {};

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_material_cost_records')
      .select('bom_item_id, gross_usage, unit_cost, overhead')
      .in('bom_item_id', bomItemIds)
      .eq('is_active', true);

    if (error) {
      this.logger.error(`Error fetching bulk raw material costs: ${error.message}`, 'RawMaterialCostService');
      throw new InternalServerErrorException(`Failed to fetch bulk raw material costs: ${error.message}`);
    }

    const totals: Record<string, number> = Object.fromEntries(bomItemIds.map(id => [id, 0]));
    for (const row of data ?? []) {
      const computed = (parseFloat(row.gross_usage) || 0) * (parseFloat(row.unit_cost) || 0) * (1 + (parseFloat(row.overhead) || 0) / 100);
      totals[row.bom_item_id] = (totals[row.bom_item_id] ?? 0) + computed;
    }
    return totals;
  }

  /**
   * Look up the location-specific unit cost (local currency/kg) for a material grade string.
   * Uses tokenized ILIKE search so compound grades like "IS2062 E250 CRCA" find
   * "Mild Steel IS2062" and "CRCA Steel" even when no row stores the full compound string.
   * Returns 0 on no match or any error — caller decides whether to surface the gap.
   */
  private async lookupMaterialPrice(
    accessToken: string,
    materialName: string,
    country: string,
  ): Promise<number> {
    // Maps digital-factory country strings to raw_materials price columns
    const PRICE_COL: Record<string, string> = {
      India: 'cost_india', USA: 'cost_usa', Germany: 'cost_germany',
      France: 'cost_france', 'W. Europe': 'cost_europe', 'E. Europe': 'cost_e_europe',
      UK: 'cost_uk', China: 'cost_china', Vietnam: 'cost_vietnam', Mexico: 'cost_mexico',
    };
    const priceCol = PRICE_COL[country] ?? 'cost_india';
    try {
      const g = materialName.trim();
      const tokens = g.split(/[\s\-\/]+/).filter((t) => t.length >= 3);
      // Double-quote each token value so PostgREST treats commas and parens inside
      // the value as literals, not OR separators / grouping operators.
      // e.g. "Steel," in a token would break .or() without quoting.
      const q = (t: string) => `"${t.replace(/"/g, '\\"')}"`;
      const orClause = (tokens.length > 1 ? tokens : [g])
        .flatMap((t) => [`material_grade.ilike.%${q(t)}%`, `material.ilike.%${q(t)}%`])
        .join(',');
      const { data } = await this.supabaseService
        .getClient(accessToken)
        .from('raw_materials')
        .select(`${priceCol}, cost_india, density`)
        .or(orClause)
        .not('density', 'is', null)
        .limit(5);
      for (const row of (data ?? []) as any[]) {
        const locPrice = parseFloat(row[priceCol]);
        if (isFinite(locPrice) && locPrice > 0) return locPrice;
        const indiaPrice = parseFloat(row.cost_india);
        if (isFinite(indiaPrice) && indiaPrice > 0) return indiaPrice;
      }
    } catch {
      // Non-critical — caller falls back to $0 display with a prompt to enter manually
    }
    return 0;
  }
}
