import { Injectable, Logger, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateBOMItemDto, UpdateBOMItemDto } from './dto/bom-items.dto';
import { BOMItemResponseDto, BOMItemListResponseDto } from './dto/bom-item-response.dto';
import { computeCostSummary, computeSustainability } from './costing/cost-engine';
import type { MHRRateInput } from './costing/cost-engine';
import { computeCNCMilledCostSummary, computeCNCTurnedCostSummary, computeMillTurnCostSummary, checkCNCCapability, computeRouteComplexityScore } from './costing/cost-cnc-engine';
import type { CNCCostInput, CNCMachineClass } from './costing/cost-cnc-engine';
import {
  MATERIAL_DEFAULTS, MATERIAL_OVERHEAD_PCT, RATES_SOURCE_LABEL,
  LASER_SETUP_MIN, LASER_SPEED_MM_PER_MIN, LASER_PIERCE_SEC,
  PRESS_BRAKE_SETUP_MIN, PRESS_BRAKE_SEC_PER_BEND,
  DEBURR_SEC_PER_METRE, DEBURR_SEC_PER_PIERCE,
  TAPPING_SETUP_MIN, TAP_CYCLE_SEC,
  MACHINE_REGISTRY, LOCATION_INFO, LOCATION_MHR_DEFAULTS,
} from './costing/default-rates';
import type { MachineClass } from './costing/default-rates';
import { computeTurretPunchCost } from './costing/turret-punch-engine';
import { computeWaterjetCost } from './costing/waterjet-engine';
import { checkMachineCapability } from './costing/machine-capability';
import type { PartGeometryForCapability } from './costing/machine-capability';
import type { CostSummaryDto, ProcessLineCost } from './dto/cost-breakdown.dto';
import type { RouteComparisonDto, RouteResultDto, RouteId, RouteCapability } from './dto/route-comparison.dto';
import { deriveGdtSeverity, SEVERITY_RANK } from './costing/gdt-severity';
import type { GdtSeverity, InspectionMethod } from './costing/gdt-severity';
import type { GdtAnalysisDto, GdtFeatureDto } from './dto/gdt-analysis.dto';

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
  });

  constructor(private readonly supabaseService: SupabaseService) { }

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

  private async resolveMHRRates(accessToken: string, location = 'India'): Promise<{
    laser: MHRRateInput;
    pressBrake: MHRRateInput;
    deburring: MHRRateInput;
    tapping: MHRRateInput;
    turret: MHRRateInput;
    waterjet: MHRRateInput;
    cnc3ax: MHRRateInput;
    cnc4ax: MHRRateInput;
    cnc5ax: MHRRateInput;
    cncLathe: MHRRateInput;
    cncLatheLive: MHRRateInput;
    cncMillTurn: MHRRateInput;
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
      'fiber_laser', 'press_brake', 'deburring', 'tapping', 'turret_punch', 'waterjet',
      'cnc_3ax_vmc', 'cnc_4ax_vmc', 'cnc_5ax_mc', 'cnc_lathe', 'cnc_lathe_live', 'cnc_mill_turn',
    ];

    const buildOutput = (resolved: Map<MachineClass, MHRRateInput>) => ({
      laser:        resolved.get('fiber_laser')    ?? makeDefault('fiber_laser'),
      pressBrake:   resolved.get('press_brake')    ?? makeDefault('press_brake'),
      deburring:    resolved.get('deburring')      ?? makeDefault('deburring'),
      tapping:      resolved.get('tapping')        ?? makeDefault('tapping'),
      turret:       resolved.get('turret_punch')   ?? makeDefault('turret_punch'),
      waterjet:     resolved.get('waterjet')       ?? makeDefault('waterjet'),
      cnc3ax:       resolved.get('cnc_3ax_vmc')    ?? makeDefault('cnc_3ax_vmc'),
      cnc4ax:       resolved.get('cnc_4ax_vmc')    ?? makeDefault('cnc_4ax_vmc'),
      cnc5ax:       resolved.get('cnc_5ax_mc')     ?? makeDefault('cnc_5ax_mc'),
      cncLathe:     resolved.get('cnc_lathe')      ?? makeDefault('cnc_lathe'),
      cncLatheLive: resolved.get('cnc_lathe_live') ?? makeDefault('cnc_lathe_live'),
      cncMillTurn:  resolved.get('cnc_mill_turn')  ?? makeDefault('cnc_mill_turn'),
    });

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
        // Build index: commodity_code → best (lowest) effective rate
        type Hit = { rate: number; machineName: string };
        const dbIndex = new Map<string, Hit>();
        for (const row of primaryData as any[]) {
          const rate = pickRate(row);
          if (rate <= 0) continue;
          const existing = dbIndex.get(row.commodity_code);
          if (!existing || rate < existing.rate) {
            dbIndex.set(row.commodity_code, { rate, machineName: row.machine_name });
          }
        }

        for (const cls of allClasses) {
          type Candidate = { code: string; hit: Hit };
          const candidates = (MACHINE_REGISTRY[cls].commodityCodes as readonly string[])
            .map((code) => ({ code, hit: dbIndex.get(code) }))
            .filter((c): c is Candidate => c.hit != null);

          if (candidates.length > 0) {
            const best = candidates.reduce((a, b) => (a.hit.rate <= b.hit.rate ? a : b));
            resolved.set(cls, {
              rate: best.hit.rate,
              source: 'mhr_database',
              machineClass: cls,
              machineName: best.hit.machineName,
              commodityCode: best.code,
            });
          }
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

              const mcMatch = MACHINE_REGISTRY[cls].machineClassKeywords.some((kw) =>
                mcLower.includes(kw.toLowerCase()),
              );
              const pgMatch = !mcMatch && MACHINE_REGISTRY[cls].processGroupKeywords.some((kw) =>
                pgLower.includes(kw.toLowerCase()),
              );

              if (!mcMatch && !pgMatch) continue;

              // Prevent cross-class contamination: lathes must not resolve VMC milling classes
              const isLatheRecord = /lathe|turning|sliding.head|sub.?spindle/i.test(mcLower + ' ' + pgLower);
              const isVMCClass = ['cnc_3ax_vmc', 'cnc_4ax_vmc', 'cnc_5ax_mc'].includes(cls as string);
              if (isVMCClass && isLatheRecord) continue;

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

  async getCostSummary(
    id: string,
    userId: string,
    accessToken: string,
    batchSize = 1,
    location = 'USA',
  ): Promise<CostSummaryDto> {
    const item = await this.findOne(id, userId, accessToken);

    const fg = item.featureGraph as any;
    const summary = fg?.summary ?? {};

    const sheetThicknessMm = (summary.sheetThicknessMm ?? item.sheetThicknessMm ?? 0) as number;
    const family: string =
      fg?.classification?.family ??
      item.familyClassification ??
      (sheetThicknessMm > 0 ? 'sheet_metal' : 'unknown');
    const cutLengthMm = (summary.cutLengthMm ?? item.cutLengthMm ?? 0) as number;
    const pierceCount = (summary.pierceCount ?? item.pierceCount ?? 0) as number;
    const bendCount = (summary.bendCount ?? item.bendCount ?? 0) as number;
    const flatPatternAreaMm2 = (summary.flatPatternAreaMm2 ?? item.flatPatternAreaMm2 ?? 0) as number;
    const holeCount = (summary.holeCount ?? item.holeCount ?? 0) as number;
    const threads = ((item.drawingIntelligence as any)?.threads ?? []) as Array<{ size: string; count: number }>;

    // Drawing analysis material always wins — it reads the title block directly.
    // Auto-fill material (from geometry heuristics) is a fallback only.
    const drawingGrade = ((item.drawingIntelligence as any)?.material ?? null) as string | null;
    const grade = (drawingGrade?.trim() || null) ?? item.materialGrade ?? item.material ?? null;

    const locInfo = LOCATION_INFO[location] ?? LOCATION_INFO['India'];
    const exchangeRates = await this.fetchExchangeRates(accessToken);
    const usdInrRate = exchangeRates.get('USD') ?? 83.5;
    const locInrRate = exchangeRates.get(locInfo.code) ?? locInfo.defaultInrRate;
    const toUsdRate = locInfo.code === 'USD' ? 1 : locInrRate / usdInrRate;
    const currencyMeta = { currency: locInfo.code, currencySymbol: locInfo.symbol, toUsdRate };

    let materialCostPerKg = MATERIAL_DEFAULTS.__default__.costPerKg;
    let materialDensityKgM3 = MATERIAL_DEFAULTS.__default__.densityKgM3;
    let materialSource: 'db' | 'default' = 'default';

    if (grade) {
      try {
        const client = this.supabaseService.getClient(accessToken);
        const g = grade.trim();
        const { data } = await client
          .from('raw_materials')
          .select(`${locInfo.materialCol}, cost_india, cost, density, density_kg_m3`)
          .or(`material_grade.ilike.%${g}%,material.ilike.%${g}%`)
          .limit(1)
          .maybeSingle();

        if (data) {
          const locCost: number | null = (data as any)[locInfo.materialCol] ?? null;
          const indiaCost: number | null = (data as any).cost_india ?? (data as any).cost ?? null;
          const costPerKg: number | null =
            locCost != null && locCost > 0
              ? locCost
              : indiaCost != null && indiaCost > 0
                ? indiaCost / locInrRate
                : null;
          const densityGCm3: number | null = (data as any).density ?? null;
          const densityKgM3: number | null = (data as any).density_kg_m3 ?? (densityGCm3 != null ? densityGCm3 * 1000 : null);
          if (costPerKg != null && costPerKg > 0 && densityKgM3 != null && densityKgM3 > 0) {
            materialCostPerKg = costPerKg;
            materialDensityKgM3 = densityKgM3;
            materialSource = 'db';
          }
        }
      } catch {
        // fall through to named defaults below
      }
    }

    if (materialSource === 'default') {
      const gradeUpper = (grade ?? '').toUpperCase();
      const fallbackKey =
        Object.keys(MATERIAL_DEFAULTS).find((k) => k !== '__default__' && gradeUpper.includes(k)) ??
        '__default__';
      const fallback = MATERIAL_DEFAULTS[fallbackKey];
      materialCostPerKg = fallback.costPerKg;
      materialDensityKgM3 = fallback.densityKgM3;
    }

    const mhrRates = await this.resolveMHRRates(accessToken, location);

    if (family === 'cnc_milled' || family === 'cnc_turned' || family === 'mill_turn') {
      // Pick machine class from part difficulty and feature complexity
      let milledMachineClass: CNCMachineClass = 'cnc_3ax_vmc';
      if (family === 'cnc_milled') {
        const diff = (fg?.difficultyLevel ?? 'medium') as string;
        const pockets = (fg?.cnc_features?.feature_summary?.pockets ?? 0) as number;
        if (diff === 'very_hard' || pockets > 25) milledMachineClass = 'cnc_5ax_mc';
        else if (diff === 'hard' || pockets > 12) milledMachineClass = 'cnc_4ax_vmc';
      }
      const cncMhrRate =
        family === 'cnc_milled'
          ? (milledMachineClass === 'cnc_5ax_mc' ? mhrRates.cnc5ax
             : milledMachineClass === 'cnc_4ax_vmc' ? mhrRates.cnc4ax
             : mhrRates.cnc3ax)
        : family === 'mill_turn' ? mhrRates.cncMillTurn
        : mhrRates.cncLathe;

      const cncInput: CNCCostInput = {
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
        mhrRate: cncMhrRate,
        tappingRate: mhrRates.tapping,
        deburrRate: mhrRates.deburring,
      };

      if (family === 'cnc_milled') return { ...computeCNCMilledCostSummary(cncInput, milledMachineClass), ...currencyMeta };
      if (family === 'mill_turn')  return { ...computeMillTurnCostSummary(cncInput), ...currencyMeta };
      return { ...computeCNCTurnedCostSummary(cncInput, 'cnc_lathe'), ...currencyMeta };
    }

    return {
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
  }

  async getRouteComparison(
    id: string,
    userId: string,
    accessToken: string,
    batchSize = 1,
  ): Promise<RouteComparisonDto> {
    const item = await this.findOne(id, userId, accessToken);

    const fg = item.featureGraph as any;
    const summary = fg?.summary ?? {};

    const sheetThicknessMm = (summary.sheetThicknessMm ?? item.sheetThicknessMm ?? 0) as number;
    const family: string =
      fg?.classification?.family ??
      item.familyClassification ??
      (sheetThicknessMm > 0 ? 'sheet_metal' : 'unknown');

    const cutLengthMm     = (summary.cutLengthMm      ?? item.cutLengthMm      ?? 0) as number;
    const pierceCount     = (summary.pierceCount       ?? item.pierceCount      ?? 0) as number;
    const bendCount       = (summary.bendCount         ?? item.bendCount        ?? 0) as number;
    const flatPatternAreaMm2 = (summary.flatPatternAreaMm2 ?? item.flatPatternAreaMm2 ?? 0) as number;
    const holeCount       = (summary.holeCount         ?? item.holeCount        ?? 0) as number;
    const threads = ((item.drawingIntelligence as any)?.threads ?? []) as Array<{ size: string; count: number }>;
    const drawingGradeRC = ((item.drawingIntelligence as any)?.material ?? null) as string | null;
    const grade = (drawingGradeRC?.trim() || null) ?? item.materialGrade ?? item.material ?? null;

    // Flat pattern dimensions — from bom_items.max_length / max_width (set by CAD pipeline).
    // Access both camelCase and snake_case to handle FIELD_MAPPING variations safely.
    const flatPatternLengthMm = ((item as any).maxLength ?? (item as any).max_length ?? null) as number | null;
    const flatPatternWidthMm  = ((item as any).maxWidth  ?? (item as any).max_width  ?? null) as number | null;

    const capabilityGeometry: PartGeometryForCapability = {
      sheetThicknessMm,
      flatPatternLengthMm,
      flatPatternWidthMm,
    };

    // ── Shared warnings ────────────────────────────────────────────────────────
    const comparisonWarnings: string[] = [];
    if (!grade) comparisonWarnings.push('Material grade not set — default mild steel rates applied');

    // ── Material cost (same pattern as getCostSummary) ─────────────────────────
    let materialCostPerKg = MATERIAL_DEFAULTS.__default__.costPerKg;
    let materialDensityKgM3 = MATERIAL_DEFAULTS.__default__.densityKgM3;
    let materialSource: 'db' | 'default' = 'default';

    if (grade) {
      try {
        const client = this.supabaseService.getClient(accessToken);
        const g = grade.trim();
        const { data } = await client
          .from('raw_materials')
          .select('cost_india, cost, density, density_kg_m3')
          .or(`material_grade.ilike.%${g}%,material.ilike.%${g}%`)
          .limit(1)
          .maybeSingle();

        if (data) {
          const costPerKg: number | null = (data as any).cost_india ?? (data as any).cost ?? null;
          const densityGCm3: number | null = (data as any).density ?? null;
          const densityKgM3: number | null =
            (data as any).density_kg_m3 ?? (densityGCm3 != null ? densityGCm3 * 1000 : null);
          if (costPerKg != null && costPerKg > 0 && densityKgM3 != null && densityKgM3 > 0) {
            materialCostPerKg = costPerKg;
            materialDensityKgM3 = densityKgM3;
            materialSource = 'db';
          }
        }
      } catch {
        // fall through to named defaults
      }
    }

    if (materialSource === 'default') {
      const gradeUpper = (grade ?? '').toUpperCase();
      const fallbackKey =
        Object.keys(MATERIAL_DEFAULTS).find((k) => k !== '__default__' && gradeUpper.includes(k)) ??
        '__default__';
      const fallback = MATERIAL_DEFAULTS[fallbackKey];
      materialCostPerKg = fallback.costPerKg;
      materialDensityKgM3 = fallback.densityKgM3;
    }

    const thk = sheetThicknessMm > 0 ? sheetThicknessMm : 2.0;
    const volumeMm3 = flatPatternAreaMm2 * thk;
    const netWeightKg = (volumeMm3 / 1e9) * materialDensityKgM3;
    const grossWeightKg = netWeightKg * (1 + MATERIAL_OVERHEAD_PCT / 100);
    const materialCost = this.r2(grossWeightKg * materialCostPerKg);

    // ── MHR rates ──────────────────────────────────────────────────────────────
    const mhrRates = await this.resolveMHRRates(accessToken);

    if (family === 'cnc_milled') {
      return this.buildCNCMilledRoutes(
        id, item, fg, summary, grade, materialCostPerKg, materialDensityKgM3,
        materialSource, mhrRates, batchSize, comparisonWarnings,
      );
    }
    if (family === 'cnc_turned' || family === 'mill_turn') {
      return this.buildCNCTurnedRoutes(
        id, item, fg, summary, grade, materialCostPerKg, materialDensityKgM3,
        materialSource, mhrRates, batchSize, comparisonWarnings,
      );
    }
    if (family === 'unknown') {
      return {
        bomItemId: id, batchSize, materialCost: 0,
        materialGrade: grade ?? '', grossWeightKg: 0,
        materialCostPerKg: 0, materialSource,
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
    if (family !== 'sheet_metal') {
      return {
        bomItemId: id, batchSize, materialCost: 0,
        materialGrade: grade ?? '', grossWeightKg: 0,
        materialCostPerKg: 0, materialSource,
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
      const speedMmPerMin = LASER_SPEED_MM_PER_MIN[speedKey] ?? 3000;
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

    // Waterjet
    const waterjetResult = computeWaterjetCost({
      sheetThicknessMm, cutLengthMm, pierceCount, batchSize,
      waterjetRate: mhrRates.waterjet,
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

    return {
      bomItemId: id,
      batchSize,
      materialCost,
      materialGrade: grade ?? 'Unknown',
      grossWeightKg: Math.round(grossWeightKg * 1000) / 1000,
      materialCostPerKg,
      materialSource,
      routes,
      comparisonWarnings,
    };
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

    const features: GdtFeatureDto[] = rawCallouts.map((c) => {
      const derived = deriveGdtSeverity(c.type ?? "", c.tolerance ?? 0);
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
    if (drawingThreads.length > 0) return drawingThreads;
    // Drawing not yet analyzed — synthesize from geometry-detected tapped holes
    const cncFeatures = (fg?.cnc_features?.features ?? []) as Array<{ type: string; params: any }>;
    const tapped = cncFeatures.filter((f) => f.type === 'tapped_hole');
    if (tapped.length === 0) return [];
    const specCounts: Record<string, number> = {};
    for (const f of tapped) {
      const spec: string = f.params?.spec ?? 'M3';
      specCounts[spec] = (specCounts[spec] ?? 0) + 1;
    }
    return Object.entries(specCounts).map(([size, count]) => ({ size, count }));
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
  ): RouteComparisonDto {
    const holeCount = (summary.holeCount ?? item.holeCount ?? 0) as number;
    const threads = ((item.drawingIntelligence as any)?.threads ?? []) as Array<{ size: string; count: number }>;
    const maxLength = ((item as any).maxLength ?? 0) as number;
    const maxWidth  = ((item as any).maxWidth  ?? 0) as number;
    const maxHeight = ((item as any).maxHeight ?? 0) as number;
    const finishedWeightKg = ((item as any).weight ?? 0) as number;

    const baseInput: Omit<CNCCostInput, 'mhrRate'> = {
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
      threads,
      tightestToleranceMm:  ((item as any).tightestToleranceMm ?? null) as number | null,
      gdtFeatureCount:      (fg?.cnc_features?.feature_summary?.gdt_features ?? 0) as number,
      batchSize,
      family:               'cnc_milled',
      finishedWeightKg,
      tappingRate:          mhrRates.tapping,
      deburrRate:           mhrRates.deburring,
    };

    const milledMachineClasses: CNCMachineClass[] = ['cnc_3ax_vmc', 'cnc_4ax_vmc', 'cnc_5ax_mc'];
    const milledRouteIds: RouteId[] = ['cnc-3ax', 'cnc-4ax', 'cnc-5ax'];
    const milledRouteLabels = ['3-Axis VMC', '4-Axis VMC', '5-Axis MC'];
    const milledMhrKeys = ['cnc3ax', 'cnc4ax', 'cnc5ax'] as const;

    const pocketCount = (fg?.cnc_features?.feature_summary?.pockets ?? 0) as number;

    const threadCount = baseInput.threads.reduce((s, t) => s + t.count, 0);

    const routes: RouteResultDto[] = milledMachineClasses.map((mc, i) => {
      const cost = computeCNCMilledCostSummary({ ...baseInput, mhrRate: mhrRates[milledMhrKeys[i]] }, mc);
      const capability = checkCNCCapability(mc, maxLength, maxWidth, maxHeight, finishedWeightKg);
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
          holeCount, pocketCount, threadCount, routeSetups, baseInput.gdtFeatureCount,
        ),
      };
    });

    // Badges — only among capable routes
    const capable = routes.filter((r) => r.capability.overallCapable);
    if (capable.length > 0) {
      const minCost = Math.min(...capable.map((r) => r.totalCost));
      routes.forEach((r) => { r.badges.lowestCost = r.capability.overallCapable && r.totalCost === minCost; });

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
  ): RouteComparisonDto {
    const holeCount = (summary.holeCount ?? item.holeCount ?? 0) as number;
    const drawingThreads = ((item.drawingIntelligence as any)?.threads ?? []) as Array<{ size: string; count: number }>;
    const maxLength = ((item as any).maxLength ?? 0) as number;
    const maxWidth  = ((item as any).maxWidth  ?? 0) as number;
    const maxHeight = ((item as any).maxHeight ?? 0) as number;
    const finishedWeightKg = ((item as any).weight ?? 0) as number;

    const baseInput: Omit<CNCCostInput, 'mhrRate'> = {
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
      tappingRate:          mhrRates.tapping,
      deburrRate:           mhrRates.deburring,
    };

    const machineClasses: CNCMachineClass[] = ['cnc_lathe', 'cnc_lathe_live', 'cnc_mill_turn'];
    const routeIds: RouteId[] = ['cnc-lathe', 'cnc-lathe-lt', 'cnc-mill-turn'];
    const routeLabels = ['CNC Lathe (2-Axis)', 'Lathe + Live Tooling', 'Mill-Turn'];
    const mhrKeys = ['cncLathe', 'cncLatheLive', 'cncMillTurn'] as const;

    const threadCount = baseInput.threads.reduce((s, t) => s + t.count, 0);

    const routes: RouteResultDto[] = machineClasses.map((mc, i) => {
      const cost = computeCNCTurnedCostSummary({ ...baseInput, mhrRate: mhrRates[mhrKeys[i]] }, mc);
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

    // Badges
    const capable = routes.filter((r) => r.capability.overallCapable);
    if (capable.length > 0) {
      routes.forEach((r) => { r.badges.lowestCost = r.routeId === 'cnc-lathe' && r.capability.overallCapable; });
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