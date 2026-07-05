import { Injectable, Logger, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateBOMItemDto, UpdateBOMItemDto } from './dto/bom-items.dto';
import { BOMItemResponseDto, BOMItemListResponseDto } from './dto/bom-item-response.dto';
import { computeCostSummary, computeSustainability } from './costing/cost-engine';
import type { MHRRateInput } from './costing/cost-engine';
import {
  computeCNCMilledCostSummary, computeCNCTurnedCostSummary,
  checkCNCCapability, computeRouteComplexityScore,
  requiredMilledMachineClass, meetsRequiredMilledClass, pickRecommendedRoute,
} from './costing/cost-cnc-engine';
import type { CNCCostInput, CNCMachineClass } from './costing/cost-cnc-engine';
import { computeInjectionMoldedCostSummary, IM_RUNNER_SCRAP_PCT } from './costing/cost-injection-molding-engine';
import type { InjectionMoldingCostInput } from './costing/cost-injection-molding-engine';
import { isPlasticGrade } from './costing/injection-molding/process-tree';
import {
  MATERIAL_DEFAULTS, MATERIAL_OVERHEAD_PCT, RATES_SOURCE_LABEL,
  LASER_SETUP_MIN, LASER_SPEED_MM_PER_MIN, LASER_PIERCE_SEC,
  PRESS_BRAKE_SETUP_MIN, PRESS_BRAKE_SEC_PER_BEND,
  DEBURR_SEC_PER_METRE, DEBURR_SEC_PER_PIERCE,
  TAPPING_SETUP_MIN, TAP_CYCLE_SEC,
  MACHINE_REGISTRY, LOCATION_INFO, LOCATION_MHR_DEFAULTS,
  LOCATION_ABRASIVE_PRICE_PER_KG,
  DEFAULT_COSTING_LOCATION, benchmarkRateWarning,
  resolveUtsMpa, laserSpeedFactor, isSheetFormableMaterial,
} from './costing/default-rates';
import type { MachineClass } from './costing/default-rates';
import { computeTurretPunchCost } from './costing/turret-punch-engine';
import { computeWaterjetCost } from './costing/waterjet-engine';
import { checkMachineCapability } from './costing/machine-capability';
import type { PartGeometryForCapability } from './costing/machine-capability';
import type { CostSummaryDto, ProcessLineCost } from './dto/cost-breakdown.dto';
import type { RouteComparisonDto, RouteResultDto, RouteId, RouteCapability } from './dto/route-comparison.dto';
import { deriveGdtSeverity, resolveInspectionRule, SEVERITY_RANK } from './costing/gdt-severity';
import type { GdtSeverity, InspectionMethod, InspectionRuleRow } from './costing/gdt-severity';
import type { InspectionStagePolicy } from './costing/default-rates';
import { InspectionKnowledgeService } from '../manufacturing-knowledge/services/inspection-knowledge.service';
import type { GdtAnalysisDto, GdtFeatureDto } from './dto/gdt-analysis.dto';
import {
  classifyLaserMaterial, laserRequirement, latheRequirement,
  pressBrakeRequirement, vmcRequirement, injectionMoldingRequirement,
  MATERIAL_K, MATERIAL_MRR_CM3_MIN,
} from './costing/machine-selection/physics';
import type { MachineRequirement } from './costing/machine-selection/physics';
import { fetchMachinePool, selectMachine } from './costing/machine-selection/selector';
import { lookupSeedCapability } from './costing/machine-selection/seed-registry';
import type { MachineRecommendation, MachineSelectionResult } from './dto/machine-selection.dto';
import {
  shapeRankForFamily,
  isDiscouragedShapeForFamily,
} from '../raw-materials/constants/material-shape-ranking';

@Injectable()
export class BOMItemsService {
  private readonly logger = new Logger(BOMItemsService.name);

  // Cached field mapping for performance (avoids runtime object creation)
  private static readonly FIELD_MAPPING: Record<string, string> = Object.freeze({
    bomId: 'bom_id',
    partNumber: 'part_number',
    itemType: 'item_type',
    parentItemId: 'parent_item_id',
    annualVolume: 'annual_volume',
    materialGrade: 'material_grade',
    makeBuy: 'make_buy',
    unitCost: 'unit_cost',
    sortOrder: 'sort_order',
    file3dPath: 'file_3d_path',
    fileStepPath: 'file_step_path',
    file2dPath: 'file_2d_path',
    fileDxfPath: 'file_dxf_path',
    materialId: 'material_id',
    weight: 'weight',
    maxLength: 'max_length',
    maxWidth: 'max_width',
    maxHeight: 'max_height',
    surfaceArea: 'surface_area',
    volume: 'volume',
    manufacturingFamilyOverride: 'manufacturing_family_override',
    materialSource:     'material_source',
    materialConfidence: 'material_confidence',
    sheetThicknessMm:     'sheet_thickness_mm',
    cutLengthMm:          'cut_length_mm',
    bendCount:            'bend_count',
    holeCount:            'hole_count',
    pierceCount:          'pierce_count',
    flatPatternAreaMm2:   'flat_pattern_area_mm2',
    featureGraph:           'feature_graph',
    familyClassification:   'family_classification',
    familyConfidence:       'family_confidence',
    surfaceFinishRa:        'surface_finish_ra',
    surfaceFinishConfidence:'surface_finish_confidence',
    heatTreatment:          'heat_treatment',
    coating:                'coating',
    coatingConfidence:      'coating_confidence',
    complexity:             'complexity',
    tightestToleranceMm:    'tightest_tolerance_mm',
    toleranceConfidence:    'tolerance_confidence',
    drawingIntelligence:    'drawing_intelligence',
    validationConfig:       'validation_config',
  });

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly inspectionKnowledge: InspectionKnowledgeService,
  ) { }

  /**
   * Transform camelCase DTO properties to snake_case database columns
   * Optimized with cached mapping and type safety
   */
  private transformDtoToDb(dto: Record<string, any>): Record<string, any> {
    const transformed: Record<string, any> = {};

    // Optimized transformation using cached mapping
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        const dbKey = BOMItemsService.FIELD_MAPPING[key] ?? key;
        transformed[dbKey] = value;
      }
    }

    // Denormalise family classification from featureGraph so it is queryable
    // without jsonb extraction. Only writes if not already explicitly provided.
    if (transformed.feature_graph && transformed.family_classification === undefined) {
      const cls = (transformed.feature_graph as any)?.classification;
      if (cls?.family) transformed.family_classification = cls.family;
      if (cls?.confidence != null) transformed.family_confidence = Number(cls.confidence);
    }

    return transformed;
  }

  async findAll(
    bomId?: string,
    search?: string,
    itemType?: string,
    page = 1,
    limit = 50,
    userId?: string,
    accessToken?: string,
  ): Promise<BOMItemListResponseDto> {
    this.logger.log('Fetching BOM items', 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);

    let query = client
      .from('bom_items')
      .select('*')
      .order('created_at', { ascending: false });

    // Apply filters
    if (bomId) {
      query = query.eq('bom_id', bomId);
      this.logger.log(`Filtering BOM items for BOM ID: ${bomId}`, 'BOMItemsService');
    }
    if (search) {
      query = query.or(`part_number.ilike.%${search}%,description.ilike.%${search}%`);
    }
    if (itemType) {
      query = query.eq('item_type', itemType);
    }

    // Get total count with same filters
    let countQuery = client
      .from('bom_items')
      .select('*', { count: 'exact', head: true });

    if (bomId) countQuery = countQuery.eq('bom_id', bomId);
    if (search) countQuery = countQuery.or(`part_number.ilike.%${search}%,description.ilike.%${search}%`);
    if (itemType) countQuery = countQuery.eq('item_type', itemType);

    const { count } = await countQuery;

    // Apply pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    this.logger.log(`Query results: Found ${data?.length || 0} BOM items for BOM ID: ${bomId}`, 'BOMItemsService');
    
    // Additional debug: Check if the BOM exists but has no items
    if (bomId && (!data || data.length === 0)) {
      const { data: bomCheck } = await client.from('boms').select('id, name').eq('id', bomId).single();
      if (bomCheck) {
        this.logger.log(`BOM exists but has no items: ${bomCheck.name} (${bomCheck.id})`, 'BOMItemsService');
      } else {
        this.logger.log(`BOM not found with ID: ${bomId}`, 'BOMItemsService');
      }
    }
    
    if (error) {
      this.logger.error(`Error fetching BOM items: ${error.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to fetch BOM items: ${error.message}`);
    }

    // Transform database rows to DTOs
    const transformedItems = (data || []).map(row => BOMItemResponseDto.fromDatabase(row));

    return {
      items: transformedItems,
      total: count || 0,
      page,
      limit,
    } as BOMItemListResponseDto;
  }

  async findOne(
    id: string,
    userId?: string,
    accessToken?: string,
  ): Promise<BOMItemResponseDto> {
    this.logger.log(`Fetching BOM item with ID: ${id}`, 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('bom_items')
      .select('*')
      .eq('id', id)
      .limit(1);

    if (error) {
      this.logger.error(`Error fetching BOM item: ${error.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to fetch BOM item: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new NotFoundException(`BOM item with ID ${id} not found`);
    }

    return BOMItemResponseDto.fromDatabase(row);
  }

  async create(
    createBOMItemDto: CreateBOMItemDto,
    userId?: string,
    accessToken?: string,
  ): Promise<BOMItemResponseDto> {
    this.logger.log(
      `Creating BOM item: ${createBOMItemDto.partNumber}`,
      'BOMItemsService',
    );

    const client = this.supabaseService.getClient(accessToken);

    // Transform camelCase DTO to snake_case database columns
    const dbData = this.transformDtoToDb(createBOMItemDto);

    const { data, error } = await client
      .from('bom_items')
      .insert({
        ...dbData,
        user_id: userId,
      })
      .select('*')
      .limit(1);

    if (error) {
      this.logger.error(`Error creating BOM item: ${error.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to create BOM item: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new InternalServerErrorException('Failed to create BOM item: no row returned');
    return BOMItemResponseDto.fromDatabase(row);
  }

  async update(
    id: string,
    updateBOMItemDto: UpdateBOMItemDto,
    userId?: string,
    accessToken?: string,
  ): Promise<BOMItemResponseDto> {
    this.logger.log(`Updating BOM item with ID: ${id}`, 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);

    // Transform camelCase DTO to snake_case database columns
    const dbData = this.transformDtoToDb(updateBOMItemDto);

    const { data, error } = await client
      .from('bom_items')
      .update({
        ...dbData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .limit(1);

    if (error) {
      this.logger.error(`Error updating BOM item: ${error.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to update BOM item: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new NotFoundException(`BOM item with ID ${id} not found`);
    }

    return BOMItemResponseDto.fromDatabase(row);
  }

  async updateThumbnailUrl(
    id: string,
    thumbnailUrl: string,
    accessToken?: string,
  ): Promise<{ ok: boolean }> {
    this.logger.log(`Updating thumbnail for BOM item: ${id}`, 'BOMItemsService');
    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_items')
      .update({ thumbnail_url: thumbnailUrl, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      this.logger.error(`Error updating thumbnail: ${error.message}`, 'BOMItemsService');
      // Not fatal — log and continue
    }
    return { ok: !error };
  }

  async updateSortOrder(
    items: Array<{ id: string; sortOrder: number }>,
    userId?: string,
    accessToken?: string,
  ): Promise<{ updated: number }> {
    this.logger.log(`Updating sort order for ${items.length} BOM items`, 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);
    
    // Use batch update with single query instead of N+1 pattern
    try {
      // Create case-when statements for batch update
      const caseStatements = items.map(item => 
        `WHEN id = '${item.id}' THEN ${item.sortOrder}`
      ).join(' ');
      
      const itemIds = items.map(item => `'${item.id}'`).join(',');
      
      const { error, count } = await client.rpc('batch_update_sort_order', {
        case_statements: caseStatements,
        item_ids: itemIds
      });

      if (error) {
        this.logger.error(`Error batch updating sort order: ${error.message}`, 'BOMItemsService');
        return { updated: 0 };
      }

      return { updated: count || items.length };
    } catch (error) {
      this.logger.error(`Error in batch sort order update: ${error}`, 'BOMItemsService');
      return { updated: 0 };
    }
  }

  async getFileUrl(
    id: string,
    fileType: '2d' | '3d',
    userId?: string,
    accessToken?: string,
  ): Promise<{ url: string }> {
    this.logger.log(`Getting ${fileType} file URL for BOM item: ${id}`, 'BOMItemsService');

    const bomItem = await this.findOne(id, userId, accessToken);

    if (fileType === '2d' && bomItem.file2dPath) {
      const { data } = await this.supabaseService
        .getClient(accessToken)
        .storage
        .from('bom-files')
        .createSignedUrl(bomItem.file2dPath, 3600);
      return { url: data?.signedUrl || '' };
    }

    if (fileType === '3d' && bomItem.file3dPath) {
      const { data } = await this.supabaseService
        .getClient(accessToken)
        .storage
        .from('bom-files')
        .createSignedUrl(bomItem.file3dPath, 3600);
      return { url: data?.signedUrl || '' };
    }

    throw new NotFoundException(`${fileType} file not found for BOM item ${id}`);
  }


  async remove(
    id: string,
    userId?: string,
    accessToken?: string,
  ): Promise<void> {
    this.logger.log(`Removing BOM item with ID: ${id}`, 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);

    try {
      // Use cascade delete to automatically clean up all references
      const { data, error } = await client.rpc('cascade_delete_bom_item', {
        item_id: id
      });

      if (error && (
        error.code === '42883' ||      // PostgreSQL: undefined_function
        error.code === 'PGRST202' ||   // PostgREST: function not in schema cache
        error.message?.includes('Could not find the function') ||
        error.message?.includes('schema cache')
      )) {
        // Function doesn't exist, fall back to manual cascade delete
        this.logger.warn('Cascade delete function not available, using manual cascade delete', 'BOMItemsService');
        return await this.manualCascadeDelete(id, userId, accessToken);
      }

      if (error) {
        // Handle any foreign key constraint violations by falling back to manual cascade delete
        if (error.message && (
          error.message.includes('production_lot_materials_bom_item_id_fkey') || 
          error.message.includes('delivery_items_bom_item_id_fkey') ||
          error.message.includes('foreign key constraint') ||
          error.message.includes('violates foreign key')
        )) {
          // Fallback to manual cascade delete if the function fails
          this.logger.warn(`Database function cascade failed due to foreign key constraint, trying manual cascade: ${error.message}`, 'BOMItemsService');
          return await this.manualCascadeDelete(id, userId, accessToken);
        }
        
        this.logger.error(`Error in safe delete function: ${error.message}`, 'BOMItemsService');
        throw new InternalServerErrorException(`Failed to delete BOM item: ${error.message}`);
      }

      if (!data || data.length === 0) {
        throw new NotFoundException(`BOM item with ID ${id} not found`);
      }

      const result = data[0];
      
      if (!result.success) {
        // If cascade delete failed, try manual cascade
        this.logger.warn(`Database cascade delete failed, trying manual approach`, 'BOMItemsService');
        return await this.manualCascadeDelete(id, userId, accessToken);
      }

      this.logger.log(`Successfully removed BOM item with cascade cleanup: ${result.message}`, 'BOMItemsService');
    } catch (error) {
      if (error instanceof NotFoundException || 
          error instanceof BadRequestException || 
          error instanceof ForbiddenException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error removing BOM item ${id}: ${error}`, 'BOMItemsService');
      throw new InternalServerErrorException('An unexpected error occurred while removing the BOM item');
    }
  }

  /**
   * Fallback direct delete method with constraint handling
   */
  private async directDelete(
    id: string,
    userId?: string,
    accessToken?: string,
  ): Promise<void> {
    const client = this.supabaseService.getClient(accessToken);

    // First, check if the item exists
    const { data: existingItem, error: fetchError } = await client
      .from('bom_items')
      .select('id, part_number')
      .eq('id', id)
      .single();

    if (fetchError && fetchError.code === 'PGRST116') {
      throw new NotFoundException(`BOM item with ID ${id} not found`);
    }

    if (fetchError) {
      this.logger.error(`Error fetching BOM item: ${fetchError.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to fetch BOM item: ${fetchError.message}`);
    }

    // Attempt to delete
    const { error: deleteError } = await client
      .from('bom_items')
      .delete()
      .eq('id', id);

    if (deleteError) {
      if (deleteError.code === '23503') {
        // Handle specific foreign key constraints
        let errorMessage = `Cannot delete BOM item "${existingItem?.part_number || id}". `;
        
        if (deleteError.message.includes('production_lot_materials_bom_item_id_fkey')) {
          errorMessage += 'This item is used in production planning materials. Please remove it from production lots first.';
        } else if (deleteError.message.includes('process_routes')) {
          errorMessage += 'This item has associated process routes. Please remove the process routes first.';
        } else if (deleteError.message.includes('parent_item_id')) {
          errorMessage += 'This item has child items. Please remove child items first.';
        } else {
          errorMessage += 'This item is referenced by other data. Please remove related references first.';
        }
        
        throw new BadRequestException(errorMessage);
      }
      
      if (deleteError.code === '42501') {
        throw new ForbiddenException('Insufficient permissions to delete this BOM item');
      }

      this.logger.error(`Error removing BOM item: ${deleteError.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to remove BOM item: ${deleteError.message}`);
    }
  }

  /**
   * Manual cascade delete - removes all references then deletes the item
   */
  private async manualCascadeDelete(
    id: string,
    userId?: string,
    accessToken?: string,
  ): Promise<void> {
    this.logger.log(`Performing manual cascade delete for BOM item: ${id}`, 'BOMItemsService');
    
    const client = this.supabaseService.getClient(accessToken);
    
    try {
      // Get item info first
      const { data: itemData, error: fetchError } = await client
        .from('bom_items')
        .select('part_number')
        .eq('id', id)
        .single();

      if (fetchError && fetchError.code === 'PGRST116') {
        throw new NotFoundException(`BOM item with ID ${id} not found`);
      }

      const itemName = itemData?.part_number || 'Unknown';
      let cleanupCount = 0;

      // 1. Remove from production lot materials
      // First check if there are any to delete (with detailed diagnostics)
      this.logger.log(`Checking for production materials with user context`, 'BOMItemsService');
      
      const { data: prodMaterials, error: prodCheckError } = await client
        .from('production_lot_materials')
        .select('id, production_lot_id')
        .eq('bom_item_id', id);
      
      // Also try with admin client to see if RLS is the issue
      const adminClient = this.supabaseService.getAdminClient ? this.supabaseService.getAdminClient() : null;
      let adminProdMaterials = null;
      
      if (adminClient) {
        const { data: adminData } = await adminClient
          .from('production_lot_materials')
          .select('id, production_lot_id')
          .eq('bom_item_id', id);
        adminProdMaterials = adminData;
        this.logger.log(`Admin client sees ${adminData?.length || 0} production materials`, 'BOMItemsService');
      }
      
      this.logger.log(`User client sees ${prodMaterials?.length || 0} production materials`, 'BOMItemsService');

      if (prodCheckError) {
        this.logger.warn(`Could not check production materials: ${prodCheckError.message}`, 'BOMItemsService');
      }
      
      // Try to delete with admin client if available and user client found nothing
      if (adminClient && adminProdMaterials && adminProdMaterials.length > 0 && (!prodMaterials || prodMaterials.length === 0)) {
        this.logger.log(`Using admin client to delete ${adminProdMaterials.length} production materials (RLS bypass)`, 'BOMItemsService');
        
        const { error: adminProdError, count: adminProdCount } = await adminClient
          .from('production_lot_materials')
          .delete()
          .eq('bom_item_id', id);
        
        if (adminProdError) {
          this.logger.error(`Admin delete failed: ${adminProdError.message}`, 'BOMItemsService');
        } else {
          const actualCount = adminProdCount || adminProdMaterials.length;
          cleanupCount += actualCount;
          this.logger.log(`Admin client successfully removed ${actualCount} production material references`, 'BOMItemsService');
        }
      } else if (prodMaterials && prodMaterials.length > 0) {
        this.logger.log(`Found ${prodMaterials.length} production material references to clean up`, 'BOMItemsService');
        
        const { error: prodError, count: prodCount } = await client
          .from('production_lot_materials')
          .delete()
          .eq('bom_item_id', id);

        if (prodError) {
          this.logger.error(`Failed to clean up production materials: ${prodError.message}`, 'BOMItemsService');
          throw new InternalServerErrorException(`Failed to clean up production planning references: ${prodError.message}`);
        } else {
          const actualCount = prodCount || prodMaterials.length;
          cleanupCount += actualCount;
          this.logger.log(`Successfully removed ${actualCount} production material references`, 'BOMItemsService');
        }
      } else {
        this.logger.log('No production material references found with current user permissions', 'BOMItemsService');
        
        // If admin client shows materials but user client doesn't, it's an RLS issue
        if (adminProdMaterials && adminProdMaterials.length > 0) {
          this.logger.warn(`RLS Policy Issue: Admin sees ${adminProdMaterials.length} materials but user sees 0`, 'BOMItemsService');
        }
      }

      // 2. Remove from process route steps (if any process routes reference this item)
      // First get the process route IDs
      const { data: processRoutes } = await client
        .from('process_routes')
        .select('id')
        .eq('bom_item_id', id);

      let stepsCount = 0;
      let stepsError = null;
      
      if (processRoutes && processRoutes.length > 0) {
        const routeIds = processRoutes.map(route => route.id);
        const stepsResult = await client
          .from('process_route_steps')
          .delete()
          .in('process_route_id', routeIds);
        
        stepsError = stepsResult.error;
        stepsCount = stepsResult.count || 0;
      }

      if (stepsError) {
        this.logger.warn(`Could not clean up process steps: ${stepsError.message}`, 'BOMItemsService');
      } else if (stepsCount) {
        cleanupCount += stepsCount;
        this.logger.log(`Removed ${stepsCount} process route steps`, 'BOMItemsService');
      }

      // 3. Remove process routes
      const { error: routesError, count: routesCount } = await client
        .from('process_routes')
        .delete()
        .eq('bom_item_id', id);

      if (routesError) {
        this.logger.warn(`Could not clean up process routes: ${routesError.message}`, 'BOMItemsService');
      } else if (routesCount) {
        cleanupCount += routesCount;
        this.logger.log(`Removed ${routesCount} process routes`, 'BOMItemsService');
      }

      // 4. Remove from delivery items
      const { error: deliveryError, count: deliveryCount } = await client
        .from('delivery_items')
        .delete()
        .eq('bom_item_id', id);

      if (deliveryError) {
        this.logger.warn(`Could not clean up delivery items: ${deliveryError.message}`, 'BOMItemsService');
      } else if (deliveryCount) {
        cleanupCount += deliveryCount;
        this.logger.log(`Removed ${deliveryCount} delivery item references`, 'BOMItemsService');
      }

      // 5. Update child items to remove parent reference
      const { error: childError, count: childCount } = await client
        .from('bom_items')
        .update({ parent_item_id: null })
        .eq('parent_item_id', id);

      if (childError) {
        this.logger.warn(`Could not orphan child items: ${childError.message}`, 'BOMItemsService');
      } else if (childCount) {
        cleanupCount += childCount;
        this.logger.log(`Orphaned ${childCount} child items`, 'BOMItemsService');
      }

      // 6. Finally delete the BOM item
      this.logger.log(`Attempting to delete BOM item after cleaning up ${cleanupCount} references`, 'BOMItemsService');
      
      // Double-check that production materials are really gone
      const { data: remainingProd, error: checkError } = await client
        .from('production_lot_materials')
        .select('id')
        .eq('bom_item_id', id);
      
      if (!checkError && remainingProd && remainingProd.length > 0) {
        this.logger.error(`Still ${remainingProd.length} production material references exist!`, 'BOMItemsService');
        // Try one more time to delete them
        await client.from('production_lot_materials').delete().eq('bom_item_id', id);
      }
      
      const { error: deleteError } = await client
        .from('bom_items')
        .delete()
        .eq('id', id);

      if (deleteError) {
        this.logger.error(`Failed to delete BOM item after cleanup: ${deleteError.message}`, 'BOMItemsService');
        
        // If it's still a constraint error, the cleanup didn't work
        if (deleteError.message.includes('production_lot_materials_bom_item_id_fkey')) {
          throw new InternalServerErrorException(
            `Unable to remove all production planning references for BOM item "${itemName}". ` +
            `This may be due to database permissions or concurrent modifications. ` +
            `Please try again or contact an administrator.`
          );
        } else if (deleteError.message.includes('delivery_items_bom_item_id_fkey')) {
          throw new InternalServerErrorException(
            `Unable to remove all delivery references for BOM item "${itemName}". ` +
            `This may be due to database permissions or concurrent modifications. ` +
            `Please try again or contact an administrator.`
          );
        }
        
        throw new InternalServerErrorException(
          `Cleaned up ${cleanupCount} references but failed to delete BOM item: ${deleteError.message}`
        );
      }

      this.logger.log(
        `Successfully deleted BOM item "${itemName}" with cascade cleanup (${cleanupCount} references removed)`, 
        'BOMItemsService'
      );
      
    } catch (error) {
      if (error instanceof NotFoundException || 
          error instanceof BadRequestException || 
          error instanceof ForbiddenException ||
          error instanceof InternalServerErrorException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error in manual cascade delete: ${error}`, 'BOMItemsService');
      throw new InternalServerErrorException('Failed to delete BOM item with cascade cleanup');
    }
  }

  async getBOMIdForItem(
    itemId: string,
    userId?: string,
    accessToken?: string,
  ): Promise<string> {
    this.logger.log(`Getting BOM ID for item: ${itemId}`, 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('bom_items')
      .select('bom_id')
      .eq('id', itemId)
      .single();

    if (error) {
      this.logger.error(`Error fetching BOM ID for item: ${error.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to fetch BOM ID: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException(`BOM item with ID ${itemId} not found`);
    }

    return data.bom_id;
  }

  async checkDeleteDependencies(
    id: string,
    userId?: string,
    accessToken?: string,
  ): Promise<{ canDelete: boolean; blockers: string[]; itemName: string }> {
    this.logger.log(`Checking delete dependencies for BOM item: ${id}`, 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);
    const blockers: string[] = [];
    
    // Get item info
    const { data: itemData, error: fetchError } = await client
      .from('bom_items')
      .select('part_number')
      .eq('id', id)
      .single();

    if (fetchError) {
      throw new NotFoundException(`BOM item with ID ${id} not found`);
    }

    const itemName = itemData?.part_number || 'Unknown';

    // Check production lot materials
    const { count: prodCount } = await client
      .from('production_lot_materials')
      .select('*', { count: 'exact', head: true })
      .eq('bom_item_id', id);

    if (prodCount && prodCount > 0) {
      blockers.push(`${prodCount} production lot material(s)`);
    }

    // Check process routes
    const { count: routeCount } = await client
      .from('process_routes')
      .select('*', { count: 'exact', head: true })
      .eq('bom_item_id', id);

    if (routeCount && routeCount > 0) {
      blockers.push(`${routeCount} process route(s)`);
    }

    // Check child items
    const { count: childCount } = await client
      .from('bom_items')
      .select('*', { count: 'exact', head: true })
      .eq('parent_item_id', id);

    if (childCount && childCount > 0) {
      blockers.push(`${childCount} child item(s)`);
    }

    return {
      canDelete: blockers.length === 0,
      blockers,
      itemName
    };
  }

  async getProjectIdForBOM(
    bomId: string,
    userId?: string,
    accessToken?: string,
  ): Promise<string> {
    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('boms')
      .select('project_id')
      .eq('id', bomId)
      .single();

    if (error) {
      this.logger.error(`Error fetching project ID for BOM: ${error.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to fetch project ID: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException(`BOM with ID ${bomId} not found`);
    }

    return data.project_id;
  }

  private async fetchExchangeRates(accessToken: string): Promise<Map<string, number>> {
    const defaults = new Map<string, number>([['INR', 1], ['USD', 83.5], ['EUR', 90.8], ['CNY', 11.52]]);
    try {
      const { data } = await this.supabaseService
        .getClient(accessToken)
        .from('exchange_rates')
        .select('from_currency, rate')
        .eq('is_active', true)
        .eq('to_currency', 'INR')
        .gt('rate', 0);
      if (!data?.length) return defaults;
      const map = new Map<string, number>(defaults);
      for (const row of data) {
        if (row.from_currency && typeof row.rate === 'number' && row.rate > 0) {
          map.set(row.from_currency, row.rate);
        }
      }
      return map;
    } catch {
      return defaults;
    }
  }

  // Kill switch for the capability-based selector: set ENABLE_PHYSICS_MACHINE_SELECTION=false
  // to revert to the legacy lowest-rate lookup without a redeploy of code changes.
  private physicsSelectionEnabled(): boolean {
    return process.env.ENABLE_PHYSICS_MACHINE_SELECTION !== 'false';
  }

  // Compute the physical requirement each machine class must meet for this part.
  // Classes absent from the map are gated as 'generic' (no dimensional constraint).
  private buildPartRequirements(input: {
    family: string;
    grade: string | null;
    sheetThicknessMm: number;
    bendCount: number;
    flatPatternAreaMm2: number;
    flatLenMm: number | null;
    flatWidMm: number | null;
    bboxXMm: number;
    bboxYMm: number;
    bboxZMm: number;
    weightKg: number;
  }): Partial<Record<MachineClass, MachineRequirement>> {
    const requirements: Partial<Record<MachineClass, MachineRequirement>> = {};
    const matFamily = classifyLaserMaterial(input.grade);

    if (input.family === 'sheet_metal' || input.sheetThicknessMm > 0) {
      // Flat pattern dims; fall back to a square of equal area when CAD didn't set them
      const areaSide = input.flatPatternAreaMm2 > 0 ? Math.sqrt(input.flatPatternAreaMm2) : 0;
      const flatLen = input.flatLenMm ?? areaSide;
      const flatWid = input.flatWidMm ?? areaSide;

      const cutReq = laserRequirement({
        thicknessMm: input.sheetThicknessMm,
        materialGrade: input.grade,
        bedLengthMm: flatLen,
        bedWidthMm: flatWid,
      });
      requirements.fiber_laser = cutReq;
      requirements.turret_punch = cutReq;
      requirements.waterjet = cutReq;

      if (input.bendCount > 0) {
        // Longest bend is not in the feature graph yet — the longest flat dimension
        // is the conservative upper bound (a bend can never exceed it)
        requirements.press_brake = pressBrakeRequirement({
          bendLengthMm: Math.max(flatLen, flatWid),
          thicknessMm: input.sheetThicknessMm,
          materialK: MATERIAL_K[matFamily] ?? MATERIAL_K.OTHER,
        });
      }
    }

    if (input.family === 'cnc_milled') {
      const vmcReq = vmcRequirement({
        bboxXMm: input.bboxXMm,
        bboxYMm: input.bboxYMm,
        bboxZMm: input.bboxZMm,
        finishedWeightKg: input.weightKg,
        materialMrrCm3PerMin: MATERIAL_MRR_CM3_MIN[matFamily] ?? MATERIAL_MRR_CM3_MIN.OTHER,
      });
      requirements.cnc_3ax_vmc = vmcReq;
      requirements.cnc_4ax_vmc = vmcReq;
      requirements.cnc_5ax_mc = vmcReq;
    }

    if (input.family === 'cnc_turned' || input.family === 'mill_turn') {
      // Turned-part bbox: longest dim is the part length, the larger of the other two
      // is the turned diameter
      const dims = [input.bboxXMm, input.bboxYMm, input.bboxZMm].sort((a, b) => b - a);
      const latheReq = latheRequirement({ maxDiameterMm: dims[1], maxLengthMm: dims[0] });
      requirements.cnc_lathe = latheReq;
      requirements.cnc_lathe_live = latheReq;
      requirements.cnc_mill_turn = latheReq;
    }

    if (input.family === 'injection_molded') {
      // Projected area (mold-opening direction) approximated as the footprint in
      // the two largest bbox dims — Phase 1 approximation; true projected area
      // in the actual pull direction is a Phase 2 refinement (see plan doc).
      const dims = [input.bboxXMm, input.bboxYMm, input.bboxZMm].sort((a, b) => b - a);
      const projectedAreaMm2 = dims[0] * dims[1];
      requirements.injection_molding = injectionMoldingRequirement({
        projectedAreaMm2,
        materialGrade: input.grade,
        // Shot weight = finished part + runner allowance (same constant the
        // cost engine's material model uses — one number, not two copies).
        shotWeightG: input.weightKg > 0
          ? input.weightKg * 1000 * (1 + IM_RUNNER_SCRAP_PCT / 100)
          : null,
        partLengthMm: dims[0],
        partWidthMm: dims[1],
      });
    }

    return requirements;
  }

  // User overrides: processKey (machine class) → forced mhr_records.id.
  // Scoped by Digital Factory location — an override recorded for India must
  // never force its machine (or its ₹ rate) into a USA/China/Germany costing.
  private async fetchMachineOverrides(
    bomItemId: string,
    accessToken: string,
    location: string,
  ): Promise<Map<string, string>> {
    const overrides = new Map<string, string>();
    const client = this.supabaseService.getClient(accessToken);
    try {
      let { data, error } = await client
        .from('bom_item_machine_overrides')
        .select('process_key, mhr_record_id')
        .eq('bom_item_id', bomItemId)
        .eq('location', location);
      if (error && /column|schema cache/i.test(error.message)) {
        // Migration 329 pending — location column absent. Pre-329 overrides are
        // unscoped; only honour them for the default location rather than let a
        // stale pick leak into every country (the exact bug 329 fixes).
        if (location !== DEFAULT_COSTING_LOCATION) return overrides;
        ({ data, error } = await client
          .from('bom_item_machine_overrides')
          .select('process_key, mhr_record_id')
          .eq('bom_item_id', bomItemId));
      }
      if (error) return overrides;
      for (const row of data ?? []) {
        if (row.process_key && row.mhr_record_id) overrides.set(row.process_key, row.mhr_record_id);
      }
    } catch {
      // Table missing (migration 326 pending) — no overrides
    }
    return overrides;
  }

  // Attach the full selection result onto each process line by machine class,
  // so the UI can render recommendation + alternatives without another API call.
  private attachMachineSelections(
    lines: ProcessLineCost[],
    mhrRates: Record<string, MHRRateInput>,
  ): void {
    const byClass = new Map<string, MachineSelectionResult>();
    for (const rate of Object.values(mhrRates)) {
      if (rate.selection) byClass.set(rate.machineClass, rate.selection);
    }
    for (const line of lines) {
      // Machine-less lines (Fixture: amortised tooling hardware, zero machine
      // time) must not carry a machine picker.
      if (line.hourlyRate <= 0) continue;
      const selection = byClass.get(line.machineClass);
      if (selection) line.machineSelection = selection;
    }
  }

  // Per-process selection for inherited tapping: the recommended "machine" for
  // the Tapping line IS the machining centre the part is already on. Present it
  // as such (instead of a contradictory "class default ₹400/hr" panel), while
  // keeping the override key = 'tapping' so a cost engineer can still force a
  // dedicated drill/tap centre — that override then wins on the next costing.
  private synthesizeInheritedTappingSelection(
    primary: MachineSelectionResult | undefined,
  ): MachineSelectionResult | undefined {
    if (!primary) return undefined;
    const rec: MachineRecommendation = {
      candidate: primary.balanced.candidate,
      score: primary.balanced.score,
      reasons: [
        'Rigid tapping on the selected machining centre — no dedicated tapping machine on file for this location',
      ],
    };
    return {
      balanced: rec,
      cheapest: rec,
      fastest: rec,
      alternatives: [],
      confidence: primary.confidence,
      requirement: { kind: 'generic' },
      allowOverride: true,
      overridden: false,
    };
  }

  // Append-only audit trail: record what the selector chose so a quote can be
  // explained months later. Insert-on-change only; failures must never block costing.
  private async writeSelectionSnapshots(
    bomItemId: string,
    accessToken: string,
    mhrRates: Record<string, MHRRateInput>,
    location: string,
  ): Promise<void> {
    try {
      const client = this.supabaseService.getClient(accessToken);
      const selections = Object.values(mhrRates)
        .filter((r) => r.selection && r.selection.requirement.kind !== 'generic')
        .map((r) => ({ processKey: r.machineClass, selection: r.selection! }));
      if (selections.length === 0) return;

      // Dedupe per (process, location): India and USA selections for the same
      // item are different audit facts, not repeats of each other.
      const { data: last } = await client
        .from('bom_item_machine_selection_snapshots')
        .select('process_key, selected_machine_id, created_at')
        .eq('bom_item_id', bomItemId)
        .eq('location', location)
        .order('created_at', { ascending: false })
        .limit(50);

      const lastByKey = new Map<string, string | null>();
      for (const row of last ?? []) {
        if (!lastByKey.has(row.process_key)) lastByKey.set(row.process_key, row.selected_machine_id);
      }

      const inserts = selections
        .filter(({ processKey, selection }) => {
          const prev = lastByKey.get(processKey);
          const current = selection.balanced.candidate.machineId;
          return prev === undefined || prev !== current;
        })
        .map(({ processKey, selection }) => ({
          bom_item_id: bomItemId,
          process_key: processKey,
          location,
          selected_machine_id: selection.balanced.candidate.machineId,
          capability_version: selection.balanced.candidate.capabilityVersion,
          selection_json: selection,
        }));

      if (inserts.length > 0) {
        await client.from('bom_item_machine_selection_snapshots').insert(inserts);
      }
    } catch (e) {
      this.logger.warn(
        `Selection snapshot write failed (non-blocking): ${e instanceof Error ? e.message : e}`,
        'BOMItemsService',
      );
    }
  }

  async setMachineOverride(
    bomItemId: string,
    userId: string,
    accessToken: string,
    processKey: string,
    mhrRecordId: string | null,
    location: string = DEFAULT_COSTING_LOCATION,
  ): Promise<{ processKey: string; mhrRecordId: string | null; location: string }> {
    if (!(processKey in MACHINE_REGISTRY)) {
      throw new BadRequestException(`Unknown process key: ${processKey}`);
    }
    // findOne enforces the caller can access this BOM item
    await this.findOne(bomItemId, userId, accessToken);
    const client = this.supabaseService.getClient(accessToken);

    if (mhrRecordId === null) {
      const { error } = await client
        .from('bom_item_machine_overrides')
        .delete()
        .eq('bom_item_id', bomItemId)
        .eq('process_key', processKey)
        .eq('location', location);
      if (error) throw new InternalServerErrorException(`Failed to clear machine override: ${error.message}`);
      return { processKey, mhrRecordId: null, location };
    }

    // Validate the machine exists before persisting — a stale id would silently
    // revert to auto-selection later, which reads as data loss to the user
    const { data: machine, error: mhrError } = await client
      .from('mhr_records')
      .select('id, location')
      .eq('id', mhrRecordId)
      .maybeSingle();
    if (mhrError || !machine) throw new BadRequestException(`MHR record ${mhrRecordId} not found`);

    // A machine belongs to exactly one location; forcing it into another
    // location's costing applies the wrong currency AND the wrong shop rate.
    const machineLocation = (machine as { location?: string | null }).location;
    if (machineLocation && machineLocation !== location) {
      throw new BadRequestException(
        `Machine ${mhrRecordId} belongs to ${machineLocation} — it cannot be forced into a ${location} costing. ` +
        `Switch the Digital Factory to ${machineLocation} or pick a ${location} machine.`,
      );
    }

    const { error } = await client
      .from('bom_item_machine_overrides')
      .upsert(
        {
          bom_item_id: bomItemId,
          process_key: processKey,
          location,
          mhr_record_id: mhrRecordId,
          overridden_by: userId,
          overridden_at: new Date().toISOString(),
        },
        { onConflict: 'bom_item_id,process_key,location' },
      );
    if (error) throw new InternalServerErrorException(`Failed to save machine override: ${error.message}`);
    return { processKey, mhrRecordId, location };
  }

  // aPriori-style manual overrides: field_key = 'mat_rate' | '<process>::rate' |
  // '<process>::cycleMin'. Scoped by location for the same reason as machine
  // overrides — an India rate override must not silently apply after switching
  // the Digital Factory to USA.
  private async fetchCostOverrides(
    bomItemId: string,
    accessToken: string,
    location: string,
  ): Promise<Map<string, number>> {
    const overrides = new Map<string, number>();
    try {
      const { data, error } = await this.supabaseService
        .getClient(accessToken)
        .from('bom_item_cost_overrides')
        .select('field_key, value')
        .eq('bom_item_id', bomItemId)
        .eq('location', location);
      if (error) return overrides;
      for (const row of data ?? []) {
        const v = Number(row.value);
        if (row.field_key && Number.isFinite(v)) overrides.set(row.field_key, v);
      }
    } catch {
      // Table missing (migration 330 pending) — no overrides
    }
    return overrides;
  }

  // Applied after the family-specific engine + attachMachineSelections, so it
  // sees the final process line set for whichever route was actually costed.
  //
  // Material rate is applied as a SCALE FACTOR on the engine's own computed
  // materialCost (override / originalRatePerKg), not reconstructed from
  // scratch — the CNC engine folds a billet-overhead multiplier into
  // materialCost that this method must not have to know about or duplicate.
  // Scaling proportionally reproduces "the engine had run with this rate" for
  // any formula that is linear in cost-per-kg, which weight × rate always is.
  //
  // Process line rate/cycle time ARE reconstructed directly (runCost =
  // rate/60 × cycleMin, setupCost untouched) — this is the exact formula the
  // UI's inline editor already uses, not a new one.
  private applyCostOverrides(result: CostSummaryDto, overrides: Map<string, number>): void {
    if (overrides.size === 0) return;

    const matRateOv = overrides.get('mat_rate');
    if (matRateOv != null && result.materialCostPerKg > 0) {
      const scale = matRateOv / result.materialCostPerKg;
      result.materialCost = this.r2(result.materialCost * scale);
      result.materialCostPerKg = matRateOv;
      result.materialSource = 'db'; // user-confirmed rate — no longer a default estimate
    }

    for (const line of result.processLines) {
      const rateOv = overrides.get(`${line.process}::rate`);
      const cycleOv = overrides.get(`${line.process}::cycleMin`);
      if (rateOv == null && cycleOv == null) continue;
      line.hourlyRate = rateOv ?? line.hourlyRate;
      line.cycleTimeMin = cycleOv ?? line.cycleTimeMin;
      line.runCost = this.r2((line.hourlyRate / 60) * line.cycleTimeMin);
      line.totalCost = this.r2(line.setupCost + line.runCost);
    }

    result.totalProcessCost = this.r2(result.processLines.reduce((s, l) => s + l.totalCost, 0));
    result.totalCost = this.r2(result.materialCost + result.totalProcessCost);
  }

  async setCostOverride(
    bomItemId: string,
    userId: string,
    accessToken: string,
    fieldKey: string,
    value: number | null,
    location: string = DEFAULT_COSTING_LOCATION,
  ): Promise<{ fieldKey: string; value: number | null; location: string }> {
    // findOne enforces the caller can access this BOM item
    await this.findOne(bomItemId, userId, accessToken);
    const client = this.supabaseService.getClient(accessToken);

    if (value === null) {
      const { error } = await client
        .from('bom_item_cost_overrides')
        .delete()
        .eq('bom_item_id', bomItemId)
        .eq('field_key', fieldKey)
        .eq('location', location);
      if (error) throw new InternalServerErrorException(`Failed to clear cost override: ${error.message}`);
      return { fieldKey, value: null, location };
    }

    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(`Cost override value must be a positive number: ${value}`);
    }

    const { error } = await client
      .from('bom_item_cost_overrides')
      .upsert(
        {
          bom_item_id: bomItemId,
          location,
          field_key: fieldKey,
          value,
          overridden_by: userId,
          overridden_at: new Date().toISOString(),
        },
        { onConflict: 'bom_item_id,location,field_key' },
      );
    if (error) throw new InternalServerErrorException(`Failed to save cost override: ${error.message}`);
    return { fieldKey, value, location };
  }

  private async resolveMHRRates(
    accessToken: string,
    location = 'India',
    physics?: {
      requirements: Partial<Record<MachineClass, MachineRequirement>>;
      overrides: Map<string, string>;
    },
  ): Promise<{
    laser: MHRRateInput;
    pressBrake: MHRRateInput;
    deburring: MHRRateInput;
    tapping: MHRRateInput;
    inspection: MHRRateInput;
    turret: MHRRateInput;
    waterjet: MHRRateInput;
    cnc3ax: MHRRateInput;
    cnc4ax: MHRRateInput;
    cnc5ax: MHRRateInput;
    cncLathe: MHRRateInput;
    cncLatheLive: MHRRateInput;
    cncMillTurn: MHRRateInput;
    injectionMolding: MHRRateInput;
  }> {
    const locationMHR = (LOCATION_MHR_DEFAULTS as Record<string, Partial<Record<MachineClass, number>>>)[location];
    const makeDefault = (cls: MachineClass): MHRRateInput => ({
      rate: locationMHR?.[cls] ?? MACHINE_REGISTRY[cls].defaultRate,
      source: 'default_rate',
      machineClass: cls,
      machineName: null,
      commodityCode: null,
    });

    const allClasses: MachineClass[] = [
      'fiber_laser', 'press_brake', 'deburring', 'tapping', 'cmm', 'turret_punch', 'waterjet',
      'cnc_3ax_vmc', 'cnc_4ax_vmc', 'cnc_5ax_mc', 'cnc_lathe', 'cnc_lathe_live', 'cnc_mill_turn',
      'injection_molding',
    ];

    const buildOutput = (resolved: Map<MachineClass, MHRRateInput>) => ({
      laser:        resolved.get('fiber_laser')    ?? makeDefault('fiber_laser'),
      pressBrake:   resolved.get('press_brake')    ?? makeDefault('press_brake'),
      deburring:    resolved.get('deburring')      ?? makeDefault('deburring'),
      tapping:      resolved.get('tapping')        ?? makeDefault('tapping'),
      inspection:   resolved.get('cmm')            ?? makeDefault('cmm'),
      turret:       resolved.get('turret_punch')   ?? makeDefault('turret_punch'),
      waterjet:     resolved.get('waterjet')       ?? makeDefault('waterjet'),
      cnc3ax:       resolved.get('cnc_3ax_vmc')    ?? makeDefault('cnc_3ax_vmc'),
      cnc4ax:       resolved.get('cnc_4ax_vmc')    ?? makeDefault('cnc_4ax_vmc'),
      cnc5ax:       resolved.get('cnc_5ax_mc')     ?? makeDefault('cnc_5ax_mc'),
      cncLathe:     resolved.get('cnc_lathe')      ?? makeDefault('cnc_lathe'),
      cncLatheLive: resolved.get('cnc_lathe_live') ?? makeDefault('cnc_lathe_live'),
      cncMillTurn:  resolved.get('cnc_mill_turn')  ?? makeDefault('cnc_mill_turn'),
      injectionMolding: resolved.get('injection_molding') ?? makeDefault('injection_molding'),
    });

    // ── Physics-based capability selection (new engine) ───────────────────────
    // Selects by physical capability + fit/utilization/cost scoring instead of
    // lowest-rate string matching. Falls back to the legacy path on any failure.
    if (physics && this.physicsSelectionEnabled()) {
      try {
        const pool = await fetchMachinePool(
          this.supabaseService.getClient(accessToken),
          location,
        );
        const resolved = new Map<MachineClass, MHRRateInput>();
        for (const cls of allClasses) {
          const requirement: MachineRequirement =
            physics.requirements[cls] ?? { kind: 'generic' };
          const selection = selectMachine({
            pool,
            location,
            machineClass: cls,
            requirement,
            overrideMachineId: physics.overrides.get(cls) ?? null,
          });
          const cand = selection.balanced.candidate;
          resolved.set(cls, {
            rate: cand.hourlyRate,
            source: cand.machineId ? 'mhr_database' : 'default_rate',
            machineClass: cls,
            machineName: cand.machineName,
            commodityCode: cand.commodityCode,
            selection,
          });
        }
        return buildOutput(resolved);
      } catch (e) {
        // No silent zero-rates: log loudly, then fall through to the legacy lookup
        this.logger.error(
          `Physics machine selection failed — falling back to legacy rate lookup: ${e instanceof Error ? e.message : e}`,
          undefined,
          'BOMItemsService',
        );
      }
    }

    // Prefer fully_burdened_local_per_hr (machine + labour), fall back through
    // total_machine_hour_rate, then manual_mhr_value.
    const pickRate = (row: any): number => {
      const fb  = Number(row.fully_burdened_local_per_hr ?? 0);
      const mhr = Number(row.total_machine_hour_rate ?? 0);
      const man = Number(row.manual_mhr_value ?? 0);
      return fb > 0 ? fb : mhr > 0 ? mhr : man;
    };

    try {
      // Pass 1 — exact commodity_code match (seeded / legacy records)
      const allCodes = allClasses.flatMap((cls) => [...MACHINE_REGISTRY[cls].commodityCodes]);

      const { data: primaryData, error } = await this.supabaseService
        .getClient(accessToken)
        .from('mhr_records')
        .select(
          'machine_name, commodity_code, process_group, machine_class, ' +
          'total_machine_hour_rate, manual_mhr_value, fully_burdened_local_per_hr',
        )
        .in('commodity_code', allCodes)
        .eq('location', location);

      const resolved = new Map<MachineClass, MHRRateInput>();

      if (!error && primaryData?.length) {
        // Build index: commodity_code → ALL records (keep all so name-based filtering
        // below can reject off-class records sharing the same commodity code, e.g.
        // "Default Deslag" tagged SM-LASER-2K must not win for the fiber_laser class)
        type Hit = { rate: number; machineName: string };
        const dbIndex = new Map<string, Hit[]>();
        for (const row of primaryData as any[]) {
          const rate = pickRate(row);
          if (rate <= 0) continue;
          const hits = dbIndex.get(row.commodity_code) ?? [];
          hits.push({ rate, machineName: row.machine_name ?? '' });
          dbIndex.set(row.commodity_code, hits);
        }

        for (const cls of allClasses) {
          // Collect every record across all commodity codes for this class
          const allCandidates: Array<{ code: string; hit: Hit }> = [];
          for (const code of MACHINE_REGISTRY[cls].commodityCodes as readonly string[]) {
            for (const hit of dbIndex.get(code) ?? []) {
              allCandidates.push({ code, hit });
            }
          }
          if (allCandidates.length === 0) continue;

          // Prefer records whose machine name contains a class keyword; fall back to
          // all commodity-code matches only if no named record exists.
          const nameKws = MACHINE_REGISTRY[cls].machineClassKeywords;
          const nameFiltered = allCandidates.filter((c) =>
            nameKws.some((kw) => c.hit.machineName.toLowerCase().includes(kw.toLowerCase())),
          );
          const pool = nameFiltered.length > 0 ? nameFiltered : allCandidates;
          const best = pool.reduce((a, b) => (a.hit.rate <= b.hit.rate ? a : b));

          resolved.set(cls, {
            rate: best.hit.rate,
            source: 'mhr_database',
            machineClass: cls,
            machineName: best.hit.machineName,
            commodityCode: best.code,
          });
        }
      }

      // Pass 2 — keyword fallback for imported records (commodity_code = processGroup text)
      const classesNeedingFallback = allClasses.filter((cls) => !resolved.has(cls));

      if (classesNeedingFallback.length > 0) {
        const orParts: string[] = [];
        for (const cls of classesNeedingFallback) {
          for (const kw of MACHINE_REGISTRY[cls].processGroupKeywords)
            orParts.push(`process_group.ilike.%${kw}%`);
          for (const kw of MACHINE_REGISTRY[cls].machineClassKeywords)
            orParts.push(`machine_class.ilike.%${kw}%`);
        }

        const { data: fbData } = await this.supabaseService
          .getClient(accessToken)
          .from('mhr_records')
          .select(
            'machine_name, commodity_code, process_group, machine_class, ' +
            'total_machine_hour_rate, manual_mhr_value, fully_burdened_local_per_hr',
          )
          .eq('location', location)
          .or(orParts.join(','));

        if (fbData?.length) {
          // For each fallback row, find which classes it best matches by keyword priority:
          // machine_class keyword match wins over process_group keyword match.
          type FbCandidate = { rate: number; machineName: string; commodityCode: string };
          const fbBest = new Map<MachineClass, FbCandidate>();

          for (const row of fbData as any[]) {
            const rate = pickRate(row);
            if (rate <= 0) continue;
            const mcLower = (row.machine_class ?? '').toLowerCase();
            const pgLower = (row.process_group ?? '').toLowerCase();

            for (const cls of classesNeedingFallback) {
              if (resolved.has(cls)) continue;

              const nameKws = MACHINE_REGISTRY[cls].machineClassKeywords;
              const mcMatch = nameKws.some((kw) => mcLower.includes(kw.toLowerCase()));
              const pgMatch = !mcMatch && MACHINE_REGISTRY[cls].processGroupKeywords.some((kw) =>
                pgLower.includes(kw.toLowerCase()),
              );

              if (!mcMatch && !pgMatch) continue;

              // Prevent cross-class contamination: lathes must not resolve VMC milling classes
              const isLatheRecord = /lathe|turning|sliding.head|sub.?spindle/i.test(mcLower + ' ' + pgLower);
              const isVMCClass = ['cnc_3ax_vmc', 'cnc_4ax_vmc', 'cnc_5ax_mc'].includes(cls as string);
              if (isVMCClass && isLatheRecord) continue;

              // When only process_group matched (less specific), also require the machine_name
              // to contain a class keyword so "Default Deslag" (process_group=Laser) can't win
              // the fiber_laser class by lowest rate.
              if (pgMatch) {
                const mnLower = (row.machine_name ?? '').toLowerCase();
                const nameMatch = nameKws.some((kw) => mnLower.includes(kw.toLowerCase()));
                if (!nameMatch) continue;
              }

              const existing = fbBest.get(cls);
              if (!existing || rate < existing.rate) {
                fbBest.set(cls, { rate, machineName: row.machine_name, commodityCode: row.commodity_code ?? '' });
              }
            }
          }

          for (const [cls, hit] of fbBest) {
            resolved.set(cls, {
              rate: hit.rate,
              source: 'mhr_database',
              machineClass: cls,
              machineName: hit.machineName,
              commodityCode: hit.commodityCode,
            });
          }
        }
      }

      return buildOutput(resolved);
    } catch {
      return buildOutput(new Map());
    }
  }

  // Family-aware material resolution — shared by cost summary and route
  // comparison so both price the SAME raw-material row. Candidate rows are
  // ranked by product form for the part family (a machined billet part must
  // never price on a "Sheet" row while a plate/bar row exists — that was the
  // "T6 - Sheet on a machined boom clamp" defect). All INR fallbacks convert
  // to the location currency; a raw INR number in a EUR/USD costing is a
  // silent ~80-90× error.
  // ── Family resolution ───────────────────────────────────────────────────────
  // Single precedence chain used by BOTH costing endpoints (summary ≡ route
  // invariant): user override > material physics > geometry classifier.
  //
  // Geometry alone cannot distinguish a machined plate from a molded cover of
  // the identical shape — the material can. This is the aPriori routing model:
  // geometry proposes, material routes, user override is final.
  //   1. manufacturing_family_override — explicit user intent, always wins
  //      (e.g. machined-PEEK prototype pinned to cnc_milled).
  //   2. Thermoplastic grade → injection_molded, whatever the shape classifier
  //      guessed (a PA66 cover and an aluminium cover are the same geometry).
  //   3. Non-sheet-formable alloy on a sheet-shaped part → cnc_milled (flat
  //      bronze casting can never run a laser + press-brake route).
  //   4. Geometry classifier result.
  private resolveEffectiveFamily(input: {
    item: BOMItemResponseDto;
    fg: any;
    grade: string | null;
    sheetThicknessMm: number;
  }): { family: string; familySource: 'override' | 'material' | 'geometry'; warning: string | null } {
    const override = (input.item.manufacturingFamilyOverride ?? '').trim();
    if (override) return { family: override, familySource: 'override', warning: null };

    const geoFamily: string =
      input.fg?.classification?.family ??
      input.item.familyClassification ??
      (input.sheetThicknessMm > 0 ? 'sheet_metal' : 'unknown');

    if (isPlasticGrade(input.grade) && geoFamily !== 'injection_molded') {
      return {
        family: 'injection_molded',
        familySource: 'material',
        warning:
          `Material "${input.grade}" is a thermoplastic — routed to injection molding ` +
          `(geometry classifier suggested ${geoFamily.replace(/_/g, ' ')}). ` +
          'Set a manufacturing-family override on the item to force a machining route instead.',
      };
    }

    if (geoFamily === 'sheet_metal' && !isSheetFormableMaterial(input.grade)) {
      return {
        family: 'cnc_milled',
        familySource: 'material',
        warning:
          `${input.grade} is not sheet-formable (cast alloy) — geometry looks like flat sheet ` +
          'but the part is costed as a machined plate; verify the intended process',
      };
    }

    return { family: geoFamily, familySource: 'geometry', warning: null };
  }

  private async resolveMaterialForFamily(input: {
    accessToken: string;
    grade: string | null;
    family: string;
    materialCol: string;
    locInrRate: number;
    warnings: string[];
  }): Promise<{ materialCostPerKg: number; materialDensityKgM3: number; materialSource: 'db' | 'default' }> {
    const { accessToken, grade, family, materialCol, locInrRate, warnings } = input;

    if (grade) {
      try {
        const client = this.supabaseService.getClient(accessToken);
        const g = grade.trim();
        const { data } = await client
          .from('raw_materials')
          .select(`${materialCol}, cost_india, cost, density, density_kg_m3, shape, material_grade`)
          .or(`material_grade.ilike.%${g}%,material.ilike.%${g}%`)
          .limit(12);

        // Cast via unknown: the select() column list is dynamic (location column),
        // which Supabase's literal-type parser cannot statically resolve.
        const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
          const locCost = row[materialCol] as number | null;
          const indiaCost = (row.cost_india ?? row.cost) as number | null;
          const densityGCm3 = row.density as number | null;
          const densityKgM3 =
            (row.density_kg_m3 as number | null) ?? (densityGCm3 != null ? densityGCm3 * 1000 : null);
          return { shape: (row.shape as string | null) ?? null, locCost, indiaCost, densityKgM3 };
        });

        const usable = rows
          .filter(
            (r) =>
              ((r.locCost != null && r.locCost > 0) || (r.indiaCost != null && r.indiaCost > 0)) &&
              r.densityKgM3 != null &&
              r.densityKgM3 > 0,
          )
          .sort((a, b) => shapeRankForFamily(a.shape, family) - shapeRankForFamily(b.shape, family));

        const best = usable[0];
        if (best) {
          if (isDiscouragedShapeForFamily(best.shape, family)) {
            warnings.push(
              `Material priced from "${best.shape}" stock — no ${family.replace(/_/g, ' ')}-appropriate product form found for "${grade}" in raw materials. Verify the cost/kg before quoting.`,
            );
          }
          return {
            materialCostPerKg:
              best.locCost != null && best.locCost > 0
                ? best.locCost
                : (best.indiaCost as number) / locInrRate,
            materialDensityKgM3: best.densityKgM3 as number,
            materialSource: 'db',
          };
        }
      } catch {
        // fall through to named defaults below
      }
    }

    const gradeUpper = (grade ?? '').toUpperCase();
    const fallbackKey =
      Object.keys(MATERIAL_DEFAULTS).find((k) => k !== '__default__' && gradeUpper.includes(k)) ??
      '__default__';
    const fallback = MATERIAL_DEFAULTS[fallbackKey];
    return {
      // MATERIAL_DEFAULTS is INR-denominated — convert into the location currency
      materialCostPerKg: fallback.costPerKg / Math.max(locInrRate, 1e-9),
      materialDensityKgM3: fallback.densityKgM3,
      materialSource: 'default',
    };
  }

  // Rigid tapping runs on the machining centre that milled/turned the part when
  // the location has no dedicated tapping machine on file — price it at that
  // machine's real rate instead of a ghost "Class default (tapping)" figure.
  private inheritCncTappingRate(tapping: MHRRateInput, primary: MHRRateInput): MHRRateInput {
    if (tapping.source === 'mhr_database') return tapping;
    return {
      rate: primary.rate,
      source: primary.source,
      machineClass: tapping.machineClass,
      machineName: primary.machineName,
      commodityCode: primary.commodityCode,
    };
  }

  // Surface implausible DB rates (broken imports — the migration-327 bug class)
  // and benchmark-priced lines on the summary. Never clamps: the MHR DB stays
  // authoritative, but a rate 50%+ off the location benchmark must be visible
  // on the document a quote is read from, not only in a machine-detail popup.
  private appendRateWarnings(
    result: { processLines: ProcessLineCost[]; warnings: string[] },
    location: string,
  ): void {
    const seen = new Set<string>();
    const benchmarkPriced: string[] = [];
    for (const line of result.processLines) {
      if (line.hourlyRate <= 0) continue;
      const key = `${line.machineClass}:${line.hourlyRate}:${line.rateSource}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (line.rateSource === 'mhr_database') {
        const warning = benchmarkRateWarning(line.machineClass, location, line.hourlyRate, line.machineName);
        if (warning && !result.warnings.includes(warning)) result.warnings.push(warning);
      } else {
        benchmarkPriced.push(line.machineClass.replace(/_/g, ' '));
      }
    }
    if (benchmarkPriced.length > 0) {
      result.warnings.push(
        `No capable MHR machine on file in ${location} for: ${[...new Set(benchmarkPriced)].join(', ')} — ` +
        `priced at ${location} benchmark rates. Import MHR records for ${location} to quote on actual equipment.`,
      );
    }
  }

  // Reconcile cost-critical sheet-metal geometry across sources BEFORE costing.
  // Two silent-zero bugs live here otherwise:
  //   1. CAD bend detection can return 0 (sharp-corner STEP models have no bend
  //      cylinders) while the drawing states the real count — the route then shows
  //      Press Brake but the cost engine silently drops the line.
  //   2. The measured flat-pattern area only covers the dominant face, so bent
  //      parts undercount the blank ~2× and material weight/cost follow it down.
  // Wrong zeros are worse than visible errors: every substitution is warned.
  private resolveSheetGeometryInputs(args: {
    item: BOMItemResponseDto;
    fg: any;
    geoBendCount: number;
    flatPatternAreaMm2: number;
    sheetThicknessMm: number;
  }): {
    bendCount: number;
    bendSource: 'cad' | 'drawing' | 'estimated';
    flatPatternAreaMm2: number;
    blankAreaSource: 'cad' | 'reconstructed';
    warnings: string[];
  } {
    const warnings: string[] = [];

    // ── Bend count: CAD geometry vs drawing intelligence ──────────────────────
    const drawingBendCount =
      Math.max(0, Math.round(Number((args.item.drawingIntelligence as any)?.bend_count ?? 0))) || 0;
    let bendCount = args.geoBendCount;
    let bendSource: 'cad' | 'drawing' | 'estimated' = 'cad';
    if (drawingBendCount > bendCount) {
      bendCount = drawingBendCount;
      bendSource = 'drawing';
      if (args.geoBendCount === 0) {
        warnings.push(
          `Bend count (${drawingBendCount}) taken from the 2D drawing — CAD geometry reported 0 bends`,
        );
      }
    }
    // Route-aware guard: the recommended route bends the part but neither CAD nor
    // drawing supplied a count — price 1 bend with a warning instead of pricing 0.
    const routeHasBending = ((args.fg?.processRecommendations ?? []) as Array<{ process?: string }>)
      .some((r) => /press\s*brake|bend/i.test(String(r?.process ?? '')));
    if (bendCount === 0 && routeHasBending) {
      bendCount = 1;
      bendSource = 'estimated';
      warnings.push(
        'Bend count missing from geometry and drawing — estimated 1 bend from the recommended route; verify before quoting',
      );
    }

    // ── Blank area: measured flat pattern vs volume ÷ thickness ───────────────
    let flatPatternAreaMm2 = args.flatPatternAreaMm2;
    let blankAreaSource: 'cad' | 'reconstructed' = 'cad';
    const volumeMm3 = Number(args.item.volume ?? 0) || 0;
    if (volumeMm3 > 0 && args.sheetThicknessMm > 0) {
      const expectedAreaMm2 = volumeMm3 / args.sheetThicknessMm;
      const delta =
        flatPatternAreaMm2 > 0
          ? Math.abs(flatPatternAreaMm2 - expectedAreaMm2) / expectedAreaMm2
          : 1;
      if ((bendCount > 0 && delta > 0.3) || flatPatternAreaMm2 === 0) {
        warnings.push(
          `Flat pattern area reconstructed from CAD volume ÷ thickness ` +
            `(${Math.round(expectedAreaMm2).toLocaleString()} mm² vs ` +
            `${Math.round(flatPatternAreaMm2).toLocaleString()} mm² measured) — ` +
            `measured blank was missing bent-flange area`,
        );
        flatPatternAreaMm2 = expectedAreaMm2;
        blankAreaSource = 'reconstructed';
      }
    }

    return { bendCount, bendSource, flatPatternAreaMm2, blankAreaSource, warnings };
  }

  async getCostSummary(
    id: string,
    userId: string,
    accessToken: string,
    batchSize = 1,
    location = DEFAULT_COSTING_LOCATION,
  ): Promise<CostSummaryDto> {
    const item = await this.findOne(id, userId, accessToken);

    const fg = item.featureGraph as any;
    const summary = fg?.summary ?? {};

    const sheetThicknessMm = (summary.sheetThicknessMm ?? item.sheetThicknessMm ?? 0) as number;

    // Drawing analysis material always wins — it reads the title block directly.
    // Auto-fill material (from geometry heuristics) is a fallback only.
    const drawingGrade = ((item.drawingIntelligence as any)?.material ?? null) as string | null;
    const grade = (drawingGrade?.trim() || null) ?? item.materialGrade ?? item.material ?? null;

    // Override > material > geometry — one precedence chain for both costing
    // endpoints (see resolveEffectiveFamily).
    const familyResolution = this.resolveEffectiveFamily({ item, fg, grade, sheetThicknessMm });
    const family = familyResolution.family;

    const cutLengthMm = (summary.cutLengthMm ?? item.cutLengthMm ?? 0) as number;
    const pierceCount = (summary.pierceCount ?? item.pierceCount ?? 0) as number;
    const geoBendCount = (summary.bendCount ?? item.bendCount ?? 0) as number;
    const measuredFlatAreaMm2 = (summary.flatPatternAreaMm2 ?? item.flatPatternAreaMm2 ?? 0) as number;
    const holeCount = (summary.holeCount ?? item.holeCount ?? 0) as number;
    const threads = ((item.drawingIntelligence as any)?.threads ?? []) as Array<{ size: string; count: number }>;

    // Reconcile bend count + blank area across CAD / drawing / route before costing
    const geo = family === 'sheet_metal'
      ? this.resolveSheetGeometryInputs({
          item, fg,
          geoBendCount,
          flatPatternAreaMm2: measuredFlatAreaMm2,
          sheetThicknessMm,
        })
      : null;
    const bendCount = geo?.bendCount ?? geoBendCount;
    const flatPatternAreaMm2 = geo?.flatPatternAreaMm2 ?? measuredFlatAreaMm2;

    const locInfo = LOCATION_INFO[location] ?? LOCATION_INFO[DEFAULT_COSTING_LOCATION];
    const exchangeRates = await this.fetchExchangeRates(accessToken);
    const usdInrRate = exchangeRates.get('USD') ?? 83.5;
    const locInrRate = exchangeRates.get(locInfo.code) ?? locInfo.defaultInrRate;
    const toUsdRate = locInfo.code === 'USD' ? 1 : locInrRate / usdInrRate;
    const currencyMeta = { currency: locInfo.code, currencySymbol: locInfo.symbol, toUsdRate };

    const materialWarnings: string[] = [];
    if (familyResolution.warning) materialWarnings.push(familyResolution.warning);
    const { materialCostPerKg, materialDensityKgM3, materialSource } =
      await this.resolveMaterialForFamily({
        accessToken,
        grade,
        family,
        materialCol: locInfo.materialCol,
        locInrRate,
        warnings: materialWarnings,
      });

    const costOverrides = await this.fetchCostOverrides(id, accessToken, location);

    const physics = this.physicsSelectionEnabled()
      ? {
          requirements: this.buildPartRequirements({
            family,
            grade,
            sheetThicknessMm,
            bendCount,
            flatPatternAreaMm2,
            flatLenMm: ((item as any).maxLength ?? (item as any).max_length ?? null) as number | null,
            flatWidMm: ((item as any).maxWidth ?? (item as any).max_width ?? null) as number | null,
            bboxXMm: (((item as any).maxLength ?? 0) as number),
            bboxYMm: (((item as any).maxWidth ?? 0) as number),
            bboxZMm: (((item as any).maxHeight ?? 0) as number),
            weightKg: (((item as any).weight ?? 0) as number),
          }),
          overrides: await this.fetchMachineOverrides(id, accessToken, location),
        }
      : undefined;

    const mhrRates = await this.resolveMHRRates(accessToken, location, physics);

    // Audit trail — non-blocking; costing must never wait on or fail with it
    if (physics) void this.writeSelectionSnapshots(id, accessToken, mhrRates, location);

    if (family === 'cnc_milled' || family === 'cnc_turned' || family === 'mill_turn') {
      const inspectionRules = await this.inspectionKnowledge.getInspectionRules(accessToken);
      const samplingPolicy = await this.resolveSamplingPolicy(item, accessToken);
      const baseCncInput: Omit<CNCCostInput, 'mhrRate' | 'tappingRate'> = {
        volume: (item.volume ?? 0) as number,
        surfaceArea: (item.surfaceArea ?? 0) as number,
        maxLength: ((item as any).maxLength ?? 0) as number,
        maxWidth: ((item as any).maxWidth ?? 0) as number,
        maxHeight: ((item as any).maxHeight ?? 0) as number,
        holeCount,
        holeGroups: (summary.holeGroups ?? []) as Array<{ diameter_mm: number; count: number }>,
        pocketCount: (fg?.cnc_features?.feature_summary?.pockets ?? 0) as number,
        materialGrade: grade,
        materialCostPerKg,
        materialDensityKgM3,
        materialSource,
        threads: this.resolveThreads(threads, fg),
        tightestToleranceMm: ((item as any).tightestToleranceMm ?? null) as number | null,
        gdtFeatureCount: (fg?.cnc_features?.feature_summary?.gdt_features ?? 0) as number,
        batchSize,
        family,
        finishedWeightKg: ((item as any).weight ?? 0) as number,
        deburrRate: mhrRates.deburring,
        inspectionRate: mhrRates.inspection,
        surfaceTreatment: this.resolveSurfaceTreatment(item),
        samplingPerN: this.resolveSamplingPerN(item),
        samplingPolicy,
        gdtFeatures: this.extractGdtFeatures(item, inspectionRules),
        location,
      };

      // Single source of truth with Route Comparison: cost every feasible route
      // and quote on the recommended one (lowest total cost among capable
      // candidates, gated by the class the part's features demand). The old
      // difficulty-only pick here diverged from Route Comparison's lowest-cost
      // badge — two prices for the same part is a P0 for quoting.
      const pockets = (fg?.cnc_features?.feature_summary?.pockets ?? 0) as number;
      const requiredClass = requiredMilledMachineClass(fg?.difficultyLevel as string | null, pockets);

      const candidateClasses: Array<{ cls: CNCMachineClass; rate: MHRRateInput }> =
        family === 'cnc_milled'
          ? [
              { cls: 'cnc_3ax_vmc', rate: mhrRates.cnc3ax },
              { cls: 'cnc_4ax_vmc', rate: mhrRates.cnc4ax },
              { cls: 'cnc_5ax_mc', rate: mhrRates.cnc5ax },
            ]
          : [
              { cls: 'cnc_lathe', rate: mhrRates.cncLathe },
              { cls: 'cnc_lathe_live', rate: mhrRates.cncLatheLive },
              { cls: 'cnc_mill_turn', rate: mhrRates.cncMillTurn },
            ];

      const costedRoutes = candidateClasses.map(({ cls, rate }) => {
        const tappingRate = this.inheritCncTappingRate(mhrRates.tapping, rate);
        const input: CNCCostInput = { ...baseCncInput, mhrRate: rate, tappingRate };
        const cost =
          family === 'cnc_milled'
            ? computeCNCMilledCostSummary(input, cls)
            : computeCNCTurnedCostSummary(input, cls);
        const envelope = checkCNCCapability(
          cls, baseCncInput.maxLength, baseCncInput.maxWidth, baseCncInput.maxHeight,
          baseCncInput.finishedWeightKg,
        );
        const capable =
          envelope.overallCapable &&
          (family !== 'cnc_milled' || meetsRequiredMilledClass(cls, requiredClass));
        return { cls, cost, capable, totalCost: cost.totalCost, setupCount: cost.setupCount ?? 1 };
      });

      const recommended = pickRecommendedRoute(costedRoutes);
      const cncResult = { ...recommended.cost, ...currencyMeta };
      if (!recommended.capable) {
        cncResult.warnings.push(
          'No costed route fully satisfies the part envelope/complexity — showing the closest option; review machine capability.',
        );
      }
      cncResult.warnings.push(...materialWarnings);
      this.attachMachineSelections(cncResult.processLines, mhrRates);
      // Inherited tapping runs on the recommended route's machine — surface
      // THAT machine on the Tapping line's selector, not the class default.
      if (mhrRates.tapping.source !== 'mhr_database') {
        const primaryRate = candidateClasses.find((c) => c.cls === recommended.cls)?.rate;
        const tapSelection = this.synthesizeInheritedTappingSelection(primaryRate?.selection);
        for (const line of cncResult.processLines) {
          if (line.process === 'Tapping') line.machineSelection = tapSelection;
        }
      }
      this.appendRateWarnings(cncResult, location);
      this.applyCostOverrides(cncResult, costOverrides);
      if (costOverrides.size > 0) cncResult.costOverrides = Object.fromEntries(costOverrides);
      return cncResult;
    }

    if (family === 'injection_molded') {
      const imBbox = [
        ((item as any).maxLength ?? 0) as number,
        ((item as any).maxWidth ?? 0) as number,
        ((item as any).maxHeight ?? 0) as number,
      ].sort((a, b) => b - a);
      // Derive machine physical specs from seed registry for cavity count model.
      // Tonnage from machine name → kN (1 metric ton = 10 kN).
      const machineSpec = lookupSeedCapability(mhrRates.injectionMolding.machineName);
      const clampTonnageKN = machineSpec?.maxTonnage != null ? machineSpec.maxTonnage * 10 : undefined;
      // Shot capacity: ~0.9 × tonnage (industry rule of thumb; see cost-injection-molding-engine.ts)
      const shotCapacityCm3 = machineSpec?.maxTonnage != null ? machineSpec.maxTonnage * 0.9 : undefined;

      const imInput: InjectionMoldingCostInput = {
        volume: (item.volume ?? 0) as number,
        surfaceArea: (item.surfaceArea ?? 0) as number,
        wallThicknessNominalMm: (summary.wallThicknessNominalMm ?? 0) as number,
        materialGrade: grade,
        materialCostPerKg,
        materialDensityKgM3,
        materialSource,
        batchSize,
        family,
        mhrRate: mhrRates.injectionMolding,
        deburrRate: mhrRates.deburring,
        inspectionRate: mhrRates.inspection,
        clampTonnageKN,
        shotCapacityCm3,
        // Tooling amortization: use annualVolume from item; default 5yr production life.
        annualVolume: ((item as any).annualVolume as number | null | undefined) ?? undefined,
        productionLifeYears: 5,
        // Phase 4: bbox dimensions for fill-time and gate-recommendation models.
        // imBbox is sorted descending, so [0]=longest, [1]=mid, [2]=shortest.
        bboxMaxMm: imBbox[0],
        bboxMidMm: imBbox[1],
        signals: {
          projectedAreaMm2: imBbox[0] * imBbox[1] > 0 ? imBbox[0] * imBbox[1] : null,
          wallThicknessMinMm: (summary.wallThicknessMinMm as number) > 0 ? (summary.wallThicknessMinMm as number) : null,
          wallThicknessMaxMm: (summary.wallThicknessMaxMm as number) > 0 ? (summary.wallThicknessMaxMm as number) : null,
          // Phase 4: use real rib count (antiparallel wall-face pairs); fall back to
          // pocket-floor proxy when CAD engine is pre-Phase 4.
          ribCount: (summary.ribCount as number) > 0
            ? (summary.ribCount as number)
            : (summary.ribCountProxy as number) > 0 ? (summary.ribCountProxy as number) : null,
          // Phase 4: bosses = blind cylindrical features (capped), NOT all cylinders.
          // holeOrBossCount lumps through-holes and bosses; blindFeatureCount is cap-detected.
          bossCount: (summary.blindFeatureCount as number) > 0 ? (summary.blindFeatureCount as number) : null,
          // Phase 2 signals — null when CAD engine is pre-Phase 2 (safe: router applies
          // conservative defaults and records routingWarnings when signals are null)
          undercutCount: (summary.undercutFaceCount as number) > 0 ? (summary.undercutFaceCount as number) : null,
          partingComplexity: (summary.partingComplexity as number | null) ?? null,
          // Phase 3: insert candidates from CAD blind-hole OD matching
          insertCount: (summary.insertCandidateCount as number) > 0 ? (summary.insertCandidateCount as number) : null,
        },
      };
      const imResult = { ...computeInjectionMoldedCostSummary(imInput), ...currencyMeta };
      imResult.warnings.push(...materialWarnings);
      this.attachMachineSelections(imResult.processLines, mhrRates);
      this.appendRateWarnings(imResult, location);
      this.applyCostOverrides(imResult, costOverrides);
      if (costOverrides.size > 0) imResult.costOverrides = Object.fromEntries(costOverrides);
      return imResult;
    }

    const smResult = {
      ...computeCostSummary({
        sheetThicknessMm,
        cutLengthMm,
        pierceCount,
        bendCount,
        flatPatternAreaMm2,
        holeCount,
        threads,
        materialGrade: grade,
        materialCostPerKg,
        materialDensityKgM3,
        materialSource,
        batchSize,
        family,
        mhrRates,
      }),
      ...currencyMeta,
    };
    smResult.warnings.push(...materialWarnings);
    if (geo) {
      smResult.warnings.push(...geo.warnings);
      smResult.geometryProvenance = { bendSource: geo.bendSource, blankAreaSource: geo.blankAreaSource };
    }
    this.attachMachineSelections(smResult.processLines, mhrRates);
    this.appendRateWarnings(smResult, location);
    this.applyCostOverrides(smResult, costOverrides);
    if (costOverrides.size > 0) smResult.costOverrides = Object.fromEntries(costOverrides);
    return smResult;
  }

  async getRouteComparison(
    id: string,
    userId: string,
    accessToken: string,
    batchSize = 1,
    location = DEFAULT_COSTING_LOCATION,
  ): Promise<RouteComparisonDto> {
    const item = await this.findOne(id, userId, accessToken);

    const fg = item.featureGraph as any;
    const summary = fg?.summary ?? {};

    const sheetThicknessMm = (summary.sheetThicknessMm ?? item.sheetThicknessMm ?? 0) as number;
    const drawingGradeRC = ((item.drawingIntelligence as any)?.material ?? null) as string | null;
    const grade = (drawingGradeRC?.trim() || null) ?? item.materialGrade ?? item.material ?? null;

    // Override > material > geometry — same resolver as getCostSummary, by
    // construction (summary ≡ route invariant).
    const familyResolutionRC = this.resolveEffectiveFamily({ item, fg, grade, sheetThicknessMm });
    const family = familyResolutionRC.family;

    const cutLengthMm     = (summary.cutLengthMm      ?? item.cutLengthMm      ?? 0) as number;
    const pierceCount     = (summary.pierceCount       ?? item.pierceCount      ?? 0) as number;
    const geoBendCount    = (summary.bendCount         ?? item.bendCount        ?? 0) as number;
    const measuredFlatAreaMm2 = (summary.flatPatternAreaMm2 ?? item.flatPatternAreaMm2 ?? 0) as number;
    const holeCount       = (summary.holeCount         ?? item.holeCount        ?? 0) as number;

    // Same geometry reconciliation as getCostSummary — the two endpoints must
    // price identical inputs or the summary and comparison diverge silently.
    const geo = family === 'sheet_metal'
      ? this.resolveSheetGeometryInputs({
          item, fg,
          geoBendCount,
          flatPatternAreaMm2: measuredFlatAreaMm2,
          sheetThicknessMm,
        })
      : null;
    const bendCount = geo?.bendCount ?? geoBendCount;
    const flatPatternAreaMm2 = geo?.flatPatternAreaMm2 ?? measuredFlatAreaMm2;
    const threads = ((item.drawingIntelligence as any)?.threads ?? []) as Array<{ size: string; count: number }>;

    // Flat pattern dimensions — from bom_items.max_length / max_width (set by CAD pipeline).
    // Access both camelCase and snake_case to handle FIELD_MAPPING variations safely.
    const flatPatternLengthMm = ((item as any).maxLength ?? (item as any).max_length ?? null) as number | null;
    const flatPatternWidthMm  = ((item as any).maxWidth  ?? (item as any).max_width  ?? null) as number | null;

    const capabilityGeometry: PartGeometryForCapability = {
      sheetThicknessMm,
      flatPatternLengthMm,
      flatPatternWidthMm,
      // Longest flat-pattern edge as bend-line proxy (conservative: real bend
      // lines are ≤ the longest edge, so tonnage errs on the safe side)
      bendLengthMm: bendCount > 0
        ? Math.max(flatPatternLengthMm ?? 0, flatPatternWidthMm ?? 0) || null
        : null,
      materialUtsMpa: resolveUtsMpa(grade),
    };

    // ── Shared warnings ────────────────────────────────────────────────────────
    const comparisonWarnings: string[] = [];
    if (!grade) comparisonWarnings.push('Material grade not set — default mild steel rates applied');
    if (geo) comparisonWarnings.push(...geo.warnings);
    if (familyResolutionRC.warning) comparisonWarnings.push(familyResolutionRC.warning);

    // ── Material cost — same resolver as getCostSummary, by construction ──────
    const locInfo = LOCATION_INFO[location] ?? LOCATION_INFO[DEFAULT_COSTING_LOCATION];
    const exchangeRates = await this.fetchExchangeRates(accessToken);
    const locInrRate = exchangeRates.get(locInfo.code) ?? locInfo.defaultInrRate;

    const { materialCostPerKg, materialDensityKgM3, materialSource } =
      await this.resolveMaterialForFamily({
        accessToken,
        grade,
        family,
        materialCol: locInfo.materialCol,
        locInrRate,
        warnings: comparisonWarnings,
      });

    const thk = sheetThicknessMm > 0 ? sheetThicknessMm : 2.0;
    const volumeMm3 = flatPatternAreaMm2 * thk;
    const netWeightKg = (volumeMm3 / 1e9) * materialDensityKgM3;
    const grossWeightKg = netWeightKg * (1 + MATERIAL_OVERHEAD_PCT / 100);
    const materialCost = this.r2(grossWeightKg * materialCostPerKg);

    // ── MHR rates ──────────────────────────────────────────────────────────────
    const physics = this.physicsSelectionEnabled()
      ? {
          requirements: this.buildPartRequirements({
            family,
            grade,
            sheetThicknessMm,
            bendCount,
            flatPatternAreaMm2,
            flatLenMm: flatPatternLengthMm,
            flatWidMm: flatPatternWidthMm,
            bboxXMm: (((item as any).maxLength ?? 0) as number),
            bboxYMm: (((item as any).maxWidth ?? 0) as number),
            bboxZMm: (((item as any).maxHeight ?? 0) as number),
            weightKg: (((item as any).weight ?? 0) as number),
          }),
          overrides: await this.fetchMachineOverrides(id, accessToken, location),
        }
      : undefined;

    const mhrRates = await this.resolveMHRRates(accessToken, location, physics);

    const attachToRoutes = (dto: RouteComparisonDto): RouteComparisonDto => {
      for (const route of dto.routes) {
        this.attachMachineSelections(route.processLines, mhrRates);
        // Inherited tapping runs on THIS route's primary machine — surface that
        // machine on the Tapping line, not the "class default (tapping)" panel.
        if (mhrRates.tapping.source !== 'mhr_database') {
          const primaryLine =
            route.processLines.find((l) => l.process === 'Setup') ?? route.processLines[0];
          const primarySelection = primaryLine
            ? Object.values(mhrRates).find((r) => r.machineClass === primaryLine.machineClass)
                ?.selection
            : undefined;
          const tapSelection = this.synthesizeInheritedTappingSelection(primarySelection);
          for (const line of route.processLines) {
            if (line.process === 'Tapping') line.machineSelection = tapSelection;
          }
        }
      }
      this.appendRateWarnings(
        { processLines: dto.routes.flatMap((r) => r.processLines), warnings: dto.comparisonWarnings },
        location,
      );
      return dto;
    };

    if (family === 'cnc_milled' || family === 'cnc_turned' || family === 'mill_turn') {
      // Same rules + sampling policy as getCostSummary — totals must match line for line
      const inspection = {
        rules: await this.inspectionKnowledge.getInspectionRules(accessToken),
        policy: await this.resolveSamplingPolicy(item, accessToken),
      };
      if (family === 'cnc_milled') {
        return attachToRoutes(this.buildCNCMilledRoutes(
          id, item, fg, summary, grade, materialCostPerKg, materialDensityKgM3,
          materialSource, mhrRates, batchSize, comparisonWarnings, locInfo, location,
          inspection,
        ));
      }
      return attachToRoutes(this.buildCNCTurnedRoutes(
        id, item, fg, summary, grade, materialCostPerKg, materialDensityKgM3,
        materialSource, mhrRates, batchSize, comparisonWarnings, locInfo, location,
        inspection,
      ));
    }
    if (family === 'unknown') {
      return {
        bomItemId: id, batchSize, materialCost: 0,
        materialGrade: grade ?? '', grossWeightKg: 0,
        materialCostPerKg: 0, materialSource,
        currency: locInfo.code, currencySymbol: locInfo.symbol,
        routes: [{
          routeId: 'cnc-3ax' as const,
          routeLabel: 'Upload 3D Model for Routing',
          processLines: [],
          materialCost: 0,
          abrasiveCost: 0,
          totalProcessCost: 0,
          totalCost: 0,
          cycleTimes: { cuttingMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: 0 },
          badges: { lowestCost: false, fastest: false, bestQuality: false },
          capability: {
            cuttingCapable: false, pressBrakeCapable: false, overallCapable: false,
            confidence: 'low' as const, estimatedTonnage: null,
            reasonCodes: [], warnings: ['No 3D model analysed'],
          },
          warnings: ['Upload a 3D model to generate accurate process routes and cost estimates.'],
          ratesSource: 'none',
        }],
        comparisonWarnings: ['No 3D model analysed — upload a STEP/STL file for accurate routing.'],
      };
    }
    if (family === 'injection_molded') {
      // Phase 1: single route, no multi-tonnage-class comparison yet (see plan
      // doc §8/Roadmap) — the "comparison" is just the one costed route,
      // mirroring the 'unknown' family's single-entry shape above.
      const imBboxRC = [
        ((item as any).maxLength ?? 0) as number,
        ((item as any).maxWidth ?? 0) as number,
        ((item as any).maxHeight ?? 0) as number,
      ].sort((a, b) => b - a);
      const machineSpecRC = lookupSeedCapability(mhrRates.injectionMolding.machineName);
      const imInput: InjectionMoldingCostInput = {
        volume: (item.volume ?? 0) as number,
        surfaceArea: (item.surfaceArea ?? 0) as number,
        wallThicknessNominalMm: (summary.wallThicknessNominalMm ?? 0) as number,
        materialGrade: grade,
        materialCostPerKg,
        materialDensityKgM3,
        materialSource,
        batchSize,
        family,
        mhrRate: mhrRates.injectionMolding,
        deburrRate: mhrRates.deburring,
        inspectionRate: mhrRates.inspection,
        clampTonnageKN: machineSpecRC?.maxTonnage != null ? machineSpecRC.maxTonnage * 10 : undefined,
        shotCapacityCm3: machineSpecRC?.maxTonnage != null ? machineSpecRC.maxTonnage * 0.9 : undefined,
        annualVolume: ((item as any).annualVolume as number | null | undefined) ?? undefined,
        productionLifeYears: 5,
        bboxMaxMm: imBboxRC[0],
        bboxMidMm: imBboxRC[1],
        signals: {
          projectedAreaMm2: imBboxRC[0] * imBboxRC[1] > 0 ? imBboxRC[0] * imBboxRC[1] : null,
          wallThicknessMinMm: (summary.wallThicknessMinMm as number) > 0 ? (summary.wallThicknessMinMm as number) : null,
          wallThicknessMaxMm: (summary.wallThicknessMaxMm as number) > 0 ? (summary.wallThicknessMaxMm as number) : null,
          // Phase 4: use real rib count (antiparallel wall-face pairs); fall back to
          // pocket-floor proxy when CAD engine is pre-Phase 4.
          ribCount: (summary.ribCount as number) > 0
            ? (summary.ribCount as number)
            : (summary.ribCountProxy as number) > 0 ? (summary.ribCountProxy as number) : null,
          // Phase 4: bosses = blind cylindrical features (capped), NOT all cylinders.
          // holeOrBossCount lumps through-holes and bosses; blindFeatureCount is cap-detected.
          bossCount: (summary.blindFeatureCount as number) > 0 ? (summary.blindFeatureCount as number) : null,
          undercutCount: (summary.undercutFaceCount as number) > 0 ? (summary.undercutFaceCount as number) : null,
          partingComplexity: (summary.partingComplexity as number | null) ?? null,
          insertCount: (summary.insertCandidateCount as number) > 0 ? (summary.insertCandidateCount as number) : null,
        },
      };
      const cost = computeInjectionMoldedCostSummary(imInput);
      cost.warnings.push(...comparisonWarnings);
      const route: RouteResultDto = {
        routeId: 'injection-molding',
        routeLabel: 'Injection Molding',
        processLines: cost.processLines,
        materialCost: cost.materialCost,
        abrasiveCost: 0,
        totalProcessCost: cost.totalProcessCost,
        totalCost: cost.totalCost,
        cycleTimes: {
          cuttingMin:    cost.cycleTimes.laserMin,
          pressBrakeMin: cost.cycleTimes.pressBrakeMin,
          tappingMin:    cost.cycleTimes.tappingMin,
          deburrMin:     cost.cycleTimes.deburrMin,
          totalMin:      cost.cycleTimes.totalMin,
        },
        badges: { lowestCost: true, fastest: true, bestQuality: true },
        capability: {
          cuttingCapable: true,
          pressBrakeCapable: true,
          overallCapable: true,
          confidence: 'medium',
          estimatedTonnage: null,
          reasonCodes: [],
          warnings: [],
        },
        warnings: cost.warnings,
        ratesSource: cost.ratesSource,
        sustainability: cost.sustainability
          ? {
              totalCo2Kg:            cost.sustainability.totalCo2Kg,
              totalProcessEnergyKwh: cost.sustainability.totalProcessEnergyKwh,
              wasteCostInr:          cost.sustainability.wasteCostInr,
              sustainabilityScore:   cost.sustainability.sustainabilityScore,
            }
          : undefined,
      };
      return attachToRoutes({
        bomItemId: id, batchSize,
        materialCost: cost.materialCost,
        materialGrade: grade ?? '',
        grossWeightKg: cost.grossWeightKg,
        materialCostPerKg,
        materialSource,
        currency: locInfo.code, currencySymbol: locInfo.symbol,
        routes: [route],
        comparisonWarnings,
      });
    }

    if (family !== 'sheet_metal') {
      return {
        bomItemId: id, batchSize, materialCost: 0,
        materialGrade: grade ?? '', grossWeightKg: 0,
        materialCostPerKg: 0, materialSource,
        currency: locInfo.code, currencySymbol: locInfo.symbol,
        routes: [],
        comparisonWarnings: [`Route comparison not available for part family: ${family}`],
      };
    }

    // Sheet metal warnings (only relevant for sheet metal path)
    if (flatPatternAreaMm2 === 0) comparisonWarnings.push('Flat pattern area is 0 — material cost may be inaccurate');
    if (sheetThicknessMm === 0) comparisonWarnings.push('Sheet thickness is 0 — cutting speed lookup defaulting to 2.0 mm');

    // ── Capability checks ──────────────────────────────────────────────────────
    const pbCapability       = checkMachineCapability(mhrRates.pressBrake.machineClass, mhrRates.pressBrake.commodityCode, capabilityGeometry);
    const laserCapability    = checkMachineCapability(mhrRates.laser.machineClass,      mhrRates.laser.commodityCode,      capabilityGeometry);
    const turretCapability   = checkMachineCapability(mhrRates.turret.machineClass,     mhrRates.turret.commodityCode,     capabilityGeometry);
    const waterjetCapability = checkMachineCapability(mhrRates.waterjet.machineClass,   mhrRates.waterjet.commodityCode,   capabilityGeometry);

    const CONF_RANK = { high: 2, medium: 1, low: 0 } as const;
    const minConf = (a: "high" | "medium" | "low", b: "high" | "medium" | "low"): "high" | "medium" | "low" =>
      CONF_RANK[a] <= CONF_RANK[b] ? a : b;

    const laserRouteCapability: RouteCapability = {
      cuttingCapable:    laserCapability.capable,
      pressBrakeCapable: pbCapability.capable,
      overallCapable:    laserCapability.capable && pbCapability.capable,
      confidence:        minConf(laserCapability.confidence, pbCapability.confidence),
      estimatedTonnage:  pbCapability.estimatedTonnage,
      reasonCodes:       [...laserCapability.reasonCodes, ...pbCapability.reasonCodes],
      warnings:          [...laserCapability.reasons, ...pbCapability.reasons],
    };
    const turretRouteCapability: RouteCapability = {
      cuttingCapable:    turretCapability.capable,
      pressBrakeCapable: pbCapability.capable,
      overallCapable:    turretCapability.capable && pbCapability.capable,
      confidence:        minConf(turretCapability.confidence, pbCapability.confidence),
      estimatedTonnage:  pbCapability.estimatedTonnage,
      reasonCodes:       [...turretCapability.reasonCodes, ...pbCapability.reasonCodes],
      warnings:          [...turretCapability.reasons, ...pbCapability.reasons],
    };
    const waterjetRouteCapability: RouteCapability = {
      cuttingCapable:    waterjetCapability.capable,
      pressBrakeCapable: pbCapability.capable,
      overallCapable:    waterjetCapability.capable && pbCapability.capable,
      confidence:        minConf(waterjetCapability.confidence, pbCapability.confidence),
      estimatedTonnage:  pbCapability.estimatedTonnage,
      reasonCodes:       [...waterjetCapability.reasonCodes, ...pbCapability.reasonCodes],
      warnings:          [...waterjetCapability.reasons, ...pbCapability.reasons],
    };

    // ── Shared process lines (computed once, reused across all three routes) ───

    const pbLines: ProcessLineCost[] = [];
    let pressBrakeMin = 0;
    if (bendCount > 0) {
      const secPerBend = PRESS_BRAKE_SEC_PER_BEND[this.nearestKey(thk, PRESS_BRAKE_SEC_PER_BEND)] ?? 15;
      const totalPBSec = bendCount * secPerBend;
      pressBrakeMin = totalPBSec / 60;
      const pbRate = mhrRates.pressBrake;
      const setupCost = this.r2((PRESS_BRAKE_SETUP_MIN / 60) * pbRate.rate / Math.max(batchSize, 1));
      const runCost   = this.r2((totalPBSec / 3600) * pbRate.rate);
      pbLines.push({
        process: 'Press Brake',
        setupCost, runCost, totalCost: this.r2(setupCost + runCost),
        cycleTimeMin: this.r2(pressBrakeMin),
        hourlyRate: pbRate.rate, rateSource: pbRate.source,
        machineClass: pbRate.machineClass, machineName: pbRate.machineName, commodityCode: pbRate.commodityCode,
      });
    }

    const deburrLines: ProcessLineCost[] = [];
    let deburrMin = 0;
    if (cutLengthMm > 0) {
      const deburrSec = (cutLengthMm / 1000) * DEBURR_SEC_PER_METRE + pierceCount * DEBURR_SEC_PER_PIERCE;
      deburrMin = deburrSec / 60;
      const deburrRate = mhrRates.deburring;
      const runCost = this.r2((deburrSec / 3600) * deburrRate.rate);
      deburrLines.push({
        process: 'Deburring',
        setupCost: 0, runCost, totalCost: runCost,
        cycleTimeMin: this.r2(deburrMin),
        hourlyRate: deburrRate.rate, rateSource: deburrRate.source,
        machineClass: deburrRate.machineClass, machineName: deburrRate.machineName, commodityCode: deburrRate.commodityCode,
      });
    }

    const tappingLines: ProcessLineCost[] = [];
    let tappingMin = 0;
    if (threads.length > 0) {
      const totalSec = threads.reduce((s, t) => s + t.count * (TAP_CYCLE_SEC[t.size] ?? 10), 0);
      tappingMin = totalSec / 60;
      const tappingRate = mhrRates.tapping;
      const setupCost = this.r2((TAPPING_SETUP_MIN / 60) * tappingRate.rate / Math.max(batchSize, 1));
      const runCost   = this.r2((totalSec / 3600) * tappingRate.rate);
      tappingLines.push({
        process: 'Tapping',
        setupCost, runCost, totalCost: this.r2(setupCost + runCost),
        cycleTimeMin: this.r2(tappingMin),
        hourlyRate: tappingRate.rate, rateSource: tappingRate.source,
        machineClass: tappingRate.machineClass, machineName: tappingRate.machineName, commodityCode: tappingRate.commodityCode,
      });
    }

    // ── Cutting lines per route ────────────────────────────────────────────────

    // Laser — inline replication of cost-engine.ts laser block
    const laserLines: ProcessLineCost[] = [];
    let laserCuttingMin = 0;
    const laserWarnings: string[] = [];
    if (cutLengthMm > 0 || pierceCount > 0) {
      const speedKey    = this.nearestKey(thk, LASER_SPEED_MM_PER_MIN);
      const pierceKey   = this.nearestKey(thk, LASER_PIERCE_SEC);
      // Mild-steel baseline table × material derate — must match cost-engine.ts
      const speedMmPerMin = (LASER_SPEED_MM_PER_MIN[speedKey] ?? 3000) * laserSpeedFactor(grade);
      const pierceSec   = LASER_PIERCE_SEC[pierceKey] ?? 1.5;
      const cuttingSec  = cutLengthMm > 0 ? (cutLengthMm / speedMmPerMin) * 60 : 0;
      const piercingTotalSec = pierceCount * pierceSec;
      const totalLaserSec = cuttingSec + piercingTotalSec;
      laserCuttingMin = totalLaserSec / 60;
      const laserRate = mhrRates.laser;
      const setupCost = this.r2((LASER_SETUP_MIN / 60) * laserRate.rate / Math.max(batchSize, 1));
      const runCost   = this.r2((totalLaserSec / 3600) * laserRate.rate);
      laserLines.push({
        process: 'Laser Cutting',
        setupCost, runCost, totalCost: this.r2(setupCost + runCost),
        cycleTimeMin: this.r2(laserCuttingMin),
        hourlyRate: laserRate.rate, rateSource: laserRate.source,
        machineClass: laserRate.machineClass, machineName: laserRate.machineName, commodityCode: laserRate.commodityCode,
      });
    }

    // Turret punch
    const turretResult = computeTurretPunchCost({
      sheetThicknessMm, pierceCount, holeCount, cutLengthMm, batchSize,
      turretRate: mhrRates.turret,
    });

    // Waterjet — abrasive priced from the location consumable benchmark (local
    // currency, like MHR records), never the India INR rate on a non-INR quote.
    const waterjetResult = computeWaterjetCost({
      sheetThicknessMm, cutLengthMm, pierceCount, batchSize,
      waterjetRate: mhrRates.waterjet,
      abrasivePricePerKg:
        LOCATION_ABRASIVE_PRICE_PER_KG[location] ?? LOCATION_ABRASIVE_PRICE_PER_KG['Other'],
    });

    // ── Assemble RouteResultDto ────────────────────────────────────────────────
    const assembleRoute = (
      routeId: RouteId,
      routeLabel: string,
      cuttingLines: ProcessLineCost[],
      cuttingMin: number,
      abrasiveCost: number,
      routeWarnings: string[],
      capability: RouteCapability,
    ): RouteResultDto => {
      const allLines = [...cuttingLines, ...pbLines, ...deburrLines, ...tappingLines];
      const totalProcessCost = this.r2(allLines.reduce((s, l) => s + l.totalCost, 0) + abrasiveCost);
      const totalCost = this.r2(materialCost + totalProcessCost);
      const { totalCo2Kg, totalProcessEnergyKwh, wasteCostInr, sustainabilityScore } =
        computeSustainability(grade, materialCostPerKg, netWeightKg, grossWeightKg, batchSize, allLines);
      return {
        routeId, routeLabel,
        processLines: allLines,
        materialCost, abrasiveCost, totalProcessCost, totalCost,
        cycleTimes: {
          cuttingMin: this.r2(cuttingMin),
          pressBrakeMin: this.r2(pressBrakeMin),
          tappingMin: this.r2(tappingMin),
          deburrMin: this.r2(deburrMin),
          totalMin: this.r2(cuttingMin + pressBrakeMin + deburrMin + tappingMin),
        },
        badges: { lowestCost: false, fastest: false, bestQuality: false },
        capability,
        warnings: routeWarnings,
        ratesSource: RATES_SOURCE_LABEL,
        sustainability: { totalCo2Kg, totalProcessEnergyKwh, wasteCostInr, sustainabilityScore },
      };
    };

    const routes: RouteResultDto[] = [
      assembleRoute('sm-laser',   'Fiber Laser + Press Brake',
        laserLines,               laserCuttingMin,             0,                           laserWarnings,         laserRouteCapability),
      assembleRoute('sm-turret',  'Turret Punch + Press Brake',
        turretResult.processLines, turretResult.cuttingMin,    0,                           turretResult.warnings, turretRouteCapability),
      assembleRoute('sm-waterjet','Waterjet + Press Brake',
        waterjetResult.processLines, waterjetResult.cuttingMin, waterjetResult.abrasiveCost, waterjetResult.warnings, waterjetRouteCapability),
    ];

    // ── Badges — only assigned among capable routes ────────────────────────────
    const capableRoutes = routes.filter((r) => r.capability.overallCapable);

    if (capableRoutes.length > 0) {
      const minCost = Math.min(...capableRoutes.map((r) => r.totalCost));
      routes.forEach((r) => {
        r.badges.lowestCost = r.capability.overallCapable && r.totalCost === minCost;
      });

      const minTime = Math.min(...capableRoutes.map((r) => r.cycleTimes.totalMin));
      routes.forEach((r) => {
        r.badges.fastest = r.capability.overallCapable && r.cycleTimes.totalMin === minTime;
      });

      const gUpper = (grade ?? "").toUpperCase();
      const heatSensitive = ["STAINLESS", "SS3", "SS4", "INCONEL", "TITANIUM", "SPRING", "HARDENED", "HARDOX"]
        .some((m) => gUpper.includes(m));
      const bestQualityId: RouteId = heatSensitive || thk > 8 ? "sm-waterjet" : "sm-laser";
      routes.forEach((r) => {
        r.badges.bestQuality = r.routeId === bestQualityId && r.capability.overallCapable;
      });
    }
    // If capableRoutes is empty — all badges remain false (suppressed)

    return attachToRoutes({
      bomItemId: id,
      batchSize,
      materialCost,
      materialGrade: grade ?? 'Unknown',
      grossWeightKg: Math.round(grossWeightKg * 1000) / 1000,
      materialCostPerKg,
      materialSource,
      routes,
      comparisonWarnings,
      currency: locInfo.code,
      currencySymbol: locInfo.symbol,
    });
  }

  async getGdtAnalysis(id: string, accessToken: string): Promise<GdtAnalysisDto> {
    const client = this.supabaseService.getClient(accessToken);
    const { data: rows, error } = await client
      .from("bom_items")
      .select("id, drawing_intelligence")
      .eq("id", id)
      .limit(1);
    if (error) throw new NotFoundException(`BOM item ${id} not found`);
    const item = Array.isArray(rows) ? rows[0] : rows;
    if (!item) throw new NotFoundException(`BOM item ${id} not found`);

    const di = (item as any).drawing_intelligence as Record<string, any> | null;
    const rawCallouts: any[] = di?.gdt_callouts ?? [];
    const generalTolerance: string | null = di?.general_tolerances ?? null;

    const INSPECTION_PRIORITY: InspectionMethod[] = ["cmm", "height_gauge", "caliper", "visual"];

    if (rawCallouts.length === 0) {
      return {
        bomItemId: id,
        source: "no_data",
        features: [],
        overallSeverity: null,
        maxCostImpactPercent: 0,
        maxCostImpactRange: "none",
        inspectionMethods: [],
        recommendedInspectionMethod: null,
        totalInspectionTimeMin: 0,
        analysisConfidence: 0,
        generalTolerance,
      };
    }

    // DB-backed rule bands (inspection_rules) with the code matrix as fallback —
    // the same resolution the cost engine's inspection line uses.
    const inspectionRules = await this.inspectionKnowledge.getInspectionRules(accessToken);
    const features: GdtFeatureDto[] = rawCallouts.map((c) => {
      const derived = resolveInspectionRule(inspectionRules, c.type ?? "", c.tolerance ?? 0);
      return {
        type: (c.type ?? "unknown").trim().toLowerCase(),
        toleranceMm: c.tolerance ?? 0,
        datum: c.datum ?? "",
        confidence: typeof c.confidence === "number" ? c.confidence : null,
        ...derived,
      };
    });

    const overallSeverity = features.reduce<GdtSeverity>(
      (best, f) => SEVERITY_RANK[f.severity] > SEVERITY_RANK[best] ? f.severity : best,
      "low",
    );

    const maxFeature = features.reduce((a, b) =>
      a.costImpactPercent >= b.costImpactPercent ? a : b,
    );

    const methodSet = new Set(features.map((f) => f.inspectionMethod));
    const inspectionMethods = INSPECTION_PRIORITY.filter((m) => methodSet.has(m));
    const recommendedInspectionMethod = inspectionMethods[0] ?? null;

    const totalInspectionTimeMin = features.reduce((s, f) => s + f.inspectionTimeMin, 0);

    const withConfidence = features.filter((f) => f.confidence !== null);
    const analysisConfidence =
      withConfidence.length > 0
        ? withConfidence.reduce((s, f) => s + (f.confidence as number), 0) / withConfidence.length
        : 0;

    return {
      bomItemId: id,
      source: "drawing_intelligence",
      features,
      overallSeverity,
      maxCostImpactPercent: maxFeature.costImpactPercent,
      maxCostImpactRange: maxFeature.costImpactRange,
      inspectionMethods,
      recommendedInspectionMethod,
      totalInspectionTimeMin,
      analysisConfidence: Math.round(analysisConfidence * 100) / 100,
      generalTolerance,
    };
  }

  private resolveThreads(
    drawingThreads: Array<{ size: string; count: number }>,
    fg: any,
  ): Array<{ size: string; count: number }> {
    if (drawingThreads.length > 0) return this.normalizeThreadSpecs(drawingThreads);
    // Drawing not yet analyzed — synthesize from geometry-detected tapped holes
    const cncFeatures = (fg?.cnc_features?.features ?? []) as Array<{ type: string; params: any }>;
    const tapped = cncFeatures.filter((f) => f.type === 'tapped_hole');
    if (tapped.length === 0) return [];
    const specCounts: Record<string, number> = {};
    for (const f of tapped) {
      const spec: string = f.params?.spec ?? 'M3';
      specCounts[spec] = (specCounts[spec] ?? 0) + 1;
    }
    return this.normalizeThreadSpecs(
      Object.entries(specCounts).map(([size, count]) => ({ size, count })),
    );
  }

  // "M4×0.7" / "M4x0.7 - 6H" → "M4" so TAP_CYCLE_SEC lookups hit the size key
  // instead of silently falling back to the 10 s default. Merges duplicate sizes.
  private normalizeThreadSpecs(
    threads: Array<{ size: string; count: number }>,
  ): Array<{ size: string; count: number }> {
    const counts: Record<string, number> = {};
    for (const t of threads) {
      const raw = String(t.size ?? '').trim().toUpperCase();
      const metric = raw.match(/^M\s*(\d+(?:\.\d+)?)/);
      const key = metric ? `M${metric[1]}` : (raw || 'M3');
      const count = Number(t.count) || 0;
      if (count <= 0) continue;
      counts[key] = (counts[key] ?? 0) + count;
    }
    return Object.entries(counts).map(([size, count]) => ({ size, count }));
  }

  // GD&T callouts from drawing intelligence → per-feature inspection-time input.
  // When inspection_rules rows are supplied, per-callout time comes from the DB
  // rule bands; the code matrix in gdt-severity.ts remains the fallback.
  private extractGdtFeatures(
    item: any,
    rules: InspectionRuleRow[] = [],
  ): Array<{ symbol: string; tolerance: number; timeMin?: number }> {
    const callouts = ((item?.drawingIntelligence as any)?.gdt_callouts ?? []) as any[];
    return callouts
      .filter((c) => c && typeof c.tolerance === 'number' && c.tolerance > 0)
      .map((c) => {
        const symbol = String(c.type ?? '');
        const tolerance = Number(c.tolerance);
        return {
          symbol,
          tolerance,
          timeMin: rules.length > 0
            ? resolveInspectionRule(rules, symbol, tolerance).inspectionTimeMin
            : undefined,
        };
      });
  }

  // Per-item inspection sampling override: bom_items.validation_config.inspection.samplePerN
  private resolveSamplingPerN(item: any): number | undefined {
    const v = Number((item?.validationConfig as any)?.inspection?.samplePerN);
    return Number.isFinite(v) && v >= 1 ? Math.floor(v) : undefined;
  }

  // Named quality plan (DB quality_plans row) selected per item via
  // bom_items.validation_config.inspection.qualityPlan; null → code default.
  private async resolveSamplingPolicy(
    item: any,
    accessToken: string,
  ): Promise<InspectionStagePolicy | undefined> {
    const planKey = (item?.validationConfig as any)?.inspection?.qualityPlan;
    if (typeof planKey !== 'string' || !planKey.trim()) return undefined;
    return (await this.inspectionKnowledge.getQualityPlan(accessToken, planKey.trim())) ?? undefined;
  }

  // Surface treatment: drawing intelligence key, falling back to the promoted coating column
  private resolveSurfaceTreatment(item: any): string | null {
    return (
      ((item?.drawingIntelligence as any)?.surface_treatment as string | undefined) ??
      (item?.coating as string | undefined) ??
      null
    );
  }

  private buildCNCMilledRoutes(
    id: string,
    item: any,
    fg: any,
    summary: any,
    grade: string | null,
    materialCostPerKg: number,
    materialDensityKgM3: number,
    materialSource: 'db' | 'default',
    mhrRates: Awaited<ReturnType<typeof this.resolveMHRRates>>,
    batchSize: number,
    comparisonWarnings: string[],
    locInfo: (typeof LOCATION_INFO)[string] = LOCATION_INFO[DEFAULT_COSTING_LOCATION],
    location: string = DEFAULT_COSTING_LOCATION,
    inspection?: { rules: InspectionRuleRow[]; policy?: InspectionStagePolicy },
  ): RouteComparisonDto {
    const holeCount = (summary.holeCount ?? item.holeCount ?? 0) as number;
    const threads = ((item.drawingIntelligence as any)?.threads ?? []) as Array<{ size: string; count: number }>;
    const maxLength = ((item as any).maxLength ?? 0) as number;
    const maxWidth  = ((item as any).maxWidth  ?? 0) as number;
    const maxHeight = ((item as any).maxHeight ?? 0) as number;
    const finishedWeightKg = ((item as any).weight ?? 0) as number;

    const baseInput: Omit<CNCCostInput, 'mhrRate' | 'tappingRate'> = {
      volume:               (item.volume ?? 0) as number,
      surfaceArea:          (item.surfaceArea ?? 0) as number,
      maxLength, maxWidth, maxHeight,
      holeCount,
      holeGroups:           (summary.holeGroups ?? []) as Array<{ diameter_mm: number; count: number }>,
      pocketCount:          (fg?.cnc_features?.feature_summary?.pockets ?? 0) as number,
      materialGrade:        grade,
      materialCostPerKg,
      materialDensityKgM3,
      materialSource,
      // Same thread resolution as getCostSummary — geometry-synthesized threads
      // when the drawing is not analysed; totals must match line for line.
      threads: this.resolveThreads(threads, fg),
      tightestToleranceMm:  ((item as any).tightestToleranceMm ?? null) as number | null,
      gdtFeatureCount:      (fg?.cnc_features?.feature_summary?.gdt_features ?? 0) as number,
      batchSize,
      family:               'cnc_milled',
      finishedWeightKg,
      deburrRate:           mhrRates.deburring,
      inspectionRate:       mhrRates.inspection,
      surfaceTreatment:     this.resolveSurfaceTreatment(item),
      samplingPerN:         this.resolveSamplingPerN(item),
      samplingPolicy:       inspection?.policy,
      gdtFeatures:          this.extractGdtFeatures(item, inspection?.rules ?? []),
      location,
    };

    const milledMachineClasses: CNCMachineClass[] = ['cnc_3ax_vmc', 'cnc_4ax_vmc', 'cnc_5ax_mc'];
    const milledRouteIds: RouteId[] = ['cnc-3ax', 'cnc-4ax', 'cnc-5ax'];
    const milledRouteLabels = ['3-Axis VMC', '4-Axis VMC', '5-Axis MC'];
    const milledMhrKeys = ['cnc3ax', 'cnc4ax', 'cnc5ax'] as const;

    const pocketCount = (fg?.cnc_features?.feature_summary?.pockets ?? 0) as number;
    // Same feature gate the cost summary uses — a route below the class the
    // part's features demand must not win the lowest-cost badge.
    const requiredClass = requiredMilledMachineClass(fg?.difficultyLevel as string | null, pocketCount);

    const threadCount = baseInput.threads.reduce((s, t) => s + t.count, 0);

    const routes: RouteResultDto[] = milledMachineClasses.map((mc, i) => {
      const routeRate = mhrRates[milledMhrKeys[i]];
      const cost = computeCNCMilledCostSummary(
        { ...baseInput, mhrRate: routeRate, tappingRate: this.inheritCncTappingRate(mhrRates.tapping, routeRate) },
        mc,
      );
      const envelope = checkCNCCapability(mc, maxLength, maxWidth, maxHeight, finishedWeightKg);
      const meetsClass = meetsRequiredMilledClass(mc, requiredClass);
      const capabilityWarnings = [...envelope.machineCapabilityWarnings];
      if (!meetsClass) {
        capabilityWarnings.push(
          `Part complexity requires ${requiredClass.replace(/_/g, ' ')} or higher — this route cannot produce all features in economic cycle times.`,
        );
      }
      const overallCapable = envelope.overallCapable && meetsClass;
      const routeSetups = cost.setupCount ?? 1;
      return {
        routeId: milledRouteIds[i],
        routeLabel: milledRouteLabels[i],
        processLines: cost.processLines,
        materialCost: cost.materialCost,
        abrasiveCost: 0,
        totalProcessCost: cost.totalProcessCost,
        totalCost: cost.totalCost,
        cycleTimes: {
          cuttingMin:    cost.cycleTimes.laserMin,
          pressBrakeMin: cost.cycleTimes.pressBrakeMin,
          tappingMin:    cost.cycleTimes.tappingMin,
          deburrMin:     cost.cycleTimes.deburrMin,
          totalMin:      cost.cycleTimes.totalMin,
        },
        badges: { lowestCost: false, fastest: false, bestQuality: false },
        capability: {
          cuttingCapable:    envelope.overallCapable,
          pressBrakeCapable: true,
          overallCapable,
          confidence:        overallCapable ? 'high' : 'low',
          estimatedTonnage:  null,
          reasonCodes:       [],
          warnings:          capabilityWarnings,
        },
        warnings: cost.warnings,
        ratesSource: cost.ratesSource,
        sustainability: cost.sustainability
          ? {
              totalCo2Kg:            cost.sustainability.totalCo2Kg,
              totalProcessEnergyKwh: cost.sustainability.totalProcessEnergyKwh,
              wasteCostInr:          cost.sustainability.wasteCostInr,
              sustainabilityScore:   cost.sustainability.sustainabilityScore,
            }
          : undefined,
        setupCount:                routeSetups,
        machineCapabilityWarnings: capabilityWarnings,
        routeComplexityScore:      computeRouteComplexityScore(
          holeCount, pocketCount, threadCount, routeSetups, baseInput.gdtFeatureCount,
        ),
      };
    });

    // Badges — only among capable routes. The lowest-cost capable route here is
    // by construction the route getCostSummary quotes on (same pick function).
    const capable = routes.filter((r) => r.capability.overallCapable);
    if (capable.length > 0) {
      const recommended = pickRecommendedRoute(
        routes.map((r) => ({ route: r, totalCost: r.totalCost, capable: r.capability.overallCapable, setupCount: r.setupCount ?? 99 })),
      ).route;
      routes.forEach((r) => { r.badges.lowestCost = r.routeId === recommended.routeId; });

      // Fastest: many pockets → 5-axis (no repositioning); otherwise 3-axis
      const fastestId: RouteId = pocketCount > 5 ? 'cnc-5ax' : 'cnc-3ax';
      routes.forEach((r) => { r.badges.fastest = r.routeId === fastestId && r.capability.overallCapable; });

      // Best quality: fewest setups among capable routes (minimum repositioning error)
      const minSetups = Math.min(...capable.map((r) => r.setupCount ?? 99));
      routes.forEach((r) => { r.badges.bestQuality = r.capability.overallCapable && (r.setupCount ?? 99) === minSetups; });
    }

    const billetWeightKg = (routes[0]?.materialCost ?? 0) / Math.max(materialCostPerKg, 1);
    return {
      bomItemId: id, batchSize,
      materialCost: routes[0]?.materialCost ?? 0,
      materialGrade: grade ?? 'Unknown',
      grossWeightKg: Math.round(billetWeightKg * 1000) / 1000,
      materialCostPerKg, materialSource,
      routes, comparisonWarnings,
      currency: locInfo.code,
      currencySymbol: locInfo.symbol,
    };
  }

  private buildCNCTurnedRoutes(
    id: string,
    item: any,
    fg: any,
    summary: any,
    grade: string | null,
    materialCostPerKg: number,
    materialDensityKgM3: number,
    materialSource: 'db' | 'default',
    mhrRates: Awaited<ReturnType<typeof this.resolveMHRRates>>,
    batchSize: number,
    comparisonWarnings: string[],
    locInfo: (typeof LOCATION_INFO)[string] = LOCATION_INFO[DEFAULT_COSTING_LOCATION],
    location: string = DEFAULT_COSTING_LOCATION,
    inspection?: { rules: InspectionRuleRow[]; policy?: InspectionStagePolicy },
  ): RouteComparisonDto {
    const holeCount = (summary.holeCount ?? item.holeCount ?? 0) as number;
    const drawingThreads = ((item.drawingIntelligence as any)?.threads ?? []) as Array<{ size: string; count: number }>;
    const maxLength = ((item as any).maxLength ?? 0) as number;
    const maxWidth  = ((item as any).maxWidth  ?? 0) as number;
    const maxHeight = ((item as any).maxHeight ?? 0) as number;
    const finishedWeightKg = ((item as any).weight ?? 0) as number;

    const baseInput: Omit<CNCCostInput, 'mhrRate' | 'tappingRate'> = {
      volume:               (item.volume ?? 0) as number,
      surfaceArea:          (item.surfaceArea ?? 0) as number,
      maxLength, maxWidth, maxHeight,
      holeCount,
      holeGroups:           (summary.holeGroups ?? []) as Array<{ diameter_mm: number; count: number }>,
      pocketCount:          0,
      materialGrade:        grade,
      materialCostPerKg,
      materialDensityKgM3,
      materialSource,
      threads: this.resolveThreads(drawingThreads, fg),
      tightestToleranceMm:  ((item as any).tightestToleranceMm ?? null) as number | null,
      gdtFeatureCount:      (fg?.cnc_features?.feature_summary?.gdt_features ?? 0) as number,
      batchSize,
      family:               'cnc_turned',
      finishedWeightKg,
      deburrRate:           mhrRates.deburring,
      inspectionRate:       mhrRates.inspection,
      surfaceTreatment:     this.resolveSurfaceTreatment(item),
      samplingPerN:         this.resolveSamplingPerN(item),
      samplingPolicy:       inspection?.policy,
      gdtFeatures:          this.extractGdtFeatures(item, inspection?.rules ?? []),
      location,
    };

    const machineClasses: CNCMachineClass[] = ['cnc_lathe', 'cnc_lathe_live', 'cnc_mill_turn'];
    const routeIds: RouteId[] = ['cnc-lathe', 'cnc-lathe-lt', 'cnc-mill-turn'];
    const routeLabels = ['CNC Lathe (2-Axis)', 'Lathe + Live Tooling', 'Mill-Turn'];
    const mhrKeys = ['cncLathe', 'cncLatheLive', 'cncMillTurn'] as const;

    const threadCount = baseInput.threads.reduce((s, t) => s + t.count, 0);

    const routes: RouteResultDto[] = machineClasses.map((mc, i) => {
      const routeRate = mhrRates[mhrKeys[i]];
      const cost = computeCNCTurnedCostSummary(
        { ...baseInput, mhrRate: routeRate, tappingRate: this.inheritCncTappingRate(mhrRates.tapping, routeRate) },
        mc,
      );
      const capability = checkCNCCapability(mc, maxLength, maxWidth, maxHeight, finishedWeightKg);
      const routeSetups = cost.setupCount ?? 1;
      return {
        routeId: routeIds[i],
        routeLabel: routeLabels[i],
        processLines: cost.processLines,
        materialCost: cost.materialCost,
        abrasiveCost: 0,
        totalProcessCost: cost.totalProcessCost,
        totalCost: cost.totalCost,
        cycleTimes: {
          cuttingMin:    cost.cycleTimes.laserMin,
          pressBrakeMin: cost.cycleTimes.pressBrakeMin,
          tappingMin:    cost.cycleTimes.tappingMin,
          deburrMin:     cost.cycleTimes.deburrMin,
          totalMin:      cost.cycleTimes.totalMin,
        },
        badges: { lowestCost: false, fastest: false, bestQuality: false },
        capability: {
          cuttingCapable:    capability.overallCapable,
          pressBrakeCapable: true,
          overallCapable:    capability.overallCapable,
          confidence:        capability.overallCapable ? 'high' : 'low',
          estimatedTonnage:  null,
          reasonCodes:       [],
          warnings:          capability.machineCapabilityWarnings,
        },
        warnings: cost.warnings,
        ratesSource: cost.ratesSource,
        sustainability: cost.sustainability
          ? {
              totalCo2Kg:            cost.sustainability.totalCo2Kg,
              totalProcessEnergyKwh: cost.sustainability.totalProcessEnergyKwh,
              wasteCostInr:          cost.sustainability.wasteCostInr,
              sustainabilityScore:   cost.sustainability.sustainabilityScore,
            }
          : undefined,
        setupCount:                routeSetups,
        machineCapabilityWarnings: capability.machineCapabilityWarnings,
        routeComplexityScore:      computeRouteComplexityScore(
          holeCount, 0, threadCount, routeSetups, baseInput.gdtFeatureCount,
        ),
      };
    });

    // Badges. Lowest cost is COMPUTED from route totals — a 2-axis lathe with a
    // per-part rechuck penalty is often costlier than live tooling, so the old
    // hardcoded "lathe = cheapest" badge could contradict the numbers next to it.
    // Same pick function as getCostSummary, so summary and badge always agree.
    const capable = routes.filter((r) => r.capability.overallCapable);
    if (capable.length > 0) {
      const recommended = pickRecommendedRoute(
        routes.map((r) => ({ route: r, totalCost: r.totalCost, capable: r.capability.overallCapable, setupCount: r.setupCount ?? 99 })),
      ).route;
      routes.forEach((r) => { r.badges.lowestCost = r.routeId === recommended.routeId; });
      routes.forEach((r) => { r.badges.fastest    = r.routeId === 'cnc-mill-turn' && r.capability.overallCapable; });
      // Best quality: fewest setups among capable routes
      const minSetups = Math.min(...capable.map((r) => r.setupCount ?? 99));
      routes.forEach((r) => { r.badges.bestQuality = r.capability.overallCapable && (r.setupCount ?? 99) === minSetups; });
    }

    const barWeightKg = (routes[0]?.materialCost ?? 0) / Math.max(materialCostPerKg, 1);
    return {
      bomItemId: id, batchSize,
      materialCost: routes[0]?.materialCost ?? 0,
      materialGrade: grade ?? 'Unknown',
      grossWeightKg: Math.round(barWeightKg * 1000) / 1000,
      materialCostPerKg, materialSource,
      routes, comparisonWarnings,
      currency: locInfo.code,
      currencySymbol: locInfo.symbol,
    };
  }

  private nearestKey(mm: number, table: Record<number, number>): number {
    const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
    let best = keys[0];
    for (const k of keys) {
      if (Math.abs(k - mm) < Math.abs(best - mm)) best = k;
    }
    return best;
  }

  private r2(n: number): number {
    return Math.round(n * 100) / 100;
  }
}