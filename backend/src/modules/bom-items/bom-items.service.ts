import { Injectable, Logger, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateBOMItemDto, UpdateBOMItemDto } from './dto/bom-items.dto';
import { BOMItemResponseDto, BOMItemListResponseDto } from './dto/bom-item-response.dto';
import type { CalculationTraceStep, PhysicsGap, UnsupportedOperationGap, ManufacturingPhysicsResult, ConfidenceLevel, ResolutionStatus, LookupResolution, ValidatedInput } from './dto/cost-breakdown.dto';
import { computeCostSummary, computeSustainability, applyPersistedRouteToSummary } from './costing/cost-engine';
import type { MHRRateInput, AppliedProcessCostRecord, LhrRateSource } from './costing/cost-engine';
import { planInspection, finalizeInspectionLine } from './costing/inspection-engine';
import type { InspectionInput } from './costing/inspection-engine';
import { evaluateCalculatorFormulas, normalizeFieldName } from '../calculators/calculator-formula-evaluator';
import type { CalculatorFieldRow } from '../calculators/calculator-formula-evaluator';
import { PHYSICS_REGISTRY } from '../calculators/physics-registry';
import { SheetMetalLookupService, roundUpToStandardTonnageClass } from './costing/sheet-metal-lookup.service';
import type { LaserCutParams } from './costing/sheet-metal-lookup.service';
import { computeNesting, resolveNestingDimensions, EDGE_ALLOWANCE_MM, STANDARD_SHEETS, isTrueNestCostingCacheValid, computePartAllowanceMm } from './costing/sheet-metal-nesting.engine';
import { selectBestTrueNestCandidate } from './costing/true-nest-costing.engine';
import { resolveNetUsagePhysics } from './costing/sheet-metal-net-usage.physics';
import type { TrueNestCandidate, TrueNestCostingSelection } from './costing/true-nest-costing.engine';
import {
  computeCNCMilledCostSummary, computeCNCTurnedCostSummary,
  checkCNCCapability, computeRouteComplexityScore,
  requiredMilledMachineClass, meetsRequiredMilledClass, pickRecommendedRoute,
  detectMaterialClass,
} from './costing/cost-cnc-engine';
import type { CNCCostInput, CNCMachineClass } from './costing/cost-cnc-engine';
import { BlankOptimizerService } from './costing/blank-optimizer.service';
import { buildOperationSequence, injectDrawingIntelligence } from './costing/operation-sequencer';
import type { OperationLine } from './costing/operation-sequencer';
import { computeInjectionMoldedCostSummary, IM_RUNNER_SCRAP_PCT, recommendCavityCount } from './costing/cost-injection-molding-engine';
import type { InjectionMoldingCostInput } from './costing/cost-injection-molding-engine';
import { isPlasticGrade } from './costing/injection-molding/process-tree';
import {
  selectIMmachinesByTier,
  type IMSelectionRequirements,
} from './costing/injection-molding/machine-selector-im';
import {
  MATERIAL_OVERHEAD_PCT, RATES_SOURCE_LABEL,
  DEBURR_SEC_PER_METRE, DEBURR_SEC_PER_PIERCE,
  TAPPING_SETUP_MIN, computeTapCycleSec, resolveTapPhysicsInputs, TAP_UNLOAD_SEC,
  resolveDrillingSpeedFeed, COUNTERSINK_SPEED_FACTOR, HOLE_OP_UNLOAD_SEC,
  resolveReamPhysicsInputs, TIGHT_TOLERANCE_REAM_THRESHOLD_MM,
  MACHINE_REGISTRY, LOCATION_INFO, CURRENCY_SYMBOLS,
  DEFAULT_COSTING_LOCATION, benchmarkRateWarning, lhrRateWarning,
  type RateWarnThresholds, DEFAULT_RATE_WARN_THRESHOLDS,
  resolveUtsMpa, isSheetFormableMaterial, estimateBendTonnage,
  estimateBurlTonnage, estimateBurlDiameterMm, BURRING_SETUP_MIN,
  type SurfaceTreatmentDbRate, classifySurfaceTreatment,
  classifyInspectionResource,
} from './costing/default-rates';
import type { MachineClass } from './costing/default-rates';
import { checkMachineCapability } from './costing/machine-capability';
import type { CapabilityCheck as MachineCapabilityCheck, PartGeometryForCapability } from './costing/machine-capability';
import { getEnginesForFamily, ROUTE_ID_FOR_CLASS, ROUTE_LABEL_FOR_CLASS } from './costing/manufacturing-process-registry';
import { resolveEffectiveSheetThicknessMm, resolveScenarioFxSnapshot } from './costing/scenario-overrides';
import type { CostSummaryDto, ProcessLineCost, FeatureOp, CostStatus } from './dto/cost-breakdown.dto';
import type { BlankSpecDto } from './dto/blank-spec.dto';
import type { TrueNestResultDto } from './dto/true-nest.dto';
import type { CandidateRouteComparisonDto, CandidateRouteDto } from './dto/candidate-route.dto';
import type { RouteComparisonDto, RouteResultDto, RouteId, RouteCapability } from './dto/route-comparison.dto';
import { resolveInspectionRule, SEVERITY_RANK } from './costing/gdt-severity';
import type { GdtSeverity, InspectionMethod, InspectionRuleRow } from './costing/gdt-severity';
import type { InspectionStagePolicy } from './costing/default-rates';
import { InspectionKnowledgeService } from '../manufacturing-knowledge/services/inspection-knowledge.service';
import type { GdtAnalysisDto, GdtFeatureDto } from './dto/gdt-analysis.dto';
import {
  classifyLaserMaterial, laserRequirement, latheRequirement,
  pressBrakeRequirement, holeFormingRequirement, vmcRequirement, injectionMoldingRequirement,
  punchingRequirement, waterjetRequirement,
  MATERIAL_MRR_CM3_MIN,
} from './costing/machine-selection/physics';
import type { MachineRequirement } from './costing/machine-selection/physics';
import { explainCandidate, fetchMachinePool, selectMachine } from './costing/machine-selection/selector';
import { EMPTY_CAPABILITY, MACHINE_CLASS_DEFAULTS, lookupSeedCapability } from './costing/machine-selection/seed-registry';
import type { CapabilityCheck, MachineCandidate, MachineRecommendation, MachineSelectionResult } from './dto/machine-selection.dto';
import {
  shapeRankForFamily,
  isDiscouragedShapeForFamily,
} from '../raw-materials/constants/material-shape-ranking';
import { ExchangeRateService, RateSnapshot } from '../../common/exchange-rate/exchange-rate.service';
import { CADAnalysisService } from './services/cad-analysis.service';

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
    private readonly blankOptimizer: BlankOptimizerService,
    private readonly smLookup: SheetMetalLookupService,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly cadAnalysisService: CADAnalysisService,
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
    organizationId?: string,
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
        organization_id: organizationId ?? null,
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

  /**
   * Merges a partial patch into bom_items.scenario_overrides (see migration
   * 420/421 and costing/scenario-overrides.ts). A null value for a key
   * CLEARS that override — the key is removed, not stored as null —
   * reverting costing to the real CAD-extracted/auto-detected value for
   * that input.
   *
   * Delegates the merge to the merge_scenario_overrides() Postgres function
   * (migration 421) instead of a client-side read-modify-write. The
   * read-then-write version had a real race: two PATCH requests for the
   * same item close together in time (e.g. a Blank Thickness override saved
   * on blur, followed shortly by Apply Scenario saving location/batchSize)
   * could each read scenario_overrides BEFORE the other's write landed,
   * merge against that stale snapshot, and silently overwrite each other's
   * key. The DB function runs as one implicit transaction with a row lock
   * held for its full duration, so concurrent calls for the same row
   * serialize correctly instead of racing on a client-side read.
   */
  async patchScenarioOverrides(
    id: string,
    patch: Record<string, unknown>,
    accessToken?: string,
  ): Promise<BOMItemResponseDto> {
    const client = this.supabaseService.getClient(accessToken);

    const { data: row, error } = await client
      .rpc('merge_scenario_overrides', { p_id: id, p_patch: patch })
      .single();

    if (error) {
      // Postgres RAISE EXCEPTION inside the function surfaces here as a
      // generic error, not a distinct "not found" code — match on the
      // message merge_scenario_overrides raises (migration 421) rather than
      // collapsing every RPC error into a misleading 404.
      if (error.message?.includes('not found')) {
        throw new NotFoundException(`BOM item with ID ${id} not found`);
      }
      this.logger.error(`Error merging scenario overrides for ${id}: ${error.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to update scenario overrides: ${error.message}`);
    }
    if (!row) {
      throw new NotFoundException(`BOM item with ID ${id} not found`);
    }

    return BOMItemResponseDto.fromDatabase(row);
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

  // Every getCostSummary/getRouteComparison money field is computed in the
  // requested location's LOCAL currency internally (real, unchanged formulas —
  // this only touches the response shape). Applied once, right before return,
  // using the ONE RateSnapshot the caller obtained at the top of the request —
  // never a second FX lookup, never a fabricated/guessed rate. `tooling`/
  // `injectionMolding` money fields (already USD-native, e.g. moldCostUsd) are
  // deliberately untouched — converting them again would double-convert.
  // machine-selection/selector.ts's pickRate() reads total_machine_hour_rate
  // straight off mhr_records — local currency, same convention as every other
  // internal rate here — and that raw number ends up on EVERY MachineCandidate
  // this attaches to a process line (balanced/cheapest/fastest picks, plus the
  // alternates list). Confirmed live: normalizeCostSummaryToCurrency only ever
  // walked the process line's OWN setupCost/runCost/totalCost/hourlyRate, never
  // this nested machineSelection structure — so for a non-USD location these
  // candidate rates (and the "swap machine" list built from them) stayed in
  // local currency while everything else on the same line got converted,
  // showing e.g. a real ₹2000/hr India CMM as "$2000.00/hr" once the
  // now-USD-labelled response reached the frontend.
  private convertMachineSelectionCost(ms: MachineSelectionResult | undefined, conv: (v: number) => number): MachineSelectionResult | undefined {
    if (!ms) return ms;
    const convCandidate = (c: MachineCandidate): MachineCandidate => ({ ...c, hourlyRate: conv(c.hourlyRate) });
    const convRecommendation = (r: MachineRecommendation): MachineRecommendation => ({ ...r, candidate: convCandidate(r.candidate) });
    return {
      ...ms,
      balanced: convRecommendation(ms.balanced),
      cheapest: convRecommendation(ms.cheapest),
      fastest: convRecommendation(ms.fastest),
      alternatives: ms.alternatives.map(convCandidate),
    };
  }

  // The display currency for a costing response: the scenario's saved FX
  // snapshot (Currency & Ask Price widget) when one is on file AND its
  // factoryCurrency still matches this request's actual local currency —
  // using its EXACT stored rate, never re-derived, so reopening a scenario
  // reproduces the same cost even if today's rate has since changed (see
  // resolveScenarioFxSnapshot's own doc comment). A stale snapshot from a
  // Digital Factory that has since changed is deliberately ignored rather
  // than misapplied to the wrong native currency.
  //
  // With no usable snapshot — the pre-existing, undocumented default every
  // caller already depended on — falls back to USD via the live admin
  // budget rate, identical to what normalizeCostSummaryToUsd always did.
  //
  // usdToDisplayRate is a SEPARATE concept from `rate`/toUsdRate below — it
  // answers "how many units of the display currency is 1 USD worth?", for
  // converting fields that are ALWAYS stored in USD regardless of factory
  // (raw_material_cost_records.unit_cost, packaging/procured/tooling totals,
  // process_cost_records.machineRate/laborRate — see process-cost.service.ts,
  // which always writes these in USD via toUsdCreate/toUsdIfProvided). Do not
  // confuse it with `rate` (local-native-currency → display), which is what
  // the DTO's own already-computed fields below are converted through — a
  // frontend bug conflated the two (assumed toUsdRate always meant "→USD"),
  // which is exactly how a real $1.175/kg got relabeled ₹1.175/kg instead of
  // converted when the factory's native currency was itself the display
  // currency (toUsdRate/rate correctly = 1 there, but usdToDisplayRate is not).
  private resolveDisplayCurrency(
    scenarioOverrides: Record<string, unknown> | null | undefined,
    localCurrencyCode: string,
    rates: RateSnapshot,
  ): { currency: string; currencySymbol: string; rate: number; usdToDisplayRate: number; inrToDisplayRate?: number } {
    // inrToDisplayRate uses convertOptional (never convertStrict) — it's an
    // additive convenience for frontend consumers converting INR-denominated
    // constants (e.g. the Investment/NRE tab), not something every cost-
    // summary request depends on. A factory whose local currency is already
    // USD has always worked with zero exchange_rates dependency (see the
    // localCurrencyCode === 'USD' branch below, pre-existing); requiring an
    // INR->USD rate on file just to compute this one optional field would be
    // a new, unrelated way for the whole request to fail loudly.
    const snapshot = resolveScenarioFxSnapshot(scenarioOverrides);
    if (snapshot && snapshot.factoryCurrency === localCurrencyCode) {
      const currency = snapshot.scenarioCurrency;
      const inrToCurrency = currency === 'INR' ? 1 : rates.convertOptional('INR', localCurrencyCode);
      return {
        currency,
        currencySymbol: CURRENCY_SYMBOLS[currency] ?? currency,
        rate: snapshot.rate,
        usdToDisplayRate: currency === 'USD' ? 1 : rates.convertStrict('USD', localCurrencyCode) * snapshot.rate,
        inrToDisplayRate: inrToCurrency == null ? undefined : inrToCurrency * snapshot.rate,
      };
    }
    if (localCurrencyCode === 'USD') {
      return {
        currency: 'USD', currencySymbol: '$', rate: 1, usdToDisplayRate: 1,
        inrToDisplayRate: rates.convertOptional('INR', 'USD') ?? undefined,
      };
    }
    return {
      currency: 'USD', currencySymbol: '$',
      rate: rates.convertStrict(localCurrencyCode, 'USD'),
      usdToDisplayRate: 1,
      inrToDisplayRate: rates.convertOptional('INR', 'USD') ?? undefined,
    };
  }

  private normalizeCostSummaryToCurrency(
    dto: CostSummaryDto,
    rates: RateSnapshot,
    localCurrencyCode: string,
    scenarioOverrides: Record<string, unknown> | null | undefined,
  ): CostSummaryDto {
    // costStatus/incompleteProcesses — see CostStatus's own doc comment. Computed
    // here (the single point every family's getCostSummary path already funnels
    // through) rather than per-family, so CNC/injection-molding/sheet-metal can
    // never diverge on what "a complete quote" means. Currency-independent —
    // computed before either return branch below.
    const incompleteProcesses = dto.processLines.filter((l) => !!l.physicsGap).map((l) => l.process);
    const costStatus: CostStatus = incompleteProcesses.length > 0 ? 'incomplete' : 'complete';
    const { currency, currencySymbol, rate, usdToDisplayRate, inrToDisplayRate } = this.resolveDisplayCurrency(scenarioOverrides, localCurrencyCode, rates);
    if (currency === localCurrencyCode) {
      return {
        ...dto, currency, currencySymbol, toUsdRate: 1, usdToDisplayRate, inrToDisplayRate,
        costStatus, incompleteProcesses: incompleteProcesses.length ? incompleteProcesses : undefined,
      };
    }
    const conv = (v: number) => v * rate;
    return {
      ...dto,
      costStatus,
      incompleteProcesses: incompleteProcesses.length ? incompleteProcesses : undefined,
      materialCost: conv(dto.materialCost),
      materialCostPerKg: conv(dto.materialCostPerKg),
      processLines: dto.processLines.map((l) => ({
        ...l,
        setupCost: conv(l.setupCost),
        runCost: conv(l.runCost),
        totalCost: conv(l.totalCost),
        hourlyRate: conv(l.hourlyRate),
        labourRate: l.labourRate != null ? conv(l.labourRate) : l.labourRate,
        machineSelection: this.convertMachineSelectionCost(l.machineSelection, conv),
      })),
      totalProcessCost: conv(dto.totalProcessCost),
      totalCost: conv(dto.totalCost),
      blankSpec: dto.blankSpec ? { ...dto.blankSpec, wasteCost: conv(dto.blankSpec.wasteCost) } : dto.blankSpec,
      sustainability: { ...dto.sustainability, wasteCostInr: conv(dto.sustainability.wasteCostInr) },
      costOverrides: dto.costOverrides
        ? Object.fromEntries(Object.entries(dto.costOverrides).map(([k, v]) => [k, conv(v)]))
        : dto.costOverrides,
      currency,
      currencySymbol,
      toUsdRate: rate,
      usdToDisplayRate,
      inrToDisplayRate,
    };
  }

  // Same purpose as normalizeCostSummaryToCurrency, for getRouteComparison's
  // response shape — each RouteResultDto's own processLines/materialCost/
  // totalCost, plus the top-level material fields, computed in local currency
  // internally, converted once here via the caller's RateSnapshot.
  private normalizeRouteComparisonToCurrency(
    dto: RouteComparisonDto,
    rates: RateSnapshot,
    localCurrencyCode: string,
    scenarioOverrides: Record<string, unknown> | null | undefined,
  ): RouteComparisonDto {
    const { currency, currencySymbol, rate, usdToDisplayRate } = this.resolveDisplayCurrency(scenarioOverrides, localCurrencyCode, rates);
    if (currency === localCurrencyCode) {
      return { ...dto, currency, currencySymbol, toUsdRate: 1, usdToDisplayRate };
    }
    const conv = (v: number) => v * rate;
    return {
      ...dto,
      materialCost: conv(dto.materialCost),
      materialCostPerKg: conv(dto.materialCostPerKg),
      routes: dto.routes.map((route) => ({
        ...route,
        processLines: route.processLines.map((l) => ({
          ...l,
          setupCost: conv(l.setupCost),
          runCost: conv(l.runCost),
          totalCost: conv(l.totalCost),
          hourlyRate: conv(l.hourlyRate),
          labourRate: l.labourRate != null ? conv(l.labourRate) : l.labourRate,
          machineSelection: this.convertMachineSelectionCost(l.machineSelection, conv),
        })),
        materialCost: conv(route.materialCost),
        abrasiveCost: conv(route.abrasiveCost),
        totalProcessCost: conv(route.totalProcessCost),
        totalCost: route.totalCost != null ? conv(route.totalCost) : route.totalCost,
      })),
      currency,
      currencySymbol,
      toUsdRate: rate,
      usdToDisplayRate,
    };
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
    // Real per-bend lengths from the cad-engine's bend clustering (see
    // RawGeometry.bendLengths) — sized to the LONGEST real bend line, since a
    // press brake bends one line at a time and must cover the worst case, not
    // an aggregate. Empty when the CAD engine had no per-bend data (mesh-
    // inference-only parts) — falls back to the flat-pattern's own overall
    // dimension as a conservative upper bound (a bend can never exceed it).
    bendLengthsMm?: number[];
    // Resolved ONCE from raw_materials by resolveMaterialForFamily (falls back
    // to an approved per-family value with a warning when unverified, or to
    // null — never a fabricated number — when the grade matches no known
    // family) — the SAME number the $ cost calculation uses, so machine
    // selection can never silently disagree with the displayed/costed
    // tonnage. null flows through as "UTS-dependent checks skipped".
    utsMpa: number | null;
    // Feature-driven hole extrusion (burring) — see estimateBurlDiameterMm's
    // own doc comment (default-rates.ts) for how burlDiameterMm is derived;
    // callers pass the SAME value already used for the $ cost calculation.
    extrudedFlangeCount?: number;
    burlDiameterMm?: number;
    // P0.4: real turret-punch tonnage inputs — the SAME cutLengthMm/shear
    // strength already resolved elsewhere on this part (capabilityGeometry's
    // punchCutLengthMm/materialShearStrengthMpa), so machine SELECTION and the
    // post-selection TONNAGE_EXCEEDED capability check can never disagree.
    cutLengthMm?: number;
    materialShearStrengthMpa?: number | null;
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
      // P0.4: turret punch and waterjet each get their own real physical
      // requirement (tonnage for punching; thickness+bed only for waterjet,
      // which has no force formula) instead of the laser's thickness+bed+
      // material-family check — previously ALL cutting engines shared the
      // identical LaserRequirement, so ranking never examined turret tonnage
      // at all (see machine-selection/physics.ts's PunchingRequirement/
      // WaterjetRequirement doc comments for the full defect). Any future
      // cutting engine not named here falls back to the laser requirement,
      // preserving the previous "new engine auto-included" behavior for the
      // common case.
      for (const engine of getEnginesForFamily('sheet_metal_cutting')) {
        const cls = engine.machineClass as MachineClass;
        if (cls === 'turret_punch') {
          requirements[cls] = punchingRequirement({
            cutLengthMm: input.cutLengthMm ?? 0,
            materialShearStrengthMpa: input.materialShearStrengthMpa ?? 0,
            thicknessMm: input.sheetThicknessMm,
            bedLengthMm: flatLen,
            bedWidthMm: flatWid,
          });
        } else if (cls === 'waterjet') {
          requirements[cls] = waterjetRequirement({
            thicknessMm: input.sheetThicknessMm,
            bedLengthMm: flatLen,
            bedWidthMm: flatWid,
          });
        } else {
          requirements[cls] = cutReq;
        }
      }

      if (input.bendCount > 0) {
        const realMaxBendLength = (input.bendLengthsMm && input.bendLengthsMm.length > 0)
          ? Math.max(...input.bendLengthsMm)
          : null;
        requirements.press_brake = pressBrakeRequirement({
          bendLengthMm: realMaxBendLength ?? Math.max(flatLen, flatWid),
          thicknessMm: input.sheetThicknessMm,
          utsMpa: input.utsMpa,
        });
      }

      if ((input.extrudedFlangeCount ?? 0) > 0) {
        requirements.hole_forming = holeFormingRequirement({
          holeDiameterMm: input.burlDiameterMm ?? 3,
          thicknessMm: input.sheetThicknessMm,
          utsMpa: input.utsMpa,
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
    mhrRates: Record<string, unknown>,
  ): void {
    const byClass = new Map<string, MachineSelectionResult>();
    for (const rate of Object.values(mhrRates)) {
      const r = rate as MHRRateInput;
      if (r && typeof r.machineClass === 'string' && r.selection) {
        byClass.set(r.machineClass, r.selection);
      }
    }
    for (const line of lines) {
      // Machine-less lines (Fixture: amortised tooling hardware, zero machine
      // time) must not carry a machine picker.
      if (line.hourlyRate <= 0) continue;
      const selection = byClass.get(line.machineClass);
      if (selection) {
        line.machineSelection = selection;
        // `confidence` (deriveConfidence) already grades the PROCESS
        // PARAMETERS (did cycle time come from a real lookup row) — it says
        // nothing about whether the SELECTED MACHINE's own capability is
        // real. Genuinely separate axis: a line can have verified process
        // parameters (real sm_lookup_* row) while the machine that will run
        // it has no real capability on file at all (capabilitySource
        // 'default_class' — a generic per-class floor, e.g. press_brake's
        // flat 60T, presented in reasons[] as prose but not as its own
        // structured field until now). See this session's audit: "Nisshinbo
        // LGS-C 8" and "Hole Flanging / Burring Station" both carry
        // capabilitySource 'default_class' — their tonnage numbers are
        // MACHINE_CLASS_DEFAULTS, not this specific machine's real rating.
        line.capabilityConfidence = this.deriveCapabilityConfidence(
          selection.balanced?.candidate?.capabilitySource,
        );
      }
    }
  }

  private deriveCapabilityConfidence(capabilitySource: string | undefined): ConfidenceLevel {
    if (capabilitySource === 'imported') return 'verified';
    // 'seed' (OEM name/pattern match) and 'benchmark' (a shared reference-
    // table row, e.g. mhr_benchmark_rates) are both real, sourced data —
    // just not THIS specific machine's own imported nameplate/asset record.
    if (capabilitySource === 'seed' || capabilitySource === 'benchmark') return 'derived';
    // 'default_class' (MACHINE_CLASS_DEFAULTS' generic per-class floor) or
    // anything unset — no real, machine-specific capability on file at all.
    return 'unsupported';
  }

  // Explains each SAVED process_cost_records row's own machine, even when it
  // no longer matches the live balanced/cheapest/fastest picks attached above
  // (utilization/cost scores can drift after a row was saved without the
  // saved pick itself becoming wrong). Without this, the frontend has no
  // capability data for a differing saved pick and must suppress the
  // explanation entirely rather than show it — or worse, misattribute the
  // live pick's reasoning to a different machine.
  private async attachSavedMachineExplanations(
    lines: ProcessLineCost[],
    bomItemId: string,
    accessToken: string,
    location: string,
  ): Promise<void> {
    try {
      const client = this.supabaseService.getClient(accessToken);
      const { data: savedRows } = await client
        .from('process_cost_records')
        .select('mhr_id, machine_class')
        .eq('bom_item_id', bomItemId)
        .not('mhr_id', 'is', null);
      if (!savedRows?.length) return;

      const mhrIdsByClass = new Map<string, Set<string>>();
      for (const row of savedRows as Array<{ mhr_id: string; machine_class: string | null }>) {
        if (!row.machine_class) continue;
        const set = mhrIdsByClass.get(row.machine_class) ?? new Set<string>();
        set.add(row.mhr_id);
        mhrIdsByClass.set(row.machine_class, set);
      }
      if (mhrIdsByClass.size === 0) return;

      const pool = await fetchMachinePool(client, location);
      for (const line of lines) {
        const mhrIds = mhrIdsByClass.get(line.machineClass);
        const requirement = line.machineSelection?.requirement;
        if (!mhrIds || !requirement) continue;
        const explanations: Record<string, { reasons: string[]; capabilityCheck: CapabilityCheck | null }> = {};
        for (const mhrId of mhrIds) {
          if (mhrId === line.machineSelection?.balanced.candidate.machineId) continue; // already covered live
          const explained = explainCandidate(pool, line.machineClass as MachineClass, requirement, mhrId);
          if (explained) explanations[mhrId] = { reasons: explained.reasons, capabilityCheck: explained.capabilityCheck };
        }
        if (Object.keys(explanations).length > 0) line.savedMachineExplanations = explanations;
      }
    } catch {
      // Non-fatal — missing explanation just means the saved-pick UI shows nothing extra.
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
    mhrRates: Record<string, unknown>,
    location: string,
  ): Promise<void> {
    try {
      const client = this.supabaseService.getClient(accessToken);
      const selections = (Object.values(mhrRates) as MHRRateInput[])
        .filter((r) => r && typeof r.machineClass === 'string' && r.selection && r.selection.requirement.kind !== 'generic')
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
    location: string,
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

  // eMithran-style manual overrides: field_key = 'mat_rate' | '<process>::rate' |
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
    location: string,
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

  // sm_lookup_manual_stroke's rows are stroke times for a real MACHINE's
  // tonnage class (10/20/30.../2000T — how fast THAT press's ram cycles),
  // not for whatever minimum force this one bend happens to need. Two
  // distinct cases, two distinct rounding rules:
  //   1. A real machine IS selected — use its own real tonnage capacity
  //      (`MachineSelectionResult.balanced.candidate.capability.maxTonnage`,
  //      sourced from mhr_records.max_tonnage or parsed from the machine's
  //      own name, e.g. "Bend Brake-800kN" -> ~81.6t). That precise number
  //      rarely lands on one of the table's round classes even though the
  //      machine conventionally IS that class ("800kN" -> real "80T" press
  //      brake) — SheetMetalLookupService.getManualStrokeTime rounds this to
  //      the NEAREST class (tight 10% tolerance) to correct for the naming
  //      convention, never substituting a meaningfully different machine.
  //   2. No real machine is selected (ENABLE_PHYSICS_MACHINE_SELECTION off,
  //      or no candidate matched) — only a required-force ESTIMATE exists
  //      (often under 10T for light/thin parts; confirmed live: no real
  //      commercial press brake is even rated below ~30-40T, so this can
  //      never match a row on its own). Round UP to the smallest real class
  //      that can actually do the job here, before handing it to
  //      getManualStrokeTime — a shop always sizes UP to an adequate
  //      machine, never picks an undersized one, so this is the physically
  //      correct rounding direction for an estimate (the opposite direction
  //      from case 1's naming-convention correction).
  private resolveStrokeLookupTonnage(requiredTonnageEstimate: number, mhrRate?: MHRRateInput): number {
    const candidate = mhrRate?.selection?.balanced?.candidate as any;
    const selectedTonnage = candidate?.capability?.maxTonnage;
    // Case 1 requires a REAL tonnage — mhr_records.max_tonnage or a real
    // seed-registry OEM pattern match (capabilitySource 'imported'/'seed'),
    // never MACHINE_CLASS_DEFAULTS' generic per-class floor (capabilitySource
    // 'default_class', selector.ts). That default exists so the UI can show
    // an honest "no capability on file — conservative class defaults applied"
    // reason — using it here would silently treat a fleet-wide guess as if
    // it were this specific machine's real rated capacity. When the only
    // number on file is that default, this is exactly case 2: no real
    // machine capability is known, so round the part's own required-force
    // estimate up to the smallest adequate class instead.
    const isRealCapability = candidate?.capabilitySource !== 'default_class';
    if (isRealCapability && typeof selectedTonnage === 'number' && Number.isFinite(selectedTonnage) && selectedTonnage > 0) {
      return selectedTonnage;
    }
    return roundUpToStandardTonnageClass(requiredTonnageEstimate);
  }

  // Builds the real, disclosed provenance string for a stroke-time seed
  // value — plainly states when SheetMetalLookupService.getManualStrokeTime
  // resolved it by INTERPOLATING between two real seeded thickness rows at
  // this exact tonnage/complexity, and/or when it ROUNDED the queried
  // tonnage to the nearest standard press-brake class — never presented as
  // if it were an exact hit either way; deriveConfidence/
  // deriveResolutionStatus's own marker scan reads these exact disclosures
  // to correctly grade the result 'derived'/'nearest_match' rather than
  // 'verified'/'resolved'.
  private describeStrokeTimeProvenance(
    thicknessMm: number, complexity: string, resolution: LookupResolution, roundedFromTonnage?: number | null,
  ): string {
    const queriedTonnage = resolution.queryParams.find((p) => p.column === 'tonnage')?.value;
    const tonnageNote = roundedFromTonnage
      ? `tonnage ${queriedTonnage}T (rounded from the real ${roundedFromTonnage}T value used for this lookup to the nearest standard press-brake class)`
      : `tonnage ${queriedTonnage}T`;
    const base = `sm_lookup_manual_stroke — thickness ${thicknessMm}mm, ${tonnageNote}, ${complexity} complexity`;
    if (resolution.policy === 'INTERPOLATE' && resolution.matchedRow) {
      const extrapolatedFrom = resolution.matchedRow.columns['extrapolated_from_thickness_mm'];
      if (extrapolatedFrom) {
        return `${base} — ${thicknessMm}mm is outside the real seeded thickness range at this tonnage; ` +
          `extrapolated from the two nearest real ${extrapolatedFrom}mm rows on file, not a verified or bracketed-interpolated value`;
      }
      const between = resolution.matchedRow.columns['interpolated_between_thickness_mm'];
      return `${base} — no exact row at ${thicknessMm}mm; interpolated between real ${between}mm rows on file at this tonnage`;
    }
    return base;
  }

  private async resolveMHRRates(
    accessToken: string,
    // USD/USA is this app's default — never INR/India (see migration
    // 436_default_currency_usd_not_inr.sql's own doc comment for the full
    // trace of why INR ever became the fallback in this codebase). Every
    // real call site below always passes an explicit `location`, so this
    // default is a safety net for a future caller that omits it, not a
    // path any current request actually takes.
    location = 'USA',
    physics: {
      requirements: Partial<Record<MachineClass, MachineRequirement>>;
      overrides: Map<string, string>;
    } | undefined,
    family: string | undefined,
    fxRates: RateSnapshot,
    warnings: string[] = [],
    thresholds: RateWarnThresholds = DEFAULT_RATE_WARN_THRESHOLDS,
  ): Promise<{
    laser: MHRRateInput;
    pressBrake: MHRRateInput;
    deburring: MHRRateInput;
    tapping: MHRRateInput;
    inspection: MHRRateInput;
    drillPress: MHRRateInput;
    pemPress: MHRRateInput;
    holeForming: MHRRateInput;
    turret: MHRRateInput;
    waterjet: MHRRateInput;
    cnc3ax: MHRRateInput;
    cnc4ax: MHRRateInput;
    cnc5ax: MHRRateInput;
    cncLathe: MHRRateInput;
    cncLatheLive: MHRRateInput;
    cncMillTurn: MHRRateInput;
    injectionMolding: MHRRateInput;
    benchmarkMap: Map<MachineClass, number>;
    directLaborRate: number | null;   // Sheet Metal DLR (lhr_records / lhr_benchmark_rates)
    qaInspectorRate: number | null;   // Quality inspector rate (Quality process group)
  }> {
    // Kick off LHR benchmark lookup immediately so it overlaps with the MHR DB round-trip
    const lhrRatesPromise = this.resolveLHRRates(accessToken, location, family, fxRates, warnings, thresholds);

    // Pass 4 placeholder — populated after the mhr_benchmark_rates query below.
    // benchmarkMap is used by both makeDefault() and applyBenchmarkOverrideIfNeeded().
    let benchmarkMap = new Map<MachineClass, number>();

    const makeDefault = (cls: MachineClass): MHRRateInput => ({
      rate: benchmarkMap.get(cls) ?? 0,
      source: (benchmarkMap.get(cls) ?? 0) > 0 ? 'default_rate' : 'no_db_rate',
      machineClass: cls,
      machineName: null,
      commodityCode: null,
    });

    // When the DB resolves a machine rate that is anomalously low (< 50% of benchmark)
    // or anomalously high (> 300% of benchmark) for the requested location, the rate
    // is almost certainly a data import error:
    //   - Too low:  a cross-location record stored in the wrong local currency
    //               (e.g. India's ₹3,200/hr Salvagnini surfacing in a USA run)
    //   - Too high: an INR rate treated as USD during Excel import and ×83.5 inflated
    //               (e.g. ₹1,138/hr laser read as $1,138 → stored as ₹95,023/hr)
    // Override to the location benchmark in both cases; mark the source so
    // appendRateWarnings() surfaces a single info note rather than per-line footnotes.
    const applyBenchmarkOverrideIfNeeded = (input: MHRRateInput, cls: MachineClass): MHRRateInput => {
      if (input.source !== 'mhr_database') return input;
      const benchmark = benchmarkMap.get(cls) ?? 0;
      if (benchmark <= 0) return input;

      const override = (reason: string): MHRRateInput => {
        this.logger.warn(
          `resolveMHRRates: ${input.machineName ?? cls} rate ${input.rate}/hr — ${reason}. ` +
          `Overriding to ${location} benchmark (${benchmark}/hr). Fix the MHR record to suppress this.`,
          'BOMItemsService',
        );
        // Preserve physics selection — machine choice stays; only the bad rate is replaced.
        return {
          rate: benchmark,
          source: 'benchmark_override',
          machineClass: cls,
          machineName: input.machineName,
          commodityCode: input.commodityCode,
          selection: input.selection,
        };
      };

      if (input.rate < benchmark * 0.50) {
        return override('below 50% of location benchmark — likely a cross-location currency mismatch');
      }
      if (input.rate > benchmark * 3.0) {
        return override('over 3× the location benchmark — likely an INR rate double-converted via USD import');
      }
      return input;
    };

    // When the physics path didn't run (or caught an exception and fell through),
    // synthesize a minimal MachineSelectionResult so MachineSelector always renders.
    // The candidate uses the actual resolved rate so the panel shows the right number.
    const ensureSelection = (rate: MHRRateInput, cls: MachineClass): MHRRateInput => {
      if (rate.selection) return rate;
      const cand: MachineCandidate = {
        machineId: null,
        machineName: rate.machineName,
        commodityCode: rate.commodityCode,
        machineClass: cls,
        hourlyRate: rate.rate,
        utilizationPct: 75, // ranking-only placeholder for this synthesized fallback candidate
        utilizationKnown: false,
        scheduledLoadPct: null,
        availabilityStatus: 'available',
        nextAvailableAt: null,
        maintenanceWindowStart: null,
        maintenanceWindowEnd: null,
        capability: { ...EMPTY_CAPABILITY, ...MACHINE_CLASS_DEFAULTS[cls] },
        capabilitySource: 'default_class',
        capabilityVersion: null,
        operators: rate.operators ?? null,
        laborRateUsdHr: rate.machineLaborRateUsdHr ?? null,
      };
      const reason = rate.source === 'mhr_database'
        ? 'Selected by commodity-code lookup — import the MHR database for capability-based selection'
        : rate.source === 'benchmark_override'
        ? `DB rate for ${rate.machineName ?? 'this machine'} was anomalous for ${location} — using location benchmark rate`
        : rate.source === 'default_rate'
        ? `No machine on file for ${location} — using location benchmark rate`
        : `No machine or benchmark rate on file for ${location} — cost is $0; add an MHR record`;
      const rec: MachineRecommendation = { candidate: cand, score: 0.4, reasons: [reason] };
      const selection: MachineSelectionResult = {
        balanced: rec, cheapest: rec, fastest: rec,
        alternatives: [],
        confidence: 40,
        requirement: { kind: 'generic' },
        allowOverride: true,
        overridden: false,
      };
      return { ...rate, selection };
    };

    const allClasses: MachineClass[] = [
      'fiber_laser', 'co2_laser', 'press_brake', 'deburring', 'tapping', 'cmm', 'turret_punch', 'waterjet',
      'cnc_3ax_vmc', 'cnc_4ax_vmc', 'cnc_5ax_mc', 'cnc_lathe', 'cnc_lathe_live', 'cnc_mill_turn',
      'injection_molding', 'drill_press', 'pem_press', 'hole_forming',
    ];

    // Await LHR data — started at the top, runs concurrently with the synchronous setup above
    const lhrRates = await lhrRatesPromise.catch(() => new Map<string, { rate: number; source: LhrRateSource }>());

    // ── Pass 4: mhr_benchmark_rates — DB-backed location benchmarks ─────────
    // Used as: (a) final fallback rate when mhr_records has no match, and
    //          (b) guard benchmark in applyBenchmarkOverrideIfNeeded.
    // Replaces the removed LOCATION_MHR_DEFAULTS hardcoded constant.
    // mhr_benchmark_rates.mhr_usd is stored in USD; convert to local currency
    // via the caller's RateSnapshot (real FX, one read per request) — never a
    // hardcoded USD/INR pivot.
    try {
      const { data: benchData } = await this.supabaseService
        .getClient(accessToken)
        .from('mhr_benchmark_rates')
        .select('machine_name, mhr_usd, process_group')
        .eq('location', location);

      if (benchData?.length) {
        const localCurrencyCode = (LOCATION_INFO[location] ?? LOCATION_INFO['Other']).code;
        // Map mhr_benchmark_rates machine_name patterns to MachineClass via MACHINE_REGISTRY keywords
        // Collect all matching rates per class first, then compute the median.
        // The median is more representative than the minimum: for fiber_laser the DB
        // has entries from 2kW ($38/hr) to 10kW ($81/hr) — minimum would anchor
        // the fallback and sanity-check guard to the cheapest (2kW), causing the
        // 6kW selected machine to appear under-benchmarked and trigger false overrides.
        const tmpRatesPerClass = new Map<MachineClass, number[]>();
        for (const row of benchData as any[]) {
          const mhrUsd = Number(row.mhr_usd ?? 0);
          if (mhrUsd <= 0) continue;
          const machineName = ((row.machine_name as string | null) ?? '').toLowerCase();
          const processGroup = ((row.process_group as string | null) ?? '').toLowerCase();
          for (const [cls, reg] of Object.entries(MACHINE_REGISTRY) as [MachineClass, typeof MACHINE_REGISTRY[MachineClass]][]) {
            const nameKws = (reg as any).machineClassKeywords as readonly string[];
            const pgKws   = (reg as any).processGroupKeywords as readonly string[];
            // Require BOTH name and process-group to match — OR-logic pulled unrelated machines
            // (Surface Grinder, Drill Press) into every "Machining" class benchmark pool.
            const matches = nameKws.some((kw) => machineName.includes(kw.toLowerCase()))
                         && pgKws.some((kw) => processGroup.includes(kw.toLowerCase()));
            if (!matches) continue;
            const arr = tmpRatesPerClass.get(cls) ?? [];
            arr.push(mhrUsd);
            tmpRatesPerClass.set(cls, arr);
          }
        }
        // Median across power/tonnage variants — convert to local currency
        const medianOf = (arr: number[]): number => {
          const s = [...arr].sort((a, b) => a - b);
          const m = Math.floor(s.length / 2);
          return s.length % 2 === 0 ? ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2 : (s[m] ?? 0);
        };
        for (const [cls, classRates] of tmpRatesPerClass) {
          benchmarkMap.set(cls, medianOf(classRates) * fxRates.convertStrict('USD', localCurrencyCode));
        }
      }
    } catch {
      // Non-critical — no benchmarks means guard skips and fallback is rate: 0
    }

    const buildOutput = (resolved: Map<MachineClass, MHRRateInput>) => {
      const get = (cls: MachineClass) => {
        const raw = resolved.get(cls) ?? makeDefault(cls);
        const r = ensureSelection(applyBenchmarkOverrideIfNeeded(raw, cls), cls);
        // This exact machine's own usd_lhr_total (machine_library.json's
        // labor_rate_usd_hr for benchmarked rows) takes precedence over the
        // location+process_group lhr_records/lhr_benchmark_rates lookup —
        // explicit, approved exception (2026-08-27) to that being the sole
        // labor-rate source; falls back to it when this machine has none.
        const lhr = lhrRates.get(cls);
        const perMachineLhr = r.machineLaborRateUsdHr;
        return {
          ...r,
          labourRate: perMachineLhr ?? lhr?.rate ?? null,
          labourRateSource: perMachineLhr != null ? 'mhr_machine_specific' : (lhr?.source ?? 'no_lhr_rate'),
        };
      };
      // "Laser Cutting" is one process line regardless of which real laser
      // technology performs it — fiber and CO2 (co2_laser, e.g. AMADA
      // Quattro) are two separate machine classes/pools, but this part only
      // has one laser operation, so pick whichever class actually has a real
      // machine on file (source: 'mhr_database') for this location. Prefer
      // fiber_laser when both are real (today's existing behavior,
      // unchanged) or neither is — this only changes behavior for a
      // location/part whose laser machine is genuinely CO2-classed.
      const resolveLaserSlot = () => {
        const fiber = get('fiber_laser');
        const co2 = get('co2_laser');
        if (co2.source === 'mhr_database' && fiber.source !== 'mhr_database') return co2;
        return fiber;
      };
      return {
        laser:            resolveLaserSlot(),
        pressBrake:       get('press_brake'),
        deburring:        get('deburring'),
        tapping:          get('tapping'),
        inspection:       get('cmm'),
        drillPress:       get('drill_press'),
        pemPress:         get('pem_press'),
        holeForming:      get('hole_forming'),
        turret:           get('turret_punch'),
        waterjet:         get('waterjet'),
        cnc3ax:           get('cnc_3ax_vmc'),
        cnc4ax:           get('cnc_4ax_vmc'),
        cnc5ax:           get('cnc_5ax_mc'),
        cncLathe:         get('cnc_lathe'),
        cncLatheLive:     get('cnc_lathe_live'),
        cncMillTurn:      get('cnc_mill_turn'),
        injectionMolding: get('injection_molding'),
        benchmarkMap, // exposed for appendRateWarnings benchmark guard
        // Direct labor and QA inspector rates surfaced for cost-engine input.
        // fiber_laser maps to 'Sheet Metal' process group → DLR for all SM ops.
        // cmm maps to 'Quality' process group → QA inspector rate.
        directLaborRate: lhrRates.get('fiber_laser')?.rate ?? null,
        qaInspectorRate: lhrRates.get('cmm')?.rate ?? null,
      };
    };

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
            fallbackRate: benchmarkMap.get(cls) ?? 0,
          });
          const cand = selection.balanced.candidate;
          // A real machine always means 'mhr_database'. Without one, selectMachine's
          // fallback candidate carries either the real benchmark rate (fallbackRate
          // above, > 0 → 'default_rate') or a genuine $0 when no benchmark exists
          // either ('no_db_rate') — never label a $0 fallback as if a default rate
          // were actually applied, that's exactly the silent-fallback mislabeling
          // this replaced.
          resolved.set(cls, {
            rate: cand.hourlyRate,
            source: cand.machineId ? 'mhr_database' : (cand.hourlyRate > 0 ? 'default_rate' : 'no_db_rate'),
            machineClass: cls,
            machineName: cand.machineName,
            commodityCode: cand.commodityCode,
            selection,
            operators: cand.operators,
            machineLaborRateUsdHr: cand.laborRateUsdHr,
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
    // fully_burdened_local_per_hr is machine + labour combined — never prefer it here.
    // This legacy resolution feeds the same eMithranTerms() path (cost-engine.ts) as the
    // physics selector, which always separately adds its own direct-labour term; using
    // the burdened figure as "the machine rate" would double-count labour. See the
    // matching fix/comment on pickRate() in machine-selection/selector.ts.
    const pickRate = (row: any): number => {
      const mhr = Number(row.total_machine_hour_rate ?? 0);
      const man = Number(row.manual_mhr_value ?? 0);
      return mhr > 0 ? mhr : man;
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

      // Pass 3 — cross-location fallback: pick from ANY user mhr_records when the
      // factory location doesn't match the user's stored records (e.g. India records
      // shown for a USA factory). Uses mhr_usd_per_hour (USD-normalised) when available
      // so cross-currency rates don't produce 80× inflated numbers.
      const classesP3 = allClasses.filter((cls) => !resolved.has(cls));
      if (classesP3.length > 0) {
        try {
          const orPartsP3: string[] = [];
          for (const cls of classesP3) {
            for (const kw of MACHINE_REGISTRY[cls].machineClassKeywords) {
              orPartsP3.push(`machine_class.ilike.%${kw}%`);
              // Also search machine_name: catches "Injection Molding 100T" when machine_class is null/coded.
              orPartsP3.push(`machine_name.ilike.%${kw}%`);
            }
            for (const kw of MACHINE_REGISTRY[cls].processGroupKeywords) {
              orPartsP3.push(`process_group.ilike.%${kw}%`);
              orPartsP3.push(`machine_name.ilike.%${kw}%`);
            }
          }
          if (orPartsP3.length > 0) {
            const { data: p3Data } = await this.supabaseService
              .getClient(accessToken)
              .from('mhr_records')
              .select(
                'machine_name, commodity_code, process_group, machine_class, ' +
                'mhr_usd_per_hour, total_machine_hour_rate, fully_burdened_local_per_hr, manual_mhr_value',
              )
              .or(orPartsP3.join(','));

            if (p3Data?.length) {
              type P3Hit = { rate: number; machineName: string; commodityCode: string };
              const p3Best = new Map<MachineClass, P3Hit>();
              for (const row of p3Data as any[]) {
                // Prefer mhr_usd_per_hour for cross-location so INR rates aren't used raw as USD
                const usd  = Number(row.mhr_usd_per_hour ?? 0);
                const fb   = Number(row.fully_burdened_local_per_hr ?? 0);
                const mhr  = Number(row.total_machine_hour_rate ?? 0);
                const man  = Number(row.manual_mhr_value ?? 0);
                const rate = usd > 0 ? usd : fb > 0 ? fb : mhr > 0 ? mhr : man;
                if (rate <= 0) continue;
                const mcLower = (row.machine_class ?? '').toLowerCase();
                const mnLower = (row.machine_name ?? '').toLowerCase();
                const pgLower = (row.process_group ?? '').toLowerCase();
                for (const cls of classesP3) {
                  if (resolved.has(cls)) continue;
                  const nameKws = MACHINE_REGISTRY[cls].machineClassKeywords;
                  const mcMatch = nameKws.some((kw) => mcLower.includes(kw.toLowerCase()) || mnLower.includes(kw.toLowerCase()));
                  const pgMatch = !mcMatch && MACHINE_REGISTRY[cls].processGroupKeywords.some((kw) => pgLower.includes(kw.toLowerCase()));
                  if (!mcMatch && !pgMatch) continue;
                  const existing = p3Best.get(cls);
                  if (!existing || rate < existing.rate) {
                    p3Best.set(cls, { rate, machineName: row.machine_name, commodityCode: row.commodity_code ?? '' });
                  }
                }
              }
              for (const [cls, hit] of p3Best) {
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
        } catch { /* non-critical — hardcoded defaults remain as last resort */ }
      }

      return buildOutput(resolved);
    } catch {
      return buildOutput(new Map());
    }
  }

  /**
   * Resolves a real, CMM-specific machine rate for inspection lines that
   * escalate to the 'cmm' InspectionMethod — separate from resolveMHRRates'
   * own `inspection` field (which resolves whatever single 'cmm'-class
   * machine the tenant's pool scores best, e.g. a cheap manual inspection
   * bench — correct for the visual/caliper/height_gauge tiers, but wrong for
   * an actual CMM-tier check, which needs a dedicated, meaningfully more
   * expensive CMM machine, not a bench charged at bench rates).
   *
   * Real → benchmark → generic-inspection-rate fallback, same 3-pass
   * convention as resolveMHRRates' own get(), just filtered to machine names
   * that actually indicate CMM equipment rather than every 'cmm'-class row
   * (which in this schema also covers inspection benches/gauges — see
   * default-rates.ts's cmm keyword registry).
   */
  private async resolveCmmSpecificRate(
    accessToken: string,
    location: string,
    rates: RateSnapshot,
    fallback: MHRRateInput,
    warnings: string[],
  ): Promise<MHRRateInput> {
    const client = this.supabaseService.getClient(accessToken);

    try {
      const { data: realRows } = await client
        .from('mhr_records')
        .select('id, machine_name, machine_class, total_machine_hour_rate, manual_mhr_value, is_manual_entry, commodity_code')
        .eq('machine_class', 'cmm')
        .eq('location', location);
      const realCmm = (realRows ?? [])
        .filter((r: any) => classifyInspectionResource(r.machine_class, r.machine_name) === 'CMM')
        .map((r: any) => ({
          id: r.id as string,
          machineName: r.machine_name as string,
          rate: Number(r.is_manual_entry ? r.manual_mhr_value : r.total_machine_hour_rate) || 0,
          commodityCode: r.commodity_code ?? null,
        }))
        .filter((r) => r.rate > 0)
        .sort((a, b) => a.rate - b.rate)[0];
      if (realCmm) {
        return {
          rate: realCmm.rate, source: 'mhr_database', machineClass: 'cmm',
          machineName: realCmm.machineName, commodityCode: realCmm.commodityCode,
          mhrRecordId: realCmm.id,
        };
      }

      const { data: benchRows } = await client
        .from('mhr_benchmark_rates')
        .select('id, machine_name, mhr_usd, process_group, machine_class')
        .eq('location', location);
      const localCurrencyCode = (LOCATION_INFO[location] ?? LOCATION_INFO['Other']).code;
      const qualityPgKws = MACHINE_REGISTRY.cmm.processGroupKeywords;
      const cmmBench = (benchRows ?? [])
        .filter((r: any) =>
          classifyInspectionResource(r.machine_class, r.machine_name) === 'CMM' && Number(r.mhr_usd ?? 0) > 0 &&
          qualityPgKws.some((kw) => (r.process_group ?? '').toLowerCase().includes(kw.toLowerCase())))
        .sort((a: any, b: any) => Number(a.mhr_usd) - Number(b.mhr_usd))[0];
      if (cmmBench != null) {
        return {
          rate: Number(cmmBench.mhr_usd) * rates.convertStrict('USD', localCurrencyCode),
          source: 'benchmark_override', machineClass: 'cmm',
          machineName: 'CMM Machine (benchmark)', commodityCode: null,
          benchmarkMhrId: `bm-mhr-${cmmBench.id}`,
        };
      }
    } catch {
      // Non-critical — falls through to the generic inspection rate below
    }

    warnings.push(
      `No dedicated CMM machine on file for ${location} (real or benchmark) — a CMM-tier inspection check ` +
      `is priced at the generic inspection bench rate, which likely understates real CMM cost.`,
    );
    return fallback;
  }

  /**
   * Resolves a real, non-CMM inspection-resource rate (manual bench/gauge
   * equipment) for the visual/caliper/height_gauge InspectionMethod tiers —
   * the mirror image of resolveCmmSpecificRate: same 'cmm'-class row pool
   * (this schema has no separate machine_class for bench-type inspection
   * equipment), same real → benchmark → gap fallback order, but EXCLUDING
   * CMM_NAME_PATTERN matches instead of requiring them, so a visual/caliper/
   * height_gauge line can never end up silently priced at real CMM
   * equipment's rate just because resolveMHRRates' cost/utilization scoring
   * happened to prefer it that request. Confirmed live (2026-08-09): every
   * tested location has a real, distinct, cheaper "Manual Inspection Bench"
   * row alongside its "CMM Machine" row (e.g. India: bench $5/hr vs CMM
   * $8/hr) — this filter is what makes using it deterministic rather than
   * an accident of scoring.
   */
  private async resolveGenericInspectionRate(
    accessToken: string,
    location: string,
    rates: RateSnapshot,
    warnings: string[],
  ): Promise<MHRRateInput> {
    const client = this.supabaseService.getClient(accessToken);
    const gap: MHRRateInput = { rate: 0, source: 'no_db_rate', machineClass: 'cmm', machineName: null, commodityCode: null };

    try {
      const { data: realRows } = await client
        .from('mhr_records')
        .select('id, machine_name, machine_class, total_machine_hour_rate, manual_mhr_value, is_manual_entry, commodity_code')
        .eq('machine_class', 'cmm')
        .eq('location', location);
      const realBench = (realRows ?? [])
        .filter((r: any) => classifyInspectionResource(r.machine_class, r.machine_name) !== 'CMM')
        .map((r: any) => ({
          id: r.id as string,
          machineName: r.machine_name as string,
          rate: Number(r.is_manual_entry ? r.manual_mhr_value : r.total_machine_hour_rate) || 0,
          commodityCode: r.commodity_code ?? null,
        }))
        .filter((r) => r.rate > 0)
        .sort((a, b) => a.rate - b.rate)[0];
      if (realBench) {
        return {
          rate: realBench.rate, source: 'mhr_database', machineClass: 'cmm',
          machineName: realBench.machineName, commodityCode: realBench.commodityCode,
          mhrRecordId: realBench.id,
        };
      }

      const { data: benchRows } = await client
        .from('mhr_benchmark_rates')
        .select('id, machine_name, mhr_usd, process_group, machine_class')
        .eq('location', location);
      const localCurrencyCode = (LOCATION_INFO[location] ?? LOCATION_INFO['Other']).code;
      const qualityPgKws = MACHINE_REGISTRY.cmm.processGroupKeywords;
      const benchOnly = (benchRows ?? [])
        .filter((r: any) =>
          classifyInspectionResource(r.machine_class, r.machine_name) !== 'CMM' && Number(r.mhr_usd ?? 0) > 0 &&
          qualityPgKws.some((kw) => (r.process_group ?? '').toLowerCase().includes(kw.toLowerCase())))
        .sort((a: any, b: any) => Number(a.mhr_usd) - Number(b.mhr_usd))[0];
      if (benchOnly) {
        return {
          rate: Number(benchOnly.mhr_usd) * rates.convertStrict('USD', localCurrencyCode),
          source: 'benchmark_override', machineClass: 'cmm',
          machineName: `${benchOnly.machine_name} (benchmark)`, commodityCode: null,
          benchmarkMhrId: `bm-mhr-${benchOnly.id}`,
        };
      }
    } catch {
      // Non-critical — falls through to the genuine no_db_rate gap below
    }

    warnings.push(
      `No dedicated inspection-bench resource on file for ${location} (real or benchmark) — visual/caliper/` +
      `height_gauge inspection is costed at labor-only, machine cost is a genuine $0.`,
    );
    return gap;
  }

  /**
   * Resolves the real (process_group, process_route, operation) identity for a set
   * of machine classes, straight from process_calculator_mappings — the same table
   * ProcessCostDialog's hierarchy picker reads. Used so the cost engine's process
   * lines (e.g. "Laser Cutting") can carry a real, DB-backed operation instead of
   * reusing their cosmetic display label as a fake operation (that produced a real
   * bug: saved records where processRoute === operation === the display label,
   * which never matches a mapping row — see migration 372).
   *
   * One representative active row per machine class (lowest display_order) — a
   * machine class can legitimately map to several operations (e.g. fiber_laser →
   * 'Fiber Laser Cut' or 'Laser Cut'); this picks a stable default. Non-critical:
   * any DB failure or missing class is simply absent from the returned map, and
   * callers must treat that as "no known identity" rather than fabricating one.
   *
   * Also surfaces `lhrProcessGroup` — the real lhr_records/lhr_benchmark_rates
   * process_group this machine class is billed against (migration 424's
   * process_calculator_mappings.lhr_process_group column), null when the
   * class's real labour tier already equals its hierarchy processGroup.
   * resolveLHRRates is this field's only consumer today, but it's returned
   * for every caller since it's the same row already fetched, not an extra
   * query — see that method for why a per-class hardcoded group map was
   * replaced by this DB-driven lookup.
   *
   * machineClasses omitted (or undefined) fetches every active machine class
   * on file, keyed by whatever distinct machine_class values come back —
   * used by resolveLHRRates, which needs every class's billing group, not a
   * caller-enumerated subset.
   */
  private async resolveProcessIdentities(
    accessToken: string,
    machineClasses?: string[],
    family?: string,
  ): Promise<Record<string, { processGroup: string; processRoute: string; operation: string; lhrProcessGroup: string | null }>> {
    const classes = machineClasses ? [...new Set(machineClasses.filter(Boolean))] : null;
    if (classes && classes.length === 0) return {};

    try {
      let query = this.supabaseService
        .getClient(accessToken)
        .from('process_calculator_mappings')
        .select('process_group, process_route, operation, machine_class, lhr_process_group, display_order, applicable_families')
        .eq('is_active', true)
        .not('machine_class', 'is', null)
        .order('display_order', { ascending: true });
      if (classes) query = query.in('machine_class', classes);

      const { data, error } = await query;

      if (error || !data) {
        if (error) this.logger.warn(`resolveProcessIdentities: ${error.message}`, 'BOMItemsService');
        return {};
      }

      const toIdentity = (row: any) => ({
        processGroup: row.process_group,
        processRoute: row.process_route,
        operation: row.operation,
        lhrProcessGroup: row.lhr_process_group ?? null,
      });

      const targetClasses = classes ?? [...new Set((data as any[]).map((r) => r.machine_class as string))];
      const result: Record<string, { processGroup: string; processRoute: string; operation: string; lhrProcessGroup: string | null }> = {};
      for (const cls of targetClasses) {
        const rows = (data as any[]).filter((r) => r.machine_class === cls); // already display_order-sorted
        if (rows.length === 0) continue;
        // A machine class can have several active routes (e.g. tapping is done
        // on sheet-metal, milled, AND turned parts, each a different real
        // process_route in the DB — applicable_families on that row is how the
        // catalog itself declares which part family it's for, set via the
        // Calculators/Process admin UI, not inferred in code). Prefer the row
        // whose applicable_families lists this part's family; fall back to the
        // lowest-display_order row (existing behaviour) when no row is scoped
        // to this family, e.g. the class has only one generic route on file.
        const familyMatch = family
          ? rows.find((r) => Array.isArray(r.applicable_families) && r.applicable_families.includes(family))
          : undefined;
        result[cls] = toIdentity(familyMatch ?? rows[0]);
      }
      return result;
    } catch (err: any) {
      this.logger.warn(`resolveProcessIdentities failed: ${err.message}`, 'BOMItemsService');
      return {};
    }
  }

  /**
   * Resolves labour hour rates (local currency/hr) keyed by machine class.
   *
   * Priority:  user's imported `lhr_records` (avg per process_group) → `lhr_benchmark_rates`
   * This mirrors how MHR resolves: DB records first, benchmark/defaults as fallback.
   * Non-critical: any DB failure returns an empty map so cost totals are never blocked.
   *
   * Which lhr_records/lhr_benchmark_rates process_group each machine class
   * bills against comes from process_calculator_mappings.lhr_process_group
   * (migration 424), via resolveProcessIdentities — not a hardcoded table
   * here. Several classes bill at a genuinely different, more specific skill
   * tier than their hierarchy processGroup (turret_punch → 'Turret',
   * deburring → 'Deburr', cmm → 'Quality', the CNC classes → 'CNC Machining',
   * injection_molding → 'Plastic & Rubber' — see migration 424's own comment
   * for the real wage-data sources behind each). tapping's correct tier is
   * family-dependent (sheet-metal/milled/turned parts each tap on a different
   * real process_calculator_mappings row) — resolveProcessIdentities already
   * picks the row matching this part's family via applicable_families, so
   * its resolved processGroup is correct per-family with no special case
   * needed here.
   */
  private async resolveLHRRates(
    accessToken: string,
    location: string,
    family: string | undefined,
    fxRates: RateSnapshot,
    warnings: string[] = [],
    thresholds: RateWarnThresholds = DEFAULT_RATE_WARN_THRESHOLDS,
  ): Promise<Map<string, { rate: number; source: LhrRateSource }>> {
    const identities = await this.resolveProcessIdentities(accessToken, undefined, family);
    const classGroups = new Map<string, string>();
    for (const [cls, identity] of Object.entries(identities)) {
      classGroups.set(cls, identity.lhrProcessGroup ?? identity.processGroup);
    }

    // P0.6 (Machine Economics, provenance-visibility phase): this function's 4
    // passes already resolve labor rate with real precedence (own-location
    // import > benchmark > cross-location import > plausibility guard) but
    // used to collapse to a bare number — the machine-rate side already had
    // this exact visibility via MHRRateInput.source/rateSource (surfaced in
    // Cost Summary as "MHR DB"/"Benchmark"/etc.); labor rate had none. Track
    // which pass actually won per PROCESS GROUP (the resolution unit), then
    // map to per-class source below — same shape, not a new mechanism.
    const result = new Map<string, { rate: number; source: LhrRateSource }>();
    const pgRate = new Map<string, number>();
    const pgSource = new Map<string, LhrRateSource>();

    try {
      const client = this.supabaseService.getClient(accessToken);

      // ── Pass 1: user-imported lhr_records (exact location match) ───────────
      // lhr column is local currency/hr — same unit as mhrRates so no FX needed.
      // Average across skill levels per process group; skip zero/null rows.
      const { data: userRows } = await client
        .from('lhr_records')
        .select('process_group, lhr')
        .eq('location', location)
        .gt('lhr', 0)
        .not('process_group', 'is', null);

      if (userRows?.length) {
        const pgSum = new Map<string, { sum: number; count: number }>();
        for (const row of userRows as any[]) {
          const rate = Number((row as any).lhr ?? 0);
          const pg = ((row as any).process_group as string | null)?.trim();
          if (rate <= 0 || !pg) continue;
          const acc = pgSum.get(pg) ?? { sum: 0, count: 0 };
          pgSum.set(pg, { sum: acc.sum + rate, count: acc.count + 1 });
        }
        for (const [pg, { sum, count }] of pgSum) {
          pgRate.set(pg, sum / count);
          pgSource.set(pg, 'lhr_database');
        }
      }

      // ── Pass 2: lhr_benchmark_rates fills any process group still missing ──
      // Reads lhr_usd_effective (real, researched USD/hr) and converts to
      // this location's local currency DYNAMICALLY via the live exchange
      // rate snapshot — mirrors resolveMHRRates' own Pass 4 exactly, and
      // deliberately does NOT read this table's own `lhr` (local-currency)
      // column. Confirmed live: migration 361 seeded `lhr` equal to
      // `lhr_usd_effective` for every non-USD location (e.g. India's Sheet
      // Metal row: lhr=1.73, lhr_usd_effective=1.73 — should have been
      // ~144 INR, not 1.73) — a real ₹1.73/$1.73 duplication bug, not a
      // researched local rate. Converting from the one correctly-researched
      // USD figure at read time avoids relying on that column at all, and
      // — like MHR's benchmark pass — never goes stale relative to
      // exchange_rates (a static local-currency seed column would).
      const allGroups = [...new Set(classGroups.values())];
      const missingGroups = allGroups.filter((pg) => !pgRate.has(pg));
      const localCurrencyCode = (LOCATION_INFO[location] ?? LOCATION_INFO['Other']).code;
      const usdToLocal = fxRates.convertStrict('USD', localCurrencyCode);

      if (missingGroups.length > 0) {
        const { data: benchRows } = await client
          .from('lhr_benchmark_rates')
          .select('process_group, lhr_usd_effective')
          .eq('location', location)
          .in('process_group', missingGroups);

        for (const row of (benchRows ?? []) as any[]) {
          const usdRate = Number((row as any).lhr_usd_effective ?? 0);
          const pg = ((row as any).process_group as string | null)?.trim();
          if (usdRate > 0 && pg) {
            pgRate.set(pg, usdRate * usdToLocal);
            pgSource.set(pg, 'lhr_benchmark');
          }
        }
      }

      // ── Pass 3: cross-location fallback from lhr_records (any location) ──
      // Triggered when user has LHR records for a different factory (e.g. India records
      // for a USA run). Uses lhr_usd_effective so cross-currency rates stay in USD.
      const missingGroupsP3 = allGroups.filter((pg) => !pgRate.has(pg));
      if (missingGroupsP3.length > 0) {
        const { data: p3Rows } = await client
          .from('lhr_records')
          .select('process_group, lhr, lhr_usd_effective')
          .in('process_group', missingGroupsP3)
          .gt('lhr', 0)
          .not('process_group', 'is', null);

        if (p3Rows?.length) {
          // Use separate accumulators for USD-effective vs local-currency rows.
          // Averaging across both would silently mix units (e.g. $5 USD with ₹95 INR).
          // Prefer the USD accumulator; fall back to local-currency only for process
          // groups that have no USD-effective rows at all.
          const p3UsdSum   = new Map<string, { sum: number; count: number }>();
          const p3LocalSum = new Map<string, { sum: number; count: number }>();
          for (const row of p3Rows as any[]) {
            const usdRate   = Number((row as any).lhr_usd_effective ?? 0);
            const localRate = Number((row as any).lhr ?? 0);
            const pg = ((row as any).process_group as string | null)?.trim();
            if (!pg) continue;
            if (usdRate > 0) {
              const acc = p3UsdSum.get(pg) ?? { sum: 0, count: 0 };
              p3UsdSum.set(pg, { sum: acc.sum + usdRate, count: acc.count + 1 });
            } else if (localRate > 0) {
              const acc = p3LocalSum.get(pg) ?? { sum: 0, count: 0 };
              p3LocalSum.set(pg, { sum: acc.sum + localRate, count: acc.count + 1 });
            }
          }
          for (const [pg, { sum, count }] of p3UsdSum) {
            if (!pgRate.has(pg)) { pgRate.set(pg, sum / count); pgSource.set(pg, 'lhr_cross_location'); }
          }
          for (const [pg, { sum, count }] of p3LocalSum) {
            if (!pgRate.has(pg) && !p3UsdSum.has(pg)) { pgRate.set(pg, sum / count); pgSource.set(pg, 'lhr_cross_location'); }
          }
        }
      }

      // ── Pass 4: plausibility guard — compare whatever won (Pass 1/2/3)
      // against this SAME location+group's real benchmark, regardless of
      // which pass actually resolved it. This is the check that would have
      // caught the ₹12,062/hr live bug: Pass 1 (lhr_records) can silently
      // win with a stale/corrupted import row, which short-circuits Pass 2
      // (benchmark) entirely since the group is no longer "missing" — so the
      // correct benchmark must be fetched here unconditionally, purely as a
      // comparison reference, never as a value that gets applied.
      const resolvedGroups = [...pgRate.keys()];
      if (resolvedGroups.length > 0) {
        const { data: allBenchRows } = await client
          .from('lhr_benchmark_rates')
          .select('process_group, lhr_usd_effective')
          .eq('location', location)
          .in('process_group', resolvedGroups);

        const benchmarkByGroup = new Map<string, number>();
        for (const row of (allBenchRows ?? []) as any[]) {
          const usdRate = Number((row as any).lhr_usd_effective ?? 0);
          const pg = ((row as any).process_group as string | null)?.trim();
          if (usdRate > 0 && pg) benchmarkByGroup.set(pg, usdRate * usdToLocal);
        }

        for (const pg of resolvedGroups) {
          const rate = pgRate.get(pg);
          if (rate == null) continue;
          const warning = lhrRateWarning(pg, location, rate, benchmarkByGroup.get(pg), thresholds);
          if (warning && !warnings.includes(warning)) warnings.push(warning);
        }
      }

      // ── Map machine classes to resolved process-group rates ──────────────
      for (const [cls, pg] of classGroups) {
        const rate = pgRate.get(pg);
        if (rate != null) result.set(cls, { rate, source: pgSource.get(pg) ?? 'lhr_database' });
      }
    } catch {
      // Non-critical — LHR display degrades gracefully; cost totals are unaffected
    }

    return result;
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
  // the identical shape — the material can. This is the eMithran routing model:
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

  // Drawing-intelligence extraction returns a sentinel string like "Not specified"
  // when the title block has no material field, rather than null. Treated as a real
  // grade, that sentinel passes the `!grade` scenario gate (it's a non-empty string),
  // so costing proceeds to look up "Not specified" in raw_materials — which obviously
  // fails, producing a $0 quote with a warning that misleadingly tells the user to add
  // a material row named "Not specified". Filtering it here lets the grade resolver
  // correctly fall through to item.materialGrade/item.material, and — when those are
  // also empty — hit the real "specify a material" gate instead of a fake match attempt.
  private static readonly UNSPECIFIED_DRAWING_MATERIAL = new Set(['Unknown', 'Not Specified', 'Not specified', 'None', '']);
  private sanitizeDrawingGrade(raw: string | null): string | null {
    const trimmed = raw?.trim() || null;
    if (!trimmed) return null;
    return BOMItemsService.UNSPECIFIED_DRAWING_MATERIAL.has(trimmed) ? null : trimmed;
  }

  private async resolveMaterialForFamily(input: {
    accessToken: string;
    grade: string | null;
    family: string;
    materialCol: string;
    rates: RateSnapshot;
    locCurrencyCode: string;
    warnings: string[];
  }): Promise<{
    materialCostPerKg: number; materialDensityKgM3: number; materialSource: 'db' | 'default';
    // UTS/shear strength — resolved from the SAME raw_materials row density/cost
    // came from (same exact-then-tokenized match), so machine selection (press-
    // brake tonnage) and $ costing can never diverge onto two different material
    // rows or two different property sources. Three-tier hierarchy, no invented
    // catch-all: verified per-part DB value ('db') -> approved material-family
    // value from MATERIAL_UTS_MPA ('family_default') -> null ('unavailable') when
    // the grade matches neither. Callers must treat null as "skip the UTS-
    // dependent check" (never substitute a guessed number), and utsSource lets
    // them warn appropriately.
    utsMpa: number | null; shearStrengthMpa: number | null; utsSource: 'db' | 'family_default' | 'unavailable';
  }> {
    const { accessToken, grade, family, materialCol, rates, locCurrencyCode, warnings } = input;

    if (grade) {
      try {
        const client = this.supabaseService.getClient(accessToken);
        const g = grade.trim();
        const selectCols = `${materialCol}, cost_india, cost, density, density_kg_m3, shape, material_grade, shearing_strength, ultimate_tensile_strength, shear_strength_mpa, uts_mpa`;

        // Alias lookup first — e.g. "AL6101" has no substring in common with its
        // real row ("Generic Aluminum, ANSI 6101"), so none of the ilike attempts
        // below can ever match it. material_aliases (migration 382/383) exists
        // exactly for this and is already used by raw-materials.service.ts's own
        // search — this resolver just never queried it, so any alias-only grade
        // silently fell through to the mild-steel default further down.
        let data: unknown[] | null = null;
        const aliasNormalized = g.toUpperCase().replace(/[\s-]/g, '');
        if (aliasNormalized) {
          const { data: aliasRow } = await client
            .from('material_aliases')
            .select('raw_material_id')
            .eq('alias_normalized', aliasNormalized)
            .maybeSingle();
          if (aliasRow?.raw_material_id) {
            ({ data } = await client
              .from('raw_materials')
              .select(selectCols)
              .eq('id', aliasRow.raw_material_id)
              .limit(1));
          }
        }

        // Try an exact (case-insensitive) match on the full grade string first — e.g.
        // "Generic Aluminum - Honeycomb (Expanded 1)" should hit that literal row, not
        // whatever else happens to contain "Aluminum". Without this, the tokenized
        // fuzzy fallback below could silently substitute a completely different
        // material's density/cost (confirmed live against this DB: this exact grade has
        // real density 50 kg/m³, but the fuzzy path was landing on unrelated
        // ~450-2700 kg/m³ rows — an 8-50x error in computed part weight with no warning).
        // Uses two separate .ilike() calls, not .or('material.ilike.X,...') — PostgREST's
        // or() filter treats "," and "(" "/" ")" in the embedded value as its own
        // grouping syntax, so a grade string containing them (confirmed: "(Expanded 1)")
        // silently corrupts the filter and the query returns nothing.
        if (!data?.length) {
          ({ data } = await client
            .from('raw_materials')
            .select(selectCols)
            .ilike('material', g)
            .limit(5));
        }
        if (!data?.length) {
          ({ data } = await client
            .from('raw_materials')
            .select(selectCols)
            .ilike('material_grade', g)
            .limit(5));
        }

        if (!data?.length) {
          // Tokenize compound grade strings so partial-standard matches succeed.
          // "IS2062 E250 CRCA" splits to ["IS2062","E250","CRCA"]; the DB stores
          // "Mild Steel IS2062" and "CRCA Steel" as separate rows — neither matches
          // the full compound string, but each token matches at least one row. Only
          // reached when no exact match exists — this is a lower-confidence fallback,
          // not an equal alternative to the exact match above. Strip PostgREST's
          // or()-filter-special characters (same corruption risk as above — a token
          // like "(Expanded" would otherwise break the whole clause) rather than
          // silently dropping the token or the whole match attempt.
          const tokens = g
            .split(/[\s\-\/]+/)
            .map((t) => t.replace(/[(),]/g, ''))
            .filter((t) => t.length >= 3);
          const orClause = (tokens.length > 1 ? tokens : [g.replace(/[(),]/g, '')])
            .flatMap((t) => [`material_grade.ilike.%${t}%`, `material.ilike.%${t}%`])
            .join(',');
          ({ data } = await client
            .from('raw_materials')
            .select(selectCols)
            .or(orClause)
            .limit(12));
        }

        // Cast via unknown: the select() column list is dynamic (location column),
        // which Supabase's literal-type parser cannot statically resolve.
        const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
          const locCost = row[materialCol] as number | null;
          const indiaCost = (row.cost_india ?? row.cost) as number | null;
          const densityGCm3 = row.density as number | null;
          const densityKgM3 =
            (row.density_kg_m3 as number | null) ?? (densityGCm3 != null ? densityGCm3 * 1000 : null);
          // Prefer the newer, calculator-facing columns (uts_mpa/shear_strength_mpa,
          // migration 360) over their legacy source columns — migration 395's own
          // comment already documents this as the intended single source of truth
          // ("the calculator system reads uts_mpa specifically, not the legacy
          // column"), but this resolver kept reading the legacy columns directly,
          // so a row whose uts_mpa was deliberately set to a different, more
          // current value than its legacy ultimate_tensile_strength (~25 rows
          // predating migration 395's backfill) was silently ignored. Falling back
          // to the legacy column keeps every already-synced row (511/511 after
          // migration 395) numerically identical to today's behavior.
          const shearStrengthMpa = (row.shear_strength_mpa as number | null) ?? (row.shearing_strength as number | null);
          const utsMpa = (row.uts_mpa as number | null) ?? (row.ultimate_tensile_strength as number | null);
          return { shape: (row.shape as string | null) ?? null, locCost, indiaCost, densityKgM3, shearStrengthMpa, utsMpa };
        });

        // Density and cost are independent facts about a material row — a
        // PENDING_REVIEW row (real, verified density; cost intentionally left
        // NULL because no verified quote exists) must still power weight/
        // tonnage calculations from its real density. Requiring cost>0 here
        // discarded the whole row, silently zeroing density too and reporting
        // "material not found" for a material that DOES exist in the DB.
        const withDensity = rows
          .filter((r) => r.densityKgM3 != null && r.densityKgM3 > 0)
          .sort((a, b) => shapeRankForFamily(a.shape, family) - shapeRankForFamily(b.shape, family));
        const withCost = withDensity.filter(
          (r) => (r.locCost != null && r.locCost > 0) || (r.indiaCost != null && r.indiaCost > 0),
        );
        const best = withCost[0] ?? withDensity[0];

        if (best) {
          if (isDiscouragedShapeForFamily(best.shape, family)) {
            warnings.push(
              `Material priced from "${best.shape}" stock — no ${family.replace(/_/g, ' ')}-appropriate product form found for "${grade}" in raw materials. Verify the cost/kg before quoting.`,
            );
          }
          const hasCost = (best.locCost != null && best.locCost > 0) || (best.indiaCost != null && best.indiaCost > 0);
          if (!hasCost) {
            warnings.push(
              `Material "${grade}" found in raw_materials with verified density, but no verified cost ` +
              `(pending review) — weight/tonnage use its real density; material cost shows as $0 until a cost is added.`,
            );
          }
          const hasUts = best.utsMpa != null && best.utsMpa > 0 && best.shearStrengthMpa != null && best.shearStrengthMpa > 0;
          const familyUts = hasUts ? null : resolveUtsMpa(grade);
          if (!hasUts) {
            warnings.push(
              familyUts != null
                ? `Material "${grade}" found in raw_materials, but no verified UTS/shear strength — using the approved ${grade} family UTS (${familyUts} MPa) for press-brake tonnage. Shear strength has no approved-family table, so it is unavailable and turret-punch tonnage checks are skipped until verified values are added.`
                : `Material "${grade}" found in raw_materials, but no verified UTS/shear strength, and the grade matches no approved material family either — press-brake tonnage, turret-punch tonnage, and UTS-dependent DFM checks are skipped until verified values are added.`,
            );
          }
          return {
            materialCostPerKg: hasCost
              ? (best.locCost != null && best.locCost > 0 ? best.locCost : (best.indiaCost as number) * rates.convertStrict('INR', locCurrencyCode))
              : 0,
            materialDensityKgM3: best.densityKgM3 as number,
            materialSource: 'db',
            utsMpa: hasUts ? (best.utsMpa as number) : familyUts,
            shearStrengthMpa: hasUts ? (best.shearStrengthMpa as number) : null,
            utsSource: hasUts ? 'db' : (familyUts != null ? 'family_default' : 'unavailable'),
          };
        }
      } catch {
        // fall through to named defaults below
      }
    }

    // No DB match — warn and return zero for both cost and density. A "mild steel"
    // density default here would silently fabricate a weight for a material that
    // was never actually looked up (e.g. this exact bug: a honeycomb material with
    // real density 50 kg/m³ falling through to a 7850 kg/m³ steel assumption — a
    // ~150x error with no indication anything was wrong). materialDensityKgM3 = 0
    // correctly gates hasValidDimensions downstream to false, so weight/nesting
    // are skipped entirely rather than computed from an invented number.
    const notFoundFamilyUts = resolveUtsMpa(grade);
    warnings.push(
      `Material "${grade ?? 'unknown'}" not found in raw_materials database — material cost and weight are $0/0kg. ` +
      (notFoundFamilyUts != null
        ? `Press-brake tonnage uses the approved ${grade} family UTS (${notFoundFamilyUts} MPa); shear strength has no approved-family table, so it is unavailable and turret-punch tonnage checks are skipped. `
        : `The grade also matches no approved material family, so press-brake tonnage, turret-punch tonnage, and UTS-dependent DFM checks are all skipped. `) +
      `Add the material to the raw materials table to quote accurately.`,
    );
    return {
      materialCostPerKg: 0,
      materialDensityKgM3: 0,
      materialSource: 'default',
      utsMpa: notFoundFamilyUts,
      shearStrengthMpa: null,
      utsSource: notFoundFamilyUts != null ? 'family_default' : 'unavailable',
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

  // MHR/LHR plausibility-guard thresholds are business/costing POLICY, not an
  // algorithmic constant — read once per request from `costing_settings`
  // (migration 473), the SAME table/convention cost-aggregation.service.ts
  // and location-comparison.service.ts already use for sga_pct/profit_pct.
  // Falls back to DEFAULT_RATE_WARN_THRESHOLDS with a disclosed warning only
  // if the table is empty — identical convention to SGA/profit's own fallback.
  private async loadRateWarnThresholds(accessToken: string, warnings: string[]): Promise<RateWarnThresholds> {
    try {
      const { data } = await this.supabaseService
        .getClient(accessToken)
        .from('costing_settings')
        .select('key, value')
        .in('key', ['rate_warn_low_fraction', 'rate_warn_high_fraction']);

      const settingsMap = new Map<string, number>();
      for (const row of data ?? []) settingsMap.set(row.key as string, Number(row.value));

      const lowFraction = settingsMap.get('rate_warn_low_fraction');
      const highFraction = settingsMap.get('rate_warn_high_fraction');
      if (lowFraction == null || highFraction == null) {
        warnings.push(
          'rate_warn_low_fraction/rate_warn_high_fraction not found in costing_settings — using built-in defaults (50%/300%); deploy migration 473 to make these configurable.',
        );
        return DEFAULT_RATE_WARN_THRESHOLDS;
      }
      return { lowFraction, highFraction };
    } catch {
      warnings.push('costing_settings unavailable — MHR/LHR plausibility thresholds using built-in defaults (50%/300%).');
      return DEFAULT_RATE_WARN_THRESHOLDS;
    }
  }

  // Surface implausible DB rates (broken imports — the migration-327 bug class)
  // and benchmark-priced lines on the summary. Never clamps: the MHR DB stays
  // authoritative, but a rate 50%+ off the location benchmark must be visible
  // on the document a quote is read from, not only in a machine-detail popup.
  private appendRateWarnings(
    result: { processLines: ProcessLineCost[]; warnings: string[] },
    location: string,
    benchmarkMap?: Map<string, number>,
    thresholds: RateWarnThresholds = DEFAULT_RATE_WARN_THRESHOLDS,
  ): void {
    const seen = new Set<string>();
    const benchmarkPriced: string[] = [];
    const benchmarkOverridden: string[] = [];
    // Distinct from benchmarkPriced: these lines have NO rate at all (no machine,
    // no benchmark) — cost is a genuine $0, not something "priced" at any rate.
    // Must never be folded into the benchmarkPriced message below, which claims
    // benchmark pricing was applied.
    const noRateOnFile: string[] = [];
    for (const line of result.processLines) {
      const key = `${line.machineClass}:${line.hourlyRate}:${line.rateSource}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (line.rateSource === 'mhr_database') {
        const warning = benchmarkRateWarning(line.machineClass, location, line.hourlyRate, line.machineName, benchmarkMap?.get(line.machineClass), thresholds);
        if (warning && !result.warnings.includes(warning)) result.warnings.push(warning);
      } else if (line.rateSource === 'benchmark_override') {
        // DB rate was anomalously low (< 50% of benchmark) — overridden to location benchmark.
        // Surface as a single consolidated info note, not per-line noise.
        benchmarkOverridden.push(line.machineClass.replace(/_/g, ' '));
      } else if (line.rateSource === 'no_db_rate') {
        noRateOnFile.push(line.machineClass.replace(/_/g, ' '));
      } else if (line.rateSource !== 'tier_synthetic') {
        // 'tier_synthetic' = route comparison benchmark slot with no DB machine — expected, suppress
        benchmarkPriced.push(line.machineClass.replace(/_/g, ' '));
      }
    }
    if (benchmarkOverridden.length > 0) {
      result.warnings.push(
        `Using ${location} benchmark MHR rates for: ${[...new Set(benchmarkOverridden)].join(', ')} — ` +
        `DB rates were more than 50% below benchmark (likely entered for a different region). ` +
        `Verify MHR records for ${location} to quote on actual shop rates.`,
      );
    }
    if (benchmarkPriced.length > 0) {
      result.warnings.push(
        `No capable MHR machine on file in ${location} for: ${[...new Set(benchmarkPriced)].join(', ')} — ` +
        `priced at ${location} benchmark rates. Import MHR records for ${location} to quote on actual equipment.`,
      );
    }
    if (noRateOnFile.length > 0) {
      result.warnings.push(
        `No MHR machine or benchmark rate on file in ${location} for: ${[...new Set(noRateOnFile)].join(', ')} — ` +
        `these process costs are $0. Add an MHR record or a ${location} benchmark rate to quote on them.`,
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

    // ── Blank area: CAD-measured flat pattern is the source of truth ─────────
    // For a bent sheet metal part, flat_pattern_area > volume÷thickness is always
    // expected: unfolding bends adds material length at the neutral axis. Never
    // override a valid CAD measurement with the lower-accuracy reconstruction.
    // Reconstruction (volume÷thickness) is used ONLY when no CAD data exists.
    let flatPatternAreaMm2 = args.flatPatternAreaMm2;
    let blankAreaSource: 'cad' | 'reconstructed' = 'cad';
    const volumeMm3 = Number(args.item.volume ?? 0) || 0;
    if (flatPatternAreaMm2 === 0 && volumeMm3 > 0 && args.sheetThicknessMm > 0) {
      // No CAD flat pattern: estimate from volume. For bent parts this
      // underestimates because it ignores bend allowance — flag it.
      flatPatternAreaMm2 = volumeMm3 / args.sheetThicknessMm;
      blankAreaSource = 'reconstructed';
      warnings.push(
        `Flat pattern area estimated from CAD volume ÷ thickness ` +
          `(${Math.round(flatPatternAreaMm2).toLocaleString()} mm²) — ` +
          `re-run geometry analysis for the true unfolded blank area`,
      );
    }

    return { bendCount, bendSource, flatPatternAreaMm2, blankAreaSource, warnings };
  }

  // ── eMithran-style feature-level breakdown helpers ─────────────────────────────

  /** Convert raw operation-sequencer output into grouped FeatureOp[] for the UI. */
  private buildCNCFeatureBreakdown(featureOps: OperationLine[]): FeatureOp[] {
    const excluded = new Set(['Face Mill', 'Deburr']);
    type Acc = { timeSec: number; instanceCount: number };
    const groups = new Map<string, Acc>();

    for (const op of featureOps) {
      if (excluded.has(op.name)) continue;
      // Collapse the 3-line pocket family and 2-line slot family into one entry each
      let key = op.name;
      if (op.name.startsWith('Pocket')) key = 'Pocket Mill';
      else if (op.name.startsWith('Slot')) key = 'Slot Mill';
      else if (op.name === 'Rigid Tap') key = 'Tapping';
      const g = groups.get(key);
      if (g) { g.timeSec += op.timeSec; g.instanceCount++; }
      else groups.set(key, { timeSec: op.timeSec, instanceCount: 1 });
    }

    const result: FeatureOp[] = [];
    for (const [key, { timeSec }] of groups) {
      // Infer count from fixed unit times where possible (Spot Drill=5s, Chamfer=4-5s)
      let count = 1;
      if (key === 'Spot Drill') count = Math.max(1, Math.round(timeSec / 5));
      else if (key === 'Chamfer') count = Math.max(1, Math.round(timeSec / 4.5));
      const label = count > 1 ? `${key} ×${count}` : key;
      result.push({ name: label, timeSec: Math.round(timeSec), featureType: key.toLowerCase().replace(/\s+/g, '_'), count });
    }
    return result;
  }

  /**
   * Build Laser Cutting feature breakdown from sheet metal geometry inputs.
   *
   * Uses the same resolved laserParams (power + material + thickness aware,
   * from sm_lookup_laser_cut) that computeCostSummary already used for the
   * dollar cost — so the displayed "why" breakdown and the cycle time driving
   * the total always agree. There is deliberately no fallback branch: a
   * caller passing laserParams with dataFound=false (or omitting it) means
   * the real lookup did not resolve, and this must show that honestly (0,
   * matching the process line's own $0/gap state) rather than compute a
   * plausible-looking sub-time from a generic, power-blind thickness table.
   * Confirmed live bug this replaced: a caller passed the resolver's zeroed
   * placeholder object (cuttingSpeedMPerMin: 0, dataFound: false — e.g. for
   * "Quattro", whose real laser power is unverified) straight through; the
   * old `if (laserParams)` truthy-check treated that placeholder as resolved
   * data and divided cutLengthMm by a speed of 0, producing Infinity/NaN
   * silently rendered as "0.0 min" — looking like a fast, real result
   * instead of the missing-data gap it actually was.
   */
  private buildLaserFeatureBreakdown(
    cutLengthMm: number,
    pierceCount: number,
    laserParams?: LaserCutParams | null,
  ): FeatureOp[] {
    const resolved = !!laserParams?.dataFound;
    const result: FeatureOp[] = [];
    if (cutLengthMm > 0) {
      const cuttingTimeSec = resolved ? (cutLengthMm / (laserParams!.cuttingSpeedMPerMin * 1000)) * 60 : 0;
      result.push({ name: `Cut path ${(cutLengthMm / 1000).toFixed(2)}m`, timeSec: Math.round(cuttingTimeSec * 10) / 10, featureType: 'laser_cut', count: 1 });
    }
    if (pierceCount > 0) {
      const pierceSec = resolved ? laserParams!.pierceTimeMin * 60 * pierceCount : 0;
      result.push({ name: `Pierces ×${pierceCount}`, timeSec: Math.round(pierceSec * 10) / 10, featureType: 'pierce', count: pierceCount });
    }
    return result;
  }

  /**
   * Build Press Brake feature breakdown from bend count and radii.
   *
   * Uses the same resolved per-bend stroke time (strokePerBendSec, from
   * sm_lookup_manual_stroke) that computeCostSummary already used for the dollar
   * cost — so the displayed "why" breakdown and the cycle time driving the total
   * always agree. Deliberately no fallback branch: strokePerBendSec is null
   * exactly when the real lookup didn't resolve (the caller already gates on
   * smStrokeResult.dataFound), and this must show that honestly (0, matching
   * the process line's own $0/gap state) rather than compute a plausible-
   * looking per-bend time from a generic, unvalidated thickness table.
   *
   * Includes the per-part load/unload handling time as its own line — cost-
   * engine.ts's pressBrakeMin total is stroke time + handlingTimeMin*60, so
   * without this the sum of the visible rows fell short of the displayed
   * total cycle time by exactly the handling time, looking like the numbers
   * didn't add up (they did; the breakdown just hid one real component).
   */
  private buildPressBrakeFeatureBreakdown(
    bendCount: number,
    bendRadii: number[],
    strokePerBendSec?: number | null,
    handlingTimeMin?: number | null,
  ): FeatureOp[] {
    if (bendCount <= 0) return [];
    const secPerBend = strokePerBendSec ?? 0;

    const bendRows: FeatureOp[] = bendRadii.length === 0
      ? [{ name: `Bends ×${bendCount}`, timeSec: Math.round(bendCount * secPerBend), featureType: 'bend', count: bendCount }]
      : (() => {
          // Group by radius (0.5mm buckets)
          const groups = new Map<number, number>();
          for (const r of bendRadii) {
            const rBucket = Math.round(r * 2) / 2;
            groups.set(rBucket, (groups.get(rBucket) ?? 0) + 1);
          }
          return [...groups.entries()].map(([radius, count]) => ({
            name: `Bend R${radius}mm ×${count}`,
            timeSec: Math.round(count * secPerBend),
            featureType: 'bend',
            count,
          }));
        })();

    if (handlingTimeMin != null && handlingTimeMin > 0) {
      bendRows.push({
        name: 'Load/Unload',
        timeSec: Math.round(handlingTimeMin * 60),
        featureType: 'handling',
        count: 1,
      });
    }
    return bendRows;
  }

  /**
   * Build Deburring feature breakdown from cut edge length and pierce count.
   *
   * Uses the exact same DEBURR_SEC_PER_METRE/DEBURR_SEC_PER_PIERCE constants
   * that computeCostSummary already used for the dollar cost, so the
   * displayed "why" breakdown and the cycle time driving the total always
   * agree. Method is always vibratory finishing — the only deburr method this
   * engine currently prices (no distinct manual/tumbling formula exists).
   */
  private buildDeburrFeatureBreakdown(cutLengthMm: number, pierceCount: number): FeatureOp[] {
    const result: FeatureOp[] = [];
    if (cutLengthMm > 0) {
      const timeSec = (cutLengthMm / 1000) * DEBURR_SEC_PER_METRE;
      result.push({
        name: `Edge length ${(cutLengthMm / 1000).toFixed(2)}m (vibratory, ${DEBURR_SEC_PER_METRE} sec/m)`,
        timeSec: Math.round(timeSec),
        featureType: 'deburr_edge',
        count: 1,
      });
    }
    if (pierceCount > 0) {
      const timeSec = pierceCount * DEBURR_SEC_PER_PIERCE;
      result.push({
        name: `Pierce cleanup ×${pierceCount}`,
        timeSec: Math.round(timeSec),
        featureType: 'deburr_pierce',
        count: pierceCount,
      });
    }
    return result;
  }

  // Build PEM Insertion feature breakdown from the resolved sm_lookup_pem_hardware
  // matches per hole-diameter group — same match data smPemCount/smPemTotalSecSum
  // above are already built from, just surfaced as named rows instead of only a
  // summed total. This is what lets the standalone Calculator dialog (opened via
  // the cycle-time icon on a saved PEM Insertion line) pre-fill "Insertion Cycle
  // Time" / "No. of Insertions" from the real match instead of the calculator
  // schema's blank/"1" placeholder — see ProcessCostDialog.tsx's featureBreakdown
  // read for the precedent (Inspection calculator does the same from its own
  // per-feature-type rows).
  private buildPemFeatureBreakdown(
    throughHoleGroups: Array<{ diameter_mm: number; count: number }>,
    pemResolved: Map<number, { partSpec: string; insertionCycleSec: number } | null>,
  ): FeatureOp[] {
    const result: FeatureOp[] = [];
    for (const g of throughHoleGroups) {
      const match = pemResolved.get(g.diameter_mm);
      if (!match) continue;
      result.push({
        name: `${match.partSpec} ×${g.count} (Ø${g.diameter_mm}mm, ${match.insertionCycleSec}s/insertion)`,
        timeSec: Math.round(g.count * match.insertionCycleSec),
        featureType: 'pem_insertion',
        count: g.count,
      });
    }
    return result;
  }

  /**
   * Build Tapping feature breakdown from resolved thread groups, using the
   * exact same computeTapCycleSec() physics that computeCostSummary already
   * used for the dollar cost — so the displayed breakdown and the cycle time
   * driving the total always agree. One row per thread-size group (naming the
   * real detected size/qty/depth so it's clear why the operation exists), plus
   * a single operation-level Unload row. depth is labelled "(assumed)" when no
   * real depth was extracted (drawing-OCR'd threads never carry depth).
   */
  private buildTappingFeatureBreakdown(
    threads: Array<{ size: string; count: number; pitchMm?: number; depthMm?: number; isThrough?: boolean }>,
    sheetThicknessMm: number,
    materialGrade: string | null,
  ): FeatureOp[] {
    if (threads.length === 0) return [];
    const fallbackDepthMm = sheetThicknessMm > 0 ? sheetThicknessMm : 3;
    const result: FeatureOp[] = [];
    for (const t of threads) {
      const b = computeTapCycleSec(t.size, t.count, t.pitchMm, t.depthMm, fallbackDepthMm, materialGrade);
      const pitchLabel = b.pitchMm ? `×${b.pitchMm}` : '';
      const depthLabel = `${b.depthMm}mm${b.depthIsAssumed ? ' assumed' : ''}`;
      const throughLabel = t.isThrough === true ? ', thru' : t.isThrough === false ? ', blind' : '';
      result.push({
        name: `${t.size}${pitchLabel} ×${t.count} (depth ${depthLabel}${throughLabel}, ${b.materialFamily} @ ${b.surfaceSpeedMMin}m/min)`,
        timeSec: Math.round(b.perHoleSec * t.count),
        featureType: 'tap',
        count: t.count,
      });
    }
    // Tool change is charged once per distinct thread-size group inside
    // computeTapCycleSec()'s totalSec but not inside perHoleSec — surface it
    // as its own row per group so the breakdown sums to the real total.
    for (const t of threads) {
      const b = computeTapCycleSec(t.size, t.count, t.pitchMm, t.depthMm, fallbackDepthMm, materialGrade);
      result.push({
        name: `${t.size} tool change`,
        timeSec: Math.round(b.toolChangeSec),
        featureType: 'tap_tool_change',
        count: 1,
      });
    }
    result.push({ name: 'Unload', timeSec: Math.round(TAP_UNLOAD_SEC), featureType: 'tap_unload', count: 1 });
    return result;
  }

  /**
   * Real (true-shape) nest as the material-costing source of truth, when a
   * real flat-pattern outline exists for this part. Evaluates EVERY viable
   * standard sheet size (STANDARD_SHEETS, shared with sheet-metal-nesting.
   * engine.ts's rectangle-grid fallback) via cad-engine's real true-shape
   * nest, and selects the winner by lowest gross weight/part (laser_cutting_
   * costing_params.md §6a, via true-nest-costing.engine.ts) -- NEVER
   * pre-filtered by the rectangle-grid's own ranking, since a smaller sheet
   * can genuinely interlock an irregular part better than a larger one
   * packs its bounding rectangle.
   *
   * Deterministic by construction: on a cache miss, every candidate is
   * evaluated and the winner cached SYNCHRONOUSLY, before this method
   * returns -- there is no "return an interim answer, upgrade it later"
   * path. Costing is a financial calculation; the same inputs (geometry +
   * kerf + edge margin) always produce the same result whether this is the
   * very first request or the hundredth. A real cad-engine call is slow
   * (10-20s+ per candidate for small-part/large-sheet cases, up to 5
   * candidates), so this request legitimately blocks for that long on a
   * cache miss -- costing correctness matters more than this one request's
   * latency, and the result is cached for every request after it.
   *
   * Returns { selection: null, reason } (never a fabricated/estimated
   * result) when no real outline exists yet, or every candidate sheet
   * genuinely failed -- the caller falls back to rectangle-grid and
   * discloses this via nestingMethod/nestingFallbackReason, never silently.
   */
  async resolveTrueShapeNestCosting(
    itemId: string,
    summary: any,
    netWeightKg: number,
    densityKgM3: number,
    thicknessMm: number,
    kerfMm: number,
    edgeMarginMm: number,
    userId: string,
    accessToken: string,
  ): Promise<{ selection: TrueNestCostingSelection; reason?: undefined } | { selection: null; reason: string }> {
    const outlinePointsMm = summary?.flatPatternOutlinePointsMm;
    if (!Array.isArray(outlinePointsMm) || outlinePointsMm.length < 3) {
      return { selection: null, reason: "no real flat-pattern outline available for this part yet -- re-run Reanalyze" };
    }

    const cache = summary?.trueNestCostingCache;
    if (isTrueNestCostingCacheValid(cache, kerfMm, edgeMarginMm)) {
      return {
        selection: {
          sheetWidthMm: cache.sheetWidthMm, sheetLengthMm: cache.sheetLengthMm,
          partsPerSheet: cache.partsPerSheet, sheetWeightKg: cache.sheetWeightKg,
          grossWeightPerPartKg: cache.grossWeightPerPartKg, utilisationPct: cache.utilizationPct,
        },
      };
    }

    const holesMmRaw: Array<{ cx_mm: number; cy_mm: number; diameter_mm: number }> =
      Array.isArray(summary.flatPatternHolesMm) ? summary.flatPatternHolesMm : [];
    const holesMm = holesMmRaw.map((h) => ({ cxMm: h.cx_mm, cyMm: h.cy_mm, diameterMm: h.diameter_mm }));

    // Evaluate EVERY viable candidate sheet -- sequentially (cad-engine's
    // /nest endpoint is not thread-pool-wrapped, see cad-engine/main.py, so
    // concurrent calls would serialize on its single event loop anyway) and
    // synchronously (this request blocks until the full comparison is done
    // -- see this method's own doc comment for why that's correct here).
    const candidates: TrueNestCandidate[] = [];
    const perCandidateReasons: string[] = [];
    for (const [w, l] of STANDARD_SHEETS) {
      const { result, reason } = await this.cadAnalysisService.computeTrueNest({
        outlinePointsMm, holesMm, sheetWidthMm: w, sheetLengthMm: l,
        quantity: 1, // partsPerSheet/utilization are quantity-independent -- see nesting.py
        kerfMm, edgeMarginMm,
      });
      if (result && result.partsPerSheet > 0) {
        const sheetWeightKg = (w * l * thicknessMm / 1e9) * densityKgM3;
        candidates.push({ sheetWidthMm: w, sheetLengthMm: l, partsPerSheet: result.partsPerSheet, sheetWeightKg });
      } else {
        perCandidateReasons.push(`${w}x${l}mm: ${reason}`);
      }
    }

    const best = selectBestTrueNestCandidate(candidates, netWeightKg);
    if (!best) {
      return {
        selection: null,
        reason: `true-shape nest failed for every candidate standard sheet -- ${perCandidateReasons.join('; ')}`,
      };
    }

    // Persist BEFORE returning -- this is what makes the result
    // deterministic for every subsequent request, not just an optimization.
    const fresh = await this.findOne(itemId, userId, accessToken);
    const freshFg = (fresh.featureGraph as any) ?? {};
    const freshSummary = freshFg.summary ?? {};
    await this.update(itemId, {
      featureGraph: {
        ...freshFg,
        summary: {
          ...freshSummary,
          trueNestCostingCache: {
            sheetWidthMm: best.sheetWidthMm, sheetLengthMm: best.sheetLengthMm,
            kerfMm, edgeMarginMm,
            partsPerSheet: best.partsPerSheet, utilizationPct: best.utilisationPct,
            sheetWeightKg: best.sheetWeightKg, grossWeightPerPartKg: best.grossWeightPerPartKg,
            cachedAt: new Date().toISOString(),
          },
        },
      },
    }, userId, accessToken);
    this.logger.log(
      `[true-nest-costing] selected ${best.sheetWidthMm}x${best.sheetLengthMm}mm: ${best.partsPerSheet} parts/sheet, ` +
      `${best.utilisationPct}% utilization for item ${itemId} (${candidates.length}/${STANDARD_SHEETS.length} candidates viable)`,
    );
    return { selection: best };
  }

  // The single exact wording surfaced to the user (RawMaterialDialog's
  // "Gross Usage" calculator panel) whenever true-shape nesting genuinely
  // can't run -- never a rectangle-grid number or a scrap%-derived guess
  // dressed up as this calculator's own result. getCostSummary()'s separate,
  // pre-existing rectangle-grid fallback (nestingMethod:
  // 'rectangle_grid_fallback') is untouched and remains its own, differently
  // labeled path -- this calculator represents the true-shape half only.
  static readonly GROSS_USAGE_GAP_REASON =
    'Unable to calculate true-shape gross usage — verified flat pattern required';

  /**
   * "Sheet Metal - Gross Material Usage (Nesting)" calculator's physics_key
   * implementation -- called from both evaluateCalculatorFields() (the
   * cost-engine/getCostSummary path, via resolvePhysicsQuantity) and
   * CalculatorsServiceV2.execute() (the interactive "Calculate" button in
   * RawMaterialDialog). Both paths share this single implementation so they
   * can never drift. Inputs are the calculator's own editable field_names
   * (Thickness, Shear Strength, Net Weight Per Part, Material Density, Edge
   * Allowance, Batch Quantity) -- the real flat-pattern outline is NOT one
   * of them (see the calculator's own field-verification notes): it's read
   * here directly off the bound BOM item's stored CAD summary, since a
   * polygon outline isn't a value a calculator form can hold as a scalar.
   */
  async resolveGrossUsageForCalculator(
    inputValues: Record<string, any>,
    ctx: { itemId?: string; userId: string; accessToken: string },
  ): Promise<Record<string, any>> {
    const GAP_REASON = BOMItemsService.GROSS_USAGE_GAP_REASON;
    if (!ctx.itemId) return { _gapReason: GAP_REASON };

    const thicknessMm = Number(inputValues['Thickness'] ?? 0);
    // 'Shear Strength' is no longer consumed here — nesting spacing now uses
    // a fixed laser-based default (closeout Plan Phase 3, see
    // computePartAllowanceMm's own doc comment) instead of the old shear-
    // strength-scaled formula. Flagged, not silently dropped: this input
    // field is still configured on the Gross Usage calculator and now has
    // no real consumer — see feedback_calculator_input_honesty.
    const netWeightKg = Number(inputValues['Net Weight Per Part'] ?? 0);
    const densityKgM3 = Number(inputValues['Material Density'] ?? 0);
    const edgeMarginMm = inputValues['Edge Allowance'] != null ? Number(inputValues['Edge Allowance']) : EDGE_ALLOWANCE_MM;
    const batchQuantity = inputValues['Batch Quantity'] != null ? Number(inputValues['Batch Quantity']) : undefined;
    if (thicknessMm <= 0 || netWeightKg <= 0 || densityKgM3 <= 0) {
      return { _gapReason: GAP_REASON };
    }

    const item = await this.findOne(ctx.itemId, ctx.userId, ctx.accessToken);
    const summary = ((item.featureGraph as any)?.summary) ?? {};

    const kerfMm = computePartAllowanceMm(thicknessMm);
    const trueShape = await this.resolveTrueShapeNestCosting(
      ctx.itemId, summary, netWeightKg, densityKgM3, thicknessMm,
      kerfMm, edgeMarginMm, ctx.userId, ctx.accessToken,
    );
    if (!trueShape.selection) {
      return { _gapReason: GAP_REASON, _internalReason: trueShape.reason };
    }

    const best = trueShape.selection;
    const scrapWeightPerPartKg = Math.max(0, best.grossWeightPerPartKg - netWeightKg);
    const result: Record<string, any> = {
      'Nest Method': 'True Shape',
      'Part To Part Allowance': Math.round(kerfMm * 100) / 100,
      'Selected Sheet Width': best.sheetWidthMm,
      'Selected Sheet Length': best.sheetLengthMm,
      'Parts Per Sheet': best.partsPerSheet,
      'Sheet Weight': Math.round(best.sheetWeightKg * 1000) / 1000,
      'Gross Weight Per Part': Math.round(best.grossWeightPerPartKg * 1000) / 1000,
      'Scrap Weight Per Part': Math.round(scrapWeightPerPartKg * 1000) / 1000,
      'Utilisation': best.utilisationPct,
    };
    if (typeof batchQuantity === 'number' && batchQuantity > 0) {
      const sheetsRequired = Math.ceil(batchQuantity / best.partsPerSheet);
      result['Sheets Required'] = sheetsRequired;
      result['Planned Parts'] = best.partsPerSheet * sheetsRequired;
      result['Excess Positions'] = best.partsPerSheet * sheetsRequired - batchQuantity;
      result['Actual Batch Gross Material'] = Math.round(sheetsRequired * best.sheetWeightKg * 1000) / 1000;
    }
    return result;
  }

  async getCostSummary(
    id: string,
    userId: string,
    accessToken: string,
    batchSize = 1,
    location: string,
  ): Promise<CostSummaryDto> {
    const item = await this.findOne(id, userId, accessToken);

    const fg = item.featureGraph as any;
    const summary = fg?.summary ?? {};

    const sheetThicknessMm = resolveEffectiveSheetThicknessMm(item.scenarioOverrides, summary.sheetThicknessMm, item.sheetThicknessMm ?? 0);

    // Drawing analysis material always wins — it reads the title block directly.
    // Auto-fill material (from geometry heuristics) is a fallback only.
    // Drawing intelligence returns structured fields: { value, confidence } or plain string.
    const rawDiMaterial = (item.drawingIntelligence as any)?.material;
    const drawingGrade = this.sanitizeDrawingGrade((
      typeof rawDiMaterial === 'string' ? rawDiMaterial :
      rawDiMaterial != null && typeof rawDiMaterial === 'object' ? (rawDiMaterial.value ?? null) :
      null
    ) as string | null);
    const grade = drawingGrade ?? item.materialGrade ?? (item as any).material ?? null;

    // Scenario gate: refuse to cost without a material grade. Silently defaulting to
    // mild steel produces numbers the engineer might quote; a blocked state forces the
    // explicit Apply action and eliminates ambiguous estimates.
    if (!grade) {
      // All money fields below are 0 (no material grade = no scenario to price
      // yet) — nothing to convert, so this response is USD/$ directly, no FX
      // lookup needed. (Once a grade is set, the priced path below normalizes
      // to the scenario's chosen currency, or USD by default — see
      // normalizeCostSummaryToCurrency — but there is nothing to display
      // differently here since every figure is 0 either way.)
      return {
        scenarioReady: false,
        missingInputs: ['materialGrade'],
        materialCost: 0, materialGrade: '', grossWeightKg: 0,
        materialCostPerKg: 0, materialSource: 'default' as const,
        processLines: [], totalProcessCost: 0, totalCost: 0,
        cycleTimes: { laserMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: 0 },
        batchSize, family: 'unknown',
        warnings: [],
        ratesSource: 'none',
        currency: 'USD', currencySymbol: '$', toUsdRate: 1,
        sustainability: {
          netWeightKg: 0, scrapKg: 0, wasteCostInr: 0, materialUtilizationPct: 0,
          materialCo2Kg: 0, materialCo2PerKg: 0, materialCo2Source: 'default' as const,
          processCo2Breakdown: [], totalProcessEnergyKwh: 0, totalProcessCo2Kg: 0,
          totalCo2Kg: 0, co2PerKgPart: 0, co2Contributors: [], recyclabilityPct: 0,
          sustainabilityScore: 0,
          scoreBreakdown: { materialEfficiency: 0, carbonIntensity: 0, recyclability: 0, processEnergy: 0 },
          opportunities: [], factorsSource: 'default',
        },
      } as unknown as CostSummaryDto;
    }

    // Override > material > geometry — one precedence chain for both costing
    // endpoints (see resolveEffectiveFamily).
    const familyResolution = this.resolveEffectiveFamily({ item, fg, grade, sheetThicknessMm });
    const family = familyResolution.family;

    const cutLengthMm = (summary.cutLengthMm ?? item.cutLengthMm ?? 0) as number;
    const pierceCount = (summary.pierceCount ?? item.pierceCount ?? 0) as number;
    const geoBendCount = (summary.bendCount ?? item.bendCount ?? 0) as number;
    const measuredFlatAreaMm2 = (summary.flatPatternAreaMm2 ?? item.flatPatternAreaMm2 ?? 0) as number;
    // Fix 1: For CNC parts, prefer the feature recognizer's breakdown (through + blind holes)
    // over the raw cylinder count from manufacturing_features.holes.count which includes
    // all cylindrical faces (OD steps, groove IDs) — not just machined holes.
    const cncFeatureSummary = fg?.cnc_features?.feature_summary ?? null;
    const holeCount = (
      cncFeatureSummary !== null && (family === 'cnc_milled' || family === 'cnc_turned' || family === 'mill_turn')
        ? ((cncFeatureSummary.through_hole ?? 0) + (cncFeatureSummary.blind_hole ?? 0))
        : (summary.holeCount ?? item.holeCount ?? 0)
    ) as number;
    // Drawing analysis returns threads as [{ spec, count }] or [{ size, count }] — normalise to { size, count }
    const threads = ((item.drawingIntelligence as any)?.threads ?? []).map((t: any) => ({
      size: String(t.size ?? t.spec ?? '').trim(),
      count: Number(t.count) || 1,
      ...(Number(t.pitch) > 0 ? { pitchMm: Number(t.pitch) } : {}),
    })) as Array<{ size: string; count: number; pitchMm?: number }>;

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

    const locInfo = LOCATION_INFO[location] ?? LOCATION_INFO['Other'];
    // One FX snapshot for this whole request — every conversion below (material,
    // each process line, at the final normalizeCostSummaryToCurrency call) uses
    // these exact rates, never a re-fetched/possibly-different one mid-request.
    // (Only used as the budget-rate fallback when no scenario FX snapshot
    // applies — see resolveDisplayCurrency.)
    const rates = await this.exchangeRateService.getSnapshot(accessToken);
    // Placeholder — the real, final currency/toUsdRate is set by
    // normalizeCostSummaryToCurrency right before each return below.
    const currencyMeta = { currency: locInfo.code, currencySymbol: locInfo.symbol, toUsdRate: 1 };

    const materialWarnings: string[] = [];
    if (familyResolution.warning) materialWarnings.push(familyResolution.warning);
    const { materialCostPerKg, materialDensityKgM3, materialSource, utsMpa, shearStrengthMpa } =
      await this.resolveMaterialForFamily({
        accessToken,
        grade,
        family,
        materialCol: locInfo.materialCol,
        rates,
        locCurrencyCode: locInfo.code,
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
            bendLengthsMm: (fg?.summary?.bendLengths ?? []) as number[],
            utsMpa,
            extrudedFlangeCount: fg?.summary?.extrudedFlangeCount ?? 0,
            burlDiameterMm: estimateBurlDiameterMm(threads, (fg?.summary?.holeDiameters ?? []) as number[]),
            cutLengthMm,
            materialShearStrengthMpa: shearStrengthMpa,
          }),
          overrides: await this.fetchMachineOverrides(id, accessToken, location),
        }
      : undefined;

    const rateWarnThresholds = await this.loadRateWarnThresholds(accessToken, materialWarnings);
    const mhrRates = await this.resolveMHRRates(accessToken, location, physics, family, rates, materialWarnings, rateWarnThresholds);

    // Audit trail — non-blocking; costing must never wait on or fail with it
    if (physics) void this.writeSelectionSnapshots(id, accessToken, mhrRates, location);

    if (family === 'cnc_milled' || family === 'cnc_turned' || family === 'mill_turn') {
      const inspectionRules = await this.inspectionKnowledge.getInspectionRules(accessToken);
      const samplingPolicy = await this.resolveSamplingPolicy(item, accessToken);

      // Fix 2: Blank optimizer — select near-net stock (round bar / rectangular bar)
      // instead of bbox billet. Runs async but non-blocking: failure → billet fallback.
      const bbox = {
        length: ((item as any).maxLength ?? 0) as number,
        width:  ((item as any).maxWidth  ?? 0) as number,
        height: ((item as any).maxHeight ?? 0) as number,
      };
      const blankResult = await this.blankOptimizer.selectOptimalBlank(
        bbox,
        (item.volume ?? 0) as number,
        family as 'cnc_milled' | 'cnc_turned' | 'mill_turn',
        accessToken,
      );

      // Fix 3 + 4: Feature-based cycle time from feature_graph_v2.
      // machinabilityRating from cnc_features.material_machinability or raw_materials.
      const matClass = detectMaterialClass(grade);
      const machinabilityRating = (fg?.cnc_features?.material_machinability ?? null) as number | null;
      const machinabilityFactor = machinabilityRating != null ? machinabilityRating / 75 : 1.0;

      // Normalize FGV2 once — auto-fill stores it at root-level (featureGraph.feature_graph_v2)
      // AND it is embedded inside cnc_features. Resolve once and use the single variable
      // everywhere so every consumer is consistent and this fallback chain isn't duplicated.
      const normalizedFGV2 = fg?.feature_graph_v2 ?? fg?.cnc_features?.feature_graph_v2 ?? null;
      const fgv2Features = (normalizedFGV2?.features ?? null) as unknown[] | null;

      // Stage 2 pipeline log — confirms which storage path had the data
      this.logger.debug(
        `[fgv2] root=${fg?.feature_graph_v2 ? 'present' : 'null'} ` +
        `nested=${fg?.cnc_features?.feature_graph_v2 ? 'present' : 'null'} ` +
        `features=${fgv2Features?.length ?? 'null'} ` +
        `cncKeys=${Object.keys(fg?.cnc_features ?? {}).join(',')}`,
      );

      const rawFeatureOps = buildOperationSequence(fgv2Features, matClass, machinabilityFactor);
      // Fix 5: inject drawing intelligence overrides into the operation list
      const allFeatureOps = injectDrawingIntelligence(
        rawFeatureOps,
        item.drawingIntelligence as Record<string, any> | null,
      );

      // Stage 3 pipeline log — confirms what the operation sequencer produced
      this.logger.debug(
        `[ops] count=${allFeatureOps.length} seq=${
          allFeatureOps.length > 0
            ? allFeatureOps.map(o => `${o.name}(${o.timeSec.toFixed(0)}s)`).join('→')
            : 'empty'
        }`,
      );

      // Safety net: if all machining ops (excluding Face Mill + Deburr) sum to < 30s,
      // material_removed_mm3 is missing from the CAD engine response and the feature
      // path would produce a wildly low cycle time. Fall back to bbox formula instead.
      const featureMachiningTimeSec = allFeatureOps
        .filter(o => o.name !== 'Face Mill' && o.name !== 'Deburr')
        .reduce((s, o) => s + o.timeSec, 0);
      const featureOps = (allFeatureOps.length > 0 && featureMachiningTimeSec >= 30)
        ? allFeatureOps
        : undefined;

      // Stage 4 pipeline log — confirms what the cost engine receives
      this.logger.debug(
        `[CNC cost] grade=${grade ?? 'null'} family=${family} blank=${blankResult.sizeLabel} ` +
        `util=${blankResult.utilizationPct?.toFixed(1)}% featureOps=${featureOps?.length ?? 'bbox-fallback'} ` +
        `machiningTimeSec=${featureMachiningTimeSec.toFixed(1)} threads=${JSON.stringify(threads)} ` +
        `surface=${this.resolveSurfaceTreatment(item) ?? 'none'}`,
      );

      const surfaceTreatmentDbRate = await this.resolveSurfaceTreatmentDbRate(
        accessToken,
        classifySurfaceTreatment(this.resolveSurfaceTreatment(item)),
        location,
        rates,
        this.resolveSurfaceTreatment(item),
        (item.surfaceArea ?? 0) as number,
        batchSize,
      );

      const cncProcessIdentities = await this.resolveProcessIdentities(accessToken, [
        mhrRates.cnc3ax.machineClass,
        mhrRates.cnc4ax.machineClass,
        mhrRates.cnc5ax.machineClass,
        mhrRates.cncLathe.machineClass,
        mhrRates.cncLatheLive.machineClass,
        mhrRates.cncMillTurn.machineClass,
        mhrRates.deburring.machineClass,
        mhrRates.inspection.machineClass,
        mhrRates.tapping.machineClass,
      ], family);

      const baseCncInput: Omit<CNCCostInput, 'mhrRate' | 'tappingRate'> = {
        volume: (item.volume ?? 0) as number,
        surfaceArea: (item.surfaceArea ?? 0) as number,
        maxLength: bbox.length,
        maxWidth:  bbox.width,
        maxHeight: bbox.height,
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
        surfaceTreatmentDbRate,
        samplingPerN: this.resolveSamplingPerN(item),
        samplingPolicy,
        gdtFeatures: this.extractGdtFeatures(item, inspectionRules),
        location,
        blankResult,
        machinabilityRating: machinabilityRating ?? undefined,
        featureOps: featureOps,
        processIdentityByMachineClass: cncProcessIdentities,
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
      // Attach eMithran-style feature-level breakdown to the CNC Milling process line
      if (featureOps && featureOps.length > 0) {
        const breakdown = this.buildCNCFeatureBreakdown(featureOps);
        if (breakdown.length > 0) {
          const millLine = cncResult.processLines.find(
            (l) => l.process === 'CNC Milling' || l.process.includes('Milling') || l.process.includes('Turning'),
          );
          if (millLine) millLine.featureBreakdown = breakdown;
        }
      }
      // Inherited tapping runs on the recommended route's machine — surface
      // THAT machine on the Tapping line's selector, not the class default.
      if (mhrRates.tapping.source !== 'mhr_database') {
        const primaryRate = candidateClasses.find((c) => c.cls === recommended.cls)?.rate;
        const tapSelection = this.synthesizeInheritedTappingSelection(primaryRate?.selection);
        for (const line of cncResult.processLines) {
          if (line.process === 'Tapping') line.machineSelection = tapSelection;
        }
      }
      this.appendRateWarnings(cncResult, location, mhrRates.benchmarkMap, rateWarnThresholds);
      this.applyCostOverrides(cncResult, costOverrides);
      if (costOverrides.size > 0) cncResult.costOverrides = Object.fromEntries(costOverrides);
      if (materialDensityKgM3 > 0 && blankResult.billetVolMm3 > 0) {
        const blankGrossKg  = blankResult.billetVolMm3 / 1e9 * materialDensityKgM3;
        const blankNetKg    = ((item as any).weight ?? 0) as number;
        const blankWasteKg  = Math.max(0, blankGrossKg - blankNetKg);
        const blankUtilPct  = blankResult.utilizationPct ??
          (blankGrossKg > 0 ? (blankNetKg / blankGrossKg) * 100 : 0);
        cncResult.blankSpec = {
          form:           blankResult.form as BlankSpecDto['form'],
          sizeLabel:      blankResult.sizeLabel,
          grossWeightKg:  Math.round(blankGrossKg * 1000) / 1000,
          netWeightKg:    Math.round(blankNetKg * 1000) / 1000,
          utilizationPct: Math.round(blankUtilPct * 10) / 10,
          wasteKg:        Math.round(blankWasteKg * 1000) / 1000,
          wasteCost:      this.r2(blankWasteKg * materialCostPerKg),
        };
      }
      return this.normalizeCostSummaryToCurrency(cncResult, rates, locInfo.code, item.scenarioOverrides);
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

      // Wall thickness: prefer CAD-extracted nominal value. When unavailable (0),
      // fall back to the minimum bounding-box dimension — for flat/thin-walled
      // parts like covers and housings this is physically correct. Cap at 20mm
      // so a thick block doesn't misidentify its section height as a wall.
      const cadWallMm = (summary.wallThicknessNominalMm ?? 0) as number;
      const bboxMinMm = imBbox[2] ?? 0;
      const effectiveWallMm = cadWallMm > 0
        ? cadWallMm
        : (bboxMinMm > 0 && bboxMinMm <= 20 ? bboxMinMm : 0);

      const imInput: InjectionMoldingCostInput = {
        volume: (item.volume ?? 0) as number,
        surfaceArea: (item.surfaceArea ?? 0) as number,
        wallThicknessNominalMm: effectiveWallMm,
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
      this.appendRateWarnings(imResult, location, mhrRates.benchmarkMap, rateWarnThresholds);
      this.applyCostOverrides(imResult, costOverrides);
      if (costOverrides.size > 0) imResult.costOverrides = Object.fromEntries(costOverrides);
      return this.normalizeCostSummaryToCurrency(imResult, rates, locInfo.code, item.scenarioOverrides);
    }

    // ── Sheet Metal: pre-resolve lookup tables and run nesting engine ──────────
    // Laser wattage genuinely changes cutting speed (unlike e.g. press-brake
    // tonnage requirement, which is intrinsic to the part, not the machine) —
    // so it must come from whichever machine is ACTUALLY saved for this part's
    // Laser Cut row, not the class-wide "recommended" candidate. A user who
    // manually picks a different-wattage machine via Edit Process Cost expects
    // its real cutting speed, not the default recommendation's.
    // Manufacturing Physics Calculator architecture: laser power is a REAL
    // machine capability (mhr_records.power_kw, populated only from verified
    // OEM/machine data — migration 450) — never a hardcoded class-wide
    // assumption (the old ": 6000" fallback) and never inferred from a
    // machine's name string at calculation time (that regex is a one-time
    // backfill/migration diagnostic only, never a production source — see
    // selector.ts's hydrateCapability, which no longer parses fiber_laser
    // power from names for exactly this reason). No real capability on file
    // for either the saved machine or the class-wide candidate is a genuine
    // MISSING_MACHINE_DATA gap, reported plainly instead of guessing a
    // wattage that has nothing to do with the actual selected machine.
    let smLaserPowerW: number | null = (mhrRates.laser.selection?.balanced?.candidate as any)?.capability?.powerKw
      ? (mhrRates.laser.selection!.balanced.candidate as any).capability.powerKw * 1000
      : null;
    let smLaserMachineName: string | null = (mhrRates.laser.selection?.balanced?.candidate as any)?.machineName ?? mhrRates.laser.machineName ?? null;
    // 'seed' means a real, sourced-but-not-this-unit's-own-verified value
    // (selector.ts's hydrateCapability/MACHINE_CLASS_DEFAULTS convention —
    // e.g. Salvagnini L3-30's power, migration 459: a documented typical
    // config, not this specific unit's nameplate). Tracked separately from
    // smLaserPowerW itself so the calculator can still RUN with it (the
    // user explicitly chose disclosed-estimate-over-blocked for this case)
    // while the resulting cycle time is disclosed as 'derived', never
    // silently 'verified' — never let "the number exists" imply "the
    // number is a verified machine spec."
    let smLaserPowerEstimated = (mhrRates.laser.selection?.balanced?.candidate as any)?.capabilitySource === 'seed';
    // Technology must track the SAME machine smLaserPowerW came from — never
    // the class-wide candidate independently. mhrRates.laser (resolveLaserSlot)
    // picks whichever of fiber_laser/co2_laser has real rate data for this
    // location; the part's actually-SAVED laser machine can be the other
    // technology. Using the class-wide pick's technology while using the
    // saved machine's power is exactly how a real fiber machine (e.g.
    // "Salvagnini L3-30 2KW Fiber") could get silently filtered as if it
    // were co2 (or vice versa) — a real machine's cutting-speed row would
    // never be found, reported as a missing-lookup gap that isn't real.
    let smLaserTechnology: 'fiber' | 'co2' = mhrRates.laser.machineClass === 'co2_laser' ? 'co2' : 'fiber';
    try {
      const client = this.supabaseService.getClient(accessToken);
      const { data: savedLaserRow } = await client
        .from('process_cost_records')
        .select('machine_name, mhr_id')
        .eq('bom_item_id', id)
        .eq('is_active', true)
        .ilike('operation', '%laser%')
        .limit(1)
        .maybeSingle();
      if (savedLaserRow?.mhr_id) {
        const { data: savedMachine } = await client
          .from('mhr_records')
          .select('power_kw, machine_class, capability_source')
          .eq('id', savedLaserRow.mhr_id)
          .maybeSingle();
        const savedPowerKw = savedMachine?.power_kw != null ? Number(savedMachine.power_kw) : null;
        if (savedPowerKw && savedPowerKw > 0) {
          smLaserPowerW = savedPowerKw * 1000;
          smLaserMachineName = savedLaserRow.machine_name ?? smLaserMachineName;
          smLaserPowerEstimated = (savedMachine as any)?.capability_source === 'seed';
        }
        if (savedMachine?.machine_class === 'co2_laser' || savedMachine?.machine_class === 'fiber_laser') {
          smLaserTechnology = savedMachine.machine_class === 'co2_laser' ? 'co2' : 'fiber';
        }
      }
    } catch {
      // No saved row yet (first-time costing), or the machine lookup failed
      // — keep whatever the class-wide candidate above already resolved.
    }
    if (smLaserPowerW == null) {
      materialWarnings.push(
        `MISSING_MACHINE_DATA: real laser power not on file for ` +
        `${smLaserMachineName ? `"${smLaserMachineName}"` : 'the selected laser'} — ` +
        `add a verified power_kw to this machine's mhr_records row to resolve Laser Cut cycle time.`,
      );
    } else if (smLaserPowerEstimated) {
      materialWarnings.push(
        `ESTIMATED (not verified): ${smLaserMachineName ?? 'the selected laser'}'s power ` +
        `(${smLaserPowerW}W) is a disclosed engineering estimate from documented model specs, ` +
        `not a nameplate/PO reading of this specific unit — verify before finalizing this quote.`,
      );
    }

    // Shear strength/UTS: reuse the SAME values resolveMaterialForFamily already
    // resolved above (real raw_materials row, exact-then-tokenized match) —
    // previously this ran a SEPARATE, weaker exact-only query here, meaning
    // tonnage/blank-allowance could silently use a different UTS than the one
    // machine selection just used for the exact same part.
    const smShearStrengthMpa = shearStrengthMpa;
    const smUtsMpa = utsMpa;

    // Scrap recovery credit (~30% of material price) — a distinct concern from
    // shear/UTS, still queried directly since resolveMaterialForFamily doesn't
    // expose cost_india.
    let smScrapPricePerKg = 0;
    try {
      const adminDb = this.supabaseService.getAdminClient();
      const g = (grade ?? '').trim();
      let rmRow: any[] | null = null;
      if (g) {
        ({ data: rmRow } = await adminDb.from('raw_materials').select('cost_india').ilike('material', g).limit(1));
        if (!rmRow?.length) {
          ({ data: rmRow } = await adminDb.from('raw_materials').select('cost_india').ilike('material_grade', g).limit(1));
        }
      }
      if (rmRow?.[0]?.cost_india) smScrapPricePerKg = Number(rmRow[0].cost_india) * 0.30;
    } catch { /* non-fatal — scrap credit stays 0 */ }

    // Determine part complexity from feature graph or item complexity field
    const smComplexityRaw = ((item as any).complexity ?? fg?.summary?.complexity ?? 'medium') as string;
    const smComplexity: 'simple' | 'medium' | 'complex' =
      smComplexityRaw === 'simple' ? 'simple' : smComplexityRaw === 'complex' ? 'complex' : 'medium';
    const lookupComplexity: 'simple' | 'inter' | 'complex' =
      smComplexity === 'simple' ? 'simple' : smComplexity === 'complex' ? 'complex' : 'inter';
    const strokeComplexity: 'simple' | 'complex' =
      smComplexity === 'complex' ? 'complex' : 'simple';

    // Bend length + tonnage for press brake — needed by Table 3A/Table 4
    // lookups AND the "Bending Line Length"/"Selected Tonnage" calculator
    // display. Real per-bend length (longest real bend line — see
    // buildPartRequirements' identical convention) when the cad-engine has
    // it; falls back to the flat-pattern's own overall dimension only when
    // it doesn't (mesh-inference-only parts). Tonnage uses the SAME
    // estimateBendTonnage formula/real UTS that machine selection's
    // pressBrakeRequirement uses — sized to this one longest bend, not
    // summed across bendCount (a brake bends one line at a time).
    const smRealBendLengths = (fg?.summary?.bendLengths ?? []) as number[];
    const smBendLength = smRealBendLengths.length > 0
      ? Math.max(...smRealBendLengths)
      : (bendCount > 0 ? (((item as any).maxLength ?? 200) as number) : 200);
    // 0, not a plausible-looking tonnage guess, when UTS is unavailable (grade
    // matches no approved family) — resolveStrokeLookupTonnage already prefers
    // the selected machine's real capacity over this estimate, so 0 correctly
    // falls through to "no requirement known" rather than fabricating one.
    const smRequiredTonnage = bendCount > 0
      ? Math.ceil(estimateBendTonnage(smUtsMpa, sheetThicknessMm, smBendLength) ?? 0)
      : 0;
    // Stroke time is a property of the MACHINE, not of this one bend's
    // minimum required force — see resolveStrokeLookupTonnage's own doc
    // comment. Uses the selected press brake's real tonnage capacity
    // (mhr_records.max_tonnage, live DB) when machine selection resolved
    // one; falls back to the required-force estimate otherwise.
    const smStrokeTonnage = this.resolveStrokeLookupTonnage(smRequiredTonnage, mhrRates.pressBrake);

    // Resolve all lookup tables in parallel. Each (besides laser, which already carries its
    // own dataFound) now reports whether it found real DB data or fell back to a generic
    // constant — surfaced as a warning below rather than silently blended into the total.
    const [
      smLaserParams,
      smHandlingResult,
      smBrakeSetupResult,
      smStrokeResult,
      smSamplingResult,
      smInspectionResult,
      smOpSetupTimesResult,
      smDeburrRateResult,
      smInspectionOperationDefaults,
      smInspectionRules,
    ] = await Promise.all([
      smLaserPowerW != null
        // Technology (smLaserTechnology, resolved above) tracks the SAME
        // machine smLaserPowerW came from — never the class-wide candidate
        // independently (see that variable's own doc comment for why).
        ? this.smLookup.getLaserParams(grade, sheetThicknessMm, smLaserPowerW, smLaserTechnology)
        // MISSING_MACHINE_DATA — no real power_kw for this machine (warned
        // above). Never guess a wattage to run the query anyway.
        : Promise.resolve({ cuttingSpeedMPerMin: 0, pierceTimeMin: 0, kerfMm: 0, dataFound: false }),
      this.smLookup.getHandlingTime(
        // Use gross weight estimate for handling lookup
        flatPatternAreaMm2 * sheetThicknessMm / 1e9 * materialDensityKgM3 * 1.05,
      ),
      this.smLookup.getToolSetupTime('brake', Math.min(smBendLength, 500)),
      bendCount > 0
        ? this.smLookup.getManualStrokeTimeForPressBrake(sheetThicknessMm, smStrokeTonnage, strokeComplexity, mhrRates.pressBrake.machineName)
        : Promise.resolve({
            secondsPerBend: 0,
            dataFound: true,
            resolution: { table: 'sm_lookup_manual_stroke', policy: 'EXACT_MATCH' as const, queryParams: [], matchedRow: null, nearestRows: [] },
            roundedFromTonnage: null as number | null,
          }),
      this.smLookup.getSamplingRate(batchSize),
      this.smLookup.getInspectionTime(lookupComplexity),
      this.smLookup.getOpSetupTimes(),
      this.smLookup.getDeburrRate(),
      this.smLookup.getInspectionOperationDefaults(),
      this.inspectionKnowledge.getInspectionRules(accessToken),
    ]);
    const smHandlingMin = smHandlingResult.minutes;
    const smBrakeSetupMin = smBrakeSetupResult.minutes;
    const smSamplingRate = smSamplingResult.rate;
    const smInspectionMin = smInspectionResult.minutes;
    // Tapping/counterbore/countersink/PEM/burring/ream setup times — see
    // migration 416. A key absent from the DB table falls back to its own
    // default-rates.ts constant inside cost-engine.ts (disclosed below).
    const smOpSetupMinByOp = {
      tapping:        this.smLookup.resolveOpSetupMin(smOpSetupTimesResult, 'tapping').minutes,
      counterbore:    this.smLookup.resolveOpSetupMin(smOpSetupTimesResult, 'counterbore').minutes,
      countersink:    this.smLookup.resolveOpSetupMin(smOpSetupTimesResult, 'countersink').minutes,
      pem_insertion:  this.smLookup.resolveOpSetupMin(smOpSetupTimesResult, 'pem_insertion').minutes,
      burring:        this.smLookup.resolveOpSetupMin(smOpSetupTimesResult, 'burring').minutes,
      ream:           this.smLookup.resolveOpSetupMin(smOpSetupTimesResult, 'ream').minutes,
    };
    for (const op of ['tapping', 'counterbore', 'countersink', 'pem_insertion', 'burring', 'ream'] as const) {
      if (!smOpSetupTimesResult.dataFound.has(op)) {
        materialWarnings.push(`Setup time for '${op}' from fallback — seed sm_lookup_op_setup_time for this operation.`);
      }
    }
    // Total stroke time across all bends — kept separate from the per-bend value so
    // buildPressBrakeFeatureBreakdown can use the exact same real per-bend figure below.
    const smStrokeTimeSec = smStrokeResult.secondsPerBend * bendCount;

    // Laser cycle time — evaluated from the real "Sheet Metal - Laser Cutting
    // Manufacturing" DB calculator's Cutting Time/Piercing Time/Total Time
    // formulas (the exact same formulas the interactive "Edit Process Cost"
    // calculator dialog runs), seeded with the same real CAD/DB-lookup values
    // resolved above — not re-implemented as a second hardcoded formula in
    // cost-engine.ts. See evaluateCalculatorFields() and cost-engine.ts's
    // Laser Cutting block, which falls back to its own inline arithmetic only
    // if this returns undefined (e.g. laserParams unavailable).
    const smLaserCalc = (cutLengthMm > 0 || pierceCount > 0)
      ? await this.resolvePhysicsQuantity(accessToken, {
          machineClass: 'fiber_laser',
          process: 'Laser Cutting',
          targetFieldNames: ['Total Time'],
          seedScope: {
            'Cutting Length': cutLengthMm,
            'No Of Starts': pierceCount,
            ...(smLaserParams.dataFound ? {
              'Cutting Speed': smLaserParams.cuttingSpeedMPerMin,
              'Piercing Time Per Start': smLaserParams.pierceTimeMin,
            } : {}),
          },
          seedProvenance: {
            'Cutting Length': 'CAD feature extraction — total cut path length',
            'No Of Starts': 'CAD feature extraction — pierce/start count',
            // "estimated" is a deriveConfidence() marker word — a power drawn
            // from disclosed model-spec seed data (not this unit's own
            // verified nameplate) must never let this line read as
            // 'verified' just because a real, sourced row was found for it.
            'Cutting Speed': `sm_lookup_laser_cut — ${grade || 'material'}, ${sheetThicknessMm}mm sheet` +
              (smLaserPowerEstimated ? ` at an ESTIMATED (not verified) machine power` : ''),
            'Piercing Time Per Start': `sm_lookup_laser_cut — same row as Cutting Speed`,
          },
          lookupTableByField: {
            'Cutting Speed': 'sm_lookup_laser_cut',
            'Piercing Time Per Start': 'sm_lookup_laser_cut',
          },
          // When power itself isn't on file, sm_lookup_laser_cut is never
          // even queried (getLaserParams isn't called — see smLaserPowerW's
          // ternary above) — the generic gap template's default "no rows on
          // file for this table" would misreport a genuine upstream
          // MISSING_MACHINE_DATA block (already warned separately) as if it
          // were a table-coverage gap. Supplying the real reason here (still
          // through LookupResolution's own real queryParams field, not a
          // separate ad-hoc string) makes the Calculation Trace panel show
          // the actual blocker instead of a misleading "add a row" message.
          ...(smLaserPowerW == null ? {
            lookupResolutions: {
              'Cutting Speed': {
                table: 'sm_lookup_laser_cut',
                policy: await this.smLookup.resolveLookupPolicy('sm_lookup_laser_cut', 'INTERPOLATE'),
                queryParams: [{
                  column: 'laser_power_w',
                  value: `unknown — ${smLaserMachineName ?? 'the selected laser'} has no verified power_kw on file (never inferred from its name)`,
                }],
                matchedRow: null,
                nearestRows: [],
              },
            },
          } : {}),
        })
      : this.emptyPhysicsResult(['Total Time']);
    const smLaserCycleTimeSec = smLaserCalc.outputs['Total Time'];

    // Press brake cycle/setup time — evaluated from the real "Sheet Metal -
    // Bending Manufacturing" DB calculator's Cycle Time / Setup Time formulas.
    // Migrations 377/443/444 keep this calculator's own formula multiplying
    // by bend count itself: Cycle Time = ({Time Per Stroke} * {No Of Bends})
    // + ({Sheet Loading Time} * 60). 'Time Per Stroke' (renamed from the
    // field's original name 'Stroke Time Per Bend' via an interactive
    // Calculator Builder edit — see migration 443) is therefore fed the RAW,
    // single-bend value (smStrokeResult.secondsPerBend), NOT a pre-multiplied
    // total — the formula itself does the multiplication. 'Shoulder Width' mirrors
    // the same 8×thickness approximation already used just above for
    // smRequiredTonnage, so this evaluation is internally consistent with the
    // tonnage this part was already sized against.
    const smBendCalc = bendCount > 0
      ? await this.resolvePhysicsQuantity(accessToken, {
          machineClass: 'press_brake',
          process: 'Press Brake',
          targetFieldNames: ['Cycle Time', 'Setup Time'],
          seedScope: {
            Thickness: sheetThicknessMm,
            'Bending Line Length': smBendLength,
            'Shoulder Width': 8 * sheetThicknessMm,
            // Omitted entirely (not passed as undefined) when the real stroke-
            // time lookup found no matching row — leaves the formula unable
            // to resolve this symbol, so resolvePhysicsQuantity correctly
            // reports a real LookupGap instead of a guessed number. UTS is
            // omitted the same way when the grade has no verified or approved-
            // family value (P0.7 — no mild-steel 410 MPa fallback here anymore).
            ...(smUtsMpa != null ? { UTS: smUtsMpa } : {}),
            'No Of Bends': bendCount,
            ...(smStrokeResult.dataFound ? { 'Time Per Stroke': smStrokeResult.secondsPerBend } : {}),
            ...(smHandlingResult.dataFound ? { 'Sheet Loading Time': smHandlingMin } : {}),
            ...(smBrakeSetupResult.dataFound ? { 'Tool Loading Time': smBrakeSetupMin } : {}),
            'Lot Size': batchSize,
          },
          seedProvenance: {
            Thickness: 'BOM sheet thickness',
            'Bending Line Length': ((item as any).maxLength != null) ? 'CAD/BOM part geometry — max length' : 'Default (200mm, no CAD length available)',
            'Shoulder Width': 'Approximated as 8× sheet thickness (standard V-die shoulder rule)',
            UTS: 'raw_materials — material grade Ultimate Tensile Strength (verified DB value, or an approved material-family default; omitted when neither is available)',
            'No Of Bends': 'CAD/drawing feature extraction — bend count',
            'Time Per Stroke': this.describeStrokeTimeProvenance(sheetThicknessMm, strokeComplexity, smStrokeResult.resolution, smStrokeResult.roundedFromTonnage),
            'Sheet Loading Time': 'sm_lookup_handling_time — part weight estimate',
            'Tool Loading Time': 'sm_lookup_tool_setup — brake tool length',
            'Lot Size': 'Batch Size entered on this process cost form',
          },
          lookupTableByField: {
            'Time Per Stroke': 'sm_lookup_manual_stroke',
            'Sheet Loading Time': 'sm_lookup_handling_time',
            'Tool Loading Time': 'sm_lookup_tool_setup',
          },
          lookupResolutions: {
            'Time Per Stroke': smStrokeResult.resolution,
          },
        })
      : this.emptyPhysicsResult(['Cycle Time', 'Setup Time']);
    const smBendCycleTimeSec = smBendCalc.outputs['Cycle Time'];
    const smBendSetupTimeMin = smBendCalc.outputs['Setup Time'];

    if (!smHandlingResult.dataFound) {
      materialWarnings.push('Material handling time from fallback — seed sm_lookup_handling_time for accurate estimates.');
    }
    if (!smBrakeSetupResult.dataFound) {
      materialWarnings.push('Press brake tool setup time from fallback — seed sm_lookup_tool_setup for accurate estimates.');
    }
    if (bendCount > 0 && !smStrokeResult.dataFound) {
      materialWarnings.push('Press brake stroke time from fallback — seed sm_lookup_manual_stroke for accurate cycle times.');
    }
    if (!smSamplingResult.dataFound) {
      materialWarnings.push('Inspection sampling rate from fallback — seed sm_lookup_sampling_plan for this batch size.');
    }
    if (!smInspectionResult.dataFound) {
      materialWarnings.push('Per-piece inspection time from fallback — seed sm_lookup_inspection_time for this complexity tier.');
    }
    if (cutLengthMm > 0 && !smDeburrRateResult.dataFound) {
      materialWarnings.push('Deburr cycle-time rate from fallback — seed sm_lookup_deburr_rate for accurate estimates.');
    }

    const smTappingCalc = await this.resolveTappingCycleTimeSec(accessToken, threads, sheetThicknessMm, grade);

    // Deburring — evaluated from the real "Sheet Metal - Deburring" DB
    // calculator's physics-backed 'Total Time' (physics_key='deburring',
    // dispatches to the exact same computeDeburrCycleSec() the interactive
    // popup uses). 'Sec Per Metre'/'Sec Per Pierce' are omitted (not passed
    // as undefined) when sm_lookup_deburr_rate had no real row — the physics
    // function falls back to its own documented default rate in that case,
    // same convention as every other lookup-sourced seed field.
    const smDeburrCalc = (cutLengthMm > 0)
      ? await this.resolvePhysicsQuantity(accessToken, {
          machineClass: 'deburring',
          process: 'Deburring',
          targetFieldNames: ['Total Time'],
          seedScope: {
            'Length Of Cut (mm)': cutLengthMm,
            'No Of Starts': pierceCount,
            ...(smDeburrRateResult.dataFound ? {
              'Sec Per Metre': smDeburrRateResult.secPerMetre,
              'Sec Per Pierce': smDeburrRateResult.secPerPierce,
            } : {}),
          },
          seedProvenance: {
            'Length Of Cut (mm)': 'CAD feature extraction — total cut path length',
            'No Of Starts': 'CAD feature extraction — pierce/start count',
            'Sec Per Metre': 'sm_lookup_deburr_rate — edge deburr rate for this material/process',
            'Sec Per Pierce': 'sm_lookup_deburr_rate — same row as Sec Per Metre',
          },
          lookupTableByField: {
            'Sec Per Metre': 'sm_lookup_deburr_rate',
            'Sec Per Pierce': 'sm_lookup_deburr_rate',
          },
        })
      : this.emptyPhysicsResult(['Total Time']);
    const smDeburrCycleTimeSec = smDeburrCalc.outputs['Total Time'];

    // ── Feature-driven secondary hole operations (counterbore/countersink/PEM) ──
    // Groups come from the CAD engine's counterbore/countersink detection
    // (SheetMetalFeatureExtractor._detect_counterbore_countersink) and the plain
    // through-hole groups (already excludes counterbore/countersink diameters —
    // see sheet-metal-feature-extractor.service.ts::buildHoleFeatures).
    const smCounterboreGroups = (summary.counterboreGroups ?? []) as Array<{ diameter_mm: number; count: number }>;
    const smCountersinkGroups = (summary.countersinkGroups ?? []) as Array<{ diameter_mm: number; count: number }>;
    const smThroughHoleGroups = (summary.holeGroups ?? []) as Array<{ diameter_mm: number; count: number }>;

    const smPemResolved = await this.smLookup.getPemMatches(smThroughHoleGroups.map((g) => g.diameter_mm), sheetThicknessMm);

    // Manufacturing Physics Calculator architecture: Counterboring/
    // Countersinking cycle time comes from the real, registered calculators
    // (migrations 050/051) ONLY — real rigid-drilling physics, not the flat
    // per-diameter sm_lookup_counterbore/sm_lookup_countersink cycle_time_sec
    // this used to read directly. See resolveHoleOperationCycleTimeSec's own
    // doc comment for the real, sourced speed/feed data and each operation's
    // depth-resolution strategy.
    const smCounterboreCount = smCounterboreGroups.reduce((s, g) => s + g.count, 0);
    const smCounterboreCalc = await this.resolveHoleOperationCycleTimeSec(accessToken, smCounterboreGroups, {
      operation: 'Counterboring',
      process: 'Counterboring',
      materialGrade: grade,
      resolveDepthMm: () => ({
        depthMm: sheetThicknessMm > 0 ? sheetThicknessMm : 3,
        provenance: 'Assumed — real counterbore depth not yet CAD-extracted; capped at sheet thickness as a conservative upper bound',
      }),
    });

    const smCountersinkCount = smCountersinkGroups.reduce((s, g) => s + g.count, 0);
    const smCountersinkCalc = await this.resolveHoleOperationCycleTimeSec(accessToken, smCountersinkGroups, {
      operation: 'Countersinking',
      process: 'Countersinking',
      materialGrade: grade,
      speedFactor: COUNTERSINK_SPEED_FACTOR,
      resolveDepthMm: (diameterMm) => {
        // Real cone geometry for a standard 90° included-angle countersink
        // (common ISO/ASME flat-head-screw convention) — no real included
        // angle is CAD-extracted today, so this is the one disclosed
        // assumption; the depth itself is exact geometry, not a guess, once
        // the angle is known.
        const includedAngleDeg = 90;
        const depthMm = (diameterMm / 2) / Math.tan((includedAngleDeg / 2) * (Math.PI / 180));
        return {
          depthMm,
          provenance: `Real cone geometry — Depth = (Diameter/2) / tan(90°/2), standard included angle (no real angle extracted)`,
        };
      },
    });

    // Manufacturing Physics Calculator architecture: PEM insertion time comes
    // from the real "Sheet Metal - PEM Insertion" DB calculator ONLY — the
    // real sm_lookup_pem_hardware match still happens above (recognition:
    // does this hole diameter correspond to a real PEM hardware spec at
    // all?), but the TIME calculation itself (No Of Insertions * Insertion
    // Cycle Time) now goes through the registry/trace pipeline instead of
    // being summed directly in TS. A diameter with no hardware match is
    // simply not a PEM hole — never a reported gap; a gap only means the
    // calculator itself isn't registered for 'pem_press'.
    let smPemCount = 0;
    const smPemPartSpecs: string[] = [];
    let smPemTotalSecSum = 0;
    let smPemCalculatorId: string | null = null;
    let smPemCalculatorVersion: number | null = null;
    let smPemGap: PhysicsGap | null = null;
    let smPemConfidence: ConfidenceLevel = 'verified';
    let smPemAnyResolved = false;
    for (const g of smThroughHoleGroups) {
      const match = smPemResolved.get(g.diameter_mm);
      if (!match) continue;
      smPemCount += g.count;
      smPemPartSpecs.push(match.partSpec);
      const smPemGroupCalc = await this.resolvePhysicsQuantity(accessToken, {
        machineClass: 'pem_press',
        process: 'PEM Insertion',
        targetFieldNames: ['Total Time'],
        seedScope: {
          'Insertion Cycle Time': match.insertionCycleSec,
          'No Of Insertions': g.count,
        },
        seedProvenance: {
          'Insertion Cycle Time': `sm_lookup_pem_hardware — ${match.partSpec}, matched by hole diameter ${g.diameter_mm}mm + sheet thickness`,
          'No Of Insertions': 'CAD feature extraction — hole count for this diameter group',
        },
      });
      smPemCalculatorId = smPemGroupCalc.calculatorId ?? smPemCalculatorId;
      smPemCalculatorVersion = smPemGroupCalc.calculatorVersion ?? smPemCalculatorVersion;
      const groupTotal = smPemGroupCalc.outputs['Total Time'];
      if (typeof groupTotal === 'number' && Number.isFinite(groupTotal)) {
        smPemTotalSecSum += groupTotal;
        smPemAnyResolved = true;
        smPemConfidence = this.combineConfidence(smPemConfidence, smPemGroupCalc.confidence);
      } else if (smPemGroupCalc.gap && !smPemGap) {
        smPemGap = smPemGroupCalc.gap;
      }
    }
    const smPemTotalSec = smPemCalculatorId ? smPemTotalSecSum : undefined;
    if (!smPemAnyResolved) smPemConfidence = 'unsupported';

    // ── Feature-driven hole extrusion (burring) ────────────────────────────────
    // Manufacturing Physics Calculator architecture: wraps the same real
    // physics in the "Sheet Metal - Hole Extrusion (Burring)" DB calculator
    // (migration 052) — estimateBurlTonnage's real forming-force formula
    // stays in TS as real input resolution (same precedent as Press Brake's
    // tonnage calc feeding its own calculator), then sm_lookup_manual_stroke's
    // real per-stroke time is fed in as a seed input (that table has no
    // formula-string-accessible API — a calculator can't query it itself).
    // Burl diameter comes from estimateBurlDiameterMm — single source of
    // truth, also feeds the hole_forming capability requirement in
    // buildPartRequirements.
    const smExtrudedFlangeCount = summary.extrudedFlangeCount ?? 0;
    let smBurlStrokeResult: { secondsPerBend: number; dataFound: boolean; resolution: LookupResolution; roundedFromTonnage: number | null } = {
      secondsPerBend: 0,
      dataFound: true,
      resolution: { table: 'sm_lookup_manual_stroke', policy: 'EXACT_MATCH', queryParams: [], matchedRow: null, nearestRows: [] },
      roundedFromTonnage: null,
    };
    let smBurlDiameterMmForCalc = 0;
    let smBurlStrokeTonnage = 0;
    if (smExtrudedFlangeCount > 0) {
      // estimateBurlDiameterMm can't yet link a specific hole to a specific
      // extruded-flange feature (no per-hole face linkage exists) — with no
      // tapped threads to average from, it falls back to the SMALLEST hole
      // diameter across the WHOLE part, not necessarily the one(s) actually
      // being extruded/burred. Confirmed live: a part with Ø2.5-5mm holes but
      // no detected thread features used Ø2.5mm as the burl diameter purely
      // because it was the smallest hole present, understating tonnage if
      // the real burred holes are actually larger (e.g. M3-sized).
      const smThreadTotalCount = threads.reduce((s, t) => s + t.count, 0);
      if (smThreadTotalCount === 0) {
        materialWarnings.push(
          'Hole-extrusion (burring) diameter approximated from the smallest detected hole ' +
          '(no tapped-thread features to average from) — verify against the actual burred hole size on the drawing.',
        );
      }
      const smBurlDiameterMm = estimateBurlDiameterMm(threads, summary.holeDiameters ?? []);
      // 0 (not a fabricated 1t), same reasoning as smRequiredTonnage above.
      const smBurlTonnage = Math.ceil(estimateBurlTonnage(smUtsMpa, sheetThicknessMm, smBurlDiameterMm) ?? 0);
      // See resolveStrokeLookupTonnage's own doc comment (Press Brake above) —
      // same fix applies here: stroke time belongs to the selected hole-
      // forming machine, not to this hole's own minimum required force.
      smBurlStrokeTonnage = this.resolveStrokeLookupTonnage(smBurlTonnage, mhrRates.holeForming);
      smBurlStrokeResult = await this.smLookup.getManualStrokeTime(sheetThicknessMm, smBurlStrokeTonnage, strokeComplexity);
      smBurlDiameterMmForCalc = smBurlDiameterMm;
    }
    if (smExtrudedFlangeCount > 0 && !smBurlStrokeResult.dataFound) {
      materialWarnings.push('Hole-extrusion (burring) stroke time from fallback — seed sm_lookup_manual_stroke for accurate cycle times.');
    }
    const smBurringCalc = smExtrudedFlangeCount > 0
      ? await this.resolvePhysicsQuantity(accessToken, {
          machineClass: 'hole_forming',
          process: 'Hole Extrusion (Burring)',
          targetFieldNames: ['Total Time'],
          seedScope: {
            Diameter: smBurlDiameterMmForCalc,
            Thickness: sheetThicknessMm,
            ...(smUtsMpa != null ? { UTS: smUtsMpa } : {}),
            'No Of Extrusions': smExtrudedFlangeCount,
            ...(smBurlStrokeResult.dataFound ? { 'Stroke Time': smBurlStrokeResult.secondsPerBend } : {}),
          },
          seedProvenance: {
            Diameter: 'estimateBurlDiameterMm — representative burl diameter (tapped-thread average, or smallest hole)',
            Thickness: 'BOM sheet thickness',
            UTS: 'raw_materials — material grade Ultimate Tensile Strength',
            'No Of Extrusions': 'CAD feature extraction — extruded flange count',
            'Stroke Time': this.describeStrokeTimeProvenance(sheetThicknessMm, strokeComplexity, smBurlStrokeResult.resolution, smBurlStrokeResult.roundedFromTonnage),
          },
          lookupTableByField: {
            'Stroke Time': 'sm_lookup_manual_stroke',
          },
          lookupResolutions: {
            'Stroke Time': smBurlStrokeResult.resolution,
          },
        })
      : this.emptyPhysicsResult(['Total Time']);
    const smBurringTotalSec = smBurringCalc.outputs['Total Time'];

    // Compute nesting if we have flat pattern dimensions.
    // Prefer the cad-engine's true unfolded flat-pattern bounding rectangle
    // (summary.flatPatternBoundingLengthMm/WidthMm, from its 2D unfold
    // solver) over the folded 3D part's own maxLength/maxWidth -- for any
    // bent part these are two genuinely different rectangles (unfolding
    // adds developed length at each bend), so packing against the folded
    // envelope overcounts real nesting capacity. Only fall back to the
    // folded box when the unfold solver couldn't resolve a layout for this
    // part -- disclosed via nestingDimensionSource/Confidence below, never
    // silent.
    const blankLMm = ((item as any).maxLength ?? 0) as number;
    const blankWMm = ((item as any).maxWidth ?? 0) as number;
    const trueFlatLMm = Number((summary as any).flatPatternBoundingLengthMm ?? 0);
    const trueFlatWMm = Number((summary as any).flatPatternBoundingWidthMm ?? 0);
    const nestingDims = resolveNestingDimensions(trueFlatLMm, trueFlatWMm, blankLMm, blankWMm);
    const { source: nestingDimensionSource, confidence: nestingDimensionConfidence } = nestingDims;
    const nestLMm = nestingDims.lengthMm;
    const nestWMm = nestingDims.widthMm;
    const hasValidDimensions = nestLMm > 0 && nestWMm > 0 && sheetThicknessMm > 0 && materialDensityKgM3 > 0;
    // Net weight resolves through the "Sheet Metal - Net Material Usage"
    // calculator (physics_key='sheet_metal_net_usage') -- the SAME real
    // formula this line always computed (area × thickness / 1e9 × density),
    // now the calculator's own authoritative implementation instead of a
    // second, independent copy of the arithmetic here. If the calculator
    // mapping genuinely isn't resolvable yet (gap), fall back to computing
    // the identical formula directly -- never a degraded approximation, and
    // never a silent $0 that would break every downstream nesting/costing
    // calculation below.
    const smNetWeightCalc = hasValidDimensions
      ? await this.resolvePhysicsQuantity(accessToken, {
          machineClass: 'sheet_metal_net_usage',
          process: 'Net Usage',
          targetFieldNames: ['Net Usage'],
          seedScope: {
            'Flat Pattern Area': flatPatternAreaMm2,
            'Thickness': sheetThicknessMm,
            'Material Density': materialDensityKgM3,
          },
          seedProvenance: {
            'Flat Pattern Area': 'CAD flat-pattern geometry',
            'Thickness': 'Effective CAD thickness (override-aware)',
            'Material Density': 'raw_materials lookup',
          },
        })
      : null;
    const smNetWeightKg = !hasValidDimensions
      ? 0
      : smNetWeightCalc?.outputs['Net Usage'] ??
        (flatPatternAreaMm2 * sheetThicknessMm / 1e9) * materialDensityKgM3;
    let smNestingResult = hasValidDimensions && smNetWeightKg > 0
      ? computeNesting({
          flatPatternLengthMm: nestLMm,
          flatPatternWidthMm: nestWMm || Math.sqrt(flatPatternAreaMm2),
          thicknessMm: sheetThicknessMm,
          netWeightKg: smNetWeightKg,
          densityKgM3: materialDensityKgM3,
          materialPricePerKg: materialCostPerKg,
          scrapPricePerKg: smScrapPricePerKg,
          quantityRequired: batchSize,
        })
      : undefined;

    // Real (true-shape) nest is the material-costing source of truth --
    // evaluated across EVERY viable standard sheet (never rectangle-grid-
    // prefiltered) and selected by lowest gross weight/part, per
    // resolveTrueShapeNestCosting's own doc comment. Rectangle-grid
    // (smNestingResult, computed above, unchanged) is kept as-is and used
    // ONLY as the disclosed fallback when no real outline exists yet or
    // every true-shape candidate genuinely fails.
    let smNestingMethod: 'true_shape' | 'rectangle_grid_fallback' = 'rectangle_grid_fallback';
    let smNestingFallbackReason: string | undefined;
    let smCalculatorId: string | undefined;
    let smCalculatorVersion: number | undefined;
    let smCalculationTrace: CalculationTraceStep[] | undefined;
    let smCalculatorConfidence: ConfidenceLevel | undefined;
    if (hasValidDimensions && smNetWeightKg > 0) {
      const partAllowanceMm = computePartAllowanceMm(sheetThicknessMm);
      const hasQty = typeof batchSize === 'number' && batchSize > 0;
      // Gross usage resolves through the "Sheet Metal - Gross Material Usage
      // (Nesting)" calculator (physics_key='sheet_metal_gross_usage_nesting')
      // -- the SAME resolveTrueShapeNestCosting evaluation this always ran,
      // now the calculator's own authoritative implementation. If the
      // calculator mapping itself isn't resolvable yet (calculatorId null --
      // e.g. its migration hasn't been applied to this DB yet), fall back to
      // calling the underlying evaluation directly: never a degraded
      // approximation, never a regression versus today's behavior, just a
      // temporary loss of the calculator-audit-trail metadata below until
      // the migration lands. A genuine domain gap from a RESOLVED calculator
      // (no verified CAD outline, or every candidate sheet failed) keeps
      // falling through to the pre-existing, separately-labeled
      // rectangle-grid fallback exactly as it always has.
      const trueShapeCalc = await this.resolvePhysicsQuantity(accessToken, {
        machineClass: 'sheet_metal_gross_usage_nesting',
        process: 'Gross Usage',
        targetFieldNames: [
          'Selected Sheet Width', 'Selected Sheet Length', 'Parts Per Sheet', 'Sheet Weight',
          'Gross Weight Per Part', 'Scrap Weight Per Part', 'Utilisation',
          ...(hasQty ? ['Sheets Required', 'Planned Parts', 'Excess Positions', 'Actual Batch Gross Material'] : []),
        ],
        seedScope: {
          'Thickness': sheetThicknessMm,
          ...(smShearStrengthMpa != null ? { 'Shear Strength': smShearStrengthMpa } : {}),
          'Net Weight Per Part': smNetWeightKg,
          'Material Density': materialDensityKgM3,
          'Edge Allowance': EDGE_ALLOWANCE_MM,
          ...(hasQty ? { 'Batch Quantity': batchSize } : {}),
        },
        seedProvenance: {
          'Thickness': 'Effective CAD thickness (override-aware)',
          'Shear Strength': 'raw_materials lookup',
          'Net Weight Per Part': 'Sheet Metal - Net Material Usage calculator',
          'Material Density': 'raw_materials lookup',
          'Edge Allowance': 'Sheet-metal nesting configuration',
          ...(hasQty ? { 'Batch Quantity': 'Order/batch quantity' } : {}),
        },
        itemId: item.id,
        userId,
      });

      const trueShape = trueShapeCalc.calculatorId === null
        // Safety net: calculator mapping not resolvable (e.g. migration not
        // yet applied to this DB) -- call the same underlying evaluation the
        // calculator itself wraps, exactly as before this reroute existed.
        ? await this.resolveTrueShapeNestCosting(
            item.id, summary, smNetWeightKg, materialDensityKgM3, sheetThicknessMm,
            partAllowanceMm, EDGE_ALLOWANCE_MM, userId, accessToken,
          )
        : trueShapeCalc.gap
          ? { selection: null as null, reason: trueShapeCalc.gap.gapType === 'unsupported_operation' ? trueShapeCalc.gap.reason : `${trueShapeCalc.gap.gapType} — see calculator ${trueShapeCalc.calculatorId}` }
          : {
              selection: {
                sheetWidthMm: trueShapeCalc.outputs['Selected Sheet Width']!,
                sheetLengthMm: trueShapeCalc.outputs['Selected Sheet Length']!,
                partsPerSheet: trueShapeCalc.outputs['Parts Per Sheet']!,
                sheetWeightKg: trueShapeCalc.outputs['Sheet Weight']!,
                grossWeightPerPartKg: trueShapeCalc.outputs['Gross Weight Per Part']!,
                utilisationPct: trueShapeCalc.outputs['Utilisation']!,
              },
            };

      if (trueShapeCalc.calculatorId !== null && !trueShapeCalc.gap) {
        smCalculatorId = trueShapeCalc.calculatorId ?? undefined;
        smCalculatorVersion = trueShapeCalc.calculatorVersion ?? undefined;
        smCalculationTrace = trueShapeCalc.trace;
        smCalculatorConfidence = trueShapeCalc.confidence;
      }

      if (trueShape.selection) {
        const best = trueShape.selection;
        smNestingMethod = 'true_shape';
        const trueScrapWeightPerPartKg = Math.max(0, best.grossWeightPerPartKg - smNetWeightKg);
        const trueGrossMaterialCost = best.grossWeightPerPartKg * materialCostPerKg;
        const trueScrapRecoveryCost = trueScrapWeightPerPartKg * (smScrapPricePerKg ?? 0) * 0.90;
        const trueNetMaterialCost = Math.max(0, trueGrossMaterialCost - trueScrapRecoveryCost);
        const trueSheetsRequired = hasQty ? Math.ceil(batchSize / best.partsPerSheet) : undefined;
        materialWarnings.push(
          `Material cost computed from the real flat-pattern silhouette nest (cad-engine), evaluated across ` +
          `all viable standard sheet sizes -- selected ${best.sheetWidthMm}x${best.sheetLengthMm}mm at ` +
          `${best.partsPerSheet} parts/sheet, ${best.utilisationPct}% utilization (net/gross weight).`,
        );
        smNestingResult = smNestingResult ? {
          ...smNestingResult,
          sheetWidthMm: best.sheetWidthMm,
          sheetLengthMm: best.sheetLengthMm,
          partsPerSheet: best.partsPerSheet,
          sheetWeightKg: Math.round(best.sheetWeightKg * 1000) / 1000,
          utilisationPct: best.utilisationPct,
          grossWeightPerPartKg: Math.round(best.grossWeightPerPartKg * 1000) / 1000,
          scrapWeightPerPartKg: Math.round(trueScrapWeightPerPartKg * 1000) / 1000,
          grossMaterialCost: Math.round(trueGrossMaterialCost * 100) / 100,
          scrapRecoveryCost: Math.round(trueScrapRecoveryCost * 100) / 100,
          netMaterialCost: Math.round(trueNetMaterialCost * 100) / 100,
          sheetsRequired: trueSheetsRequired,
          plannedParts: trueSheetsRequired != null ? best.partsPerSheet * trueSheetsRequired : undefined,
          excessPositions: trueSheetsRequired != null ? best.partsPerSheet * trueSheetsRequired - batchSize : undefined,
          actualBatchGrossMaterialKg: trueSheetsRequired != null
            ? Math.round(trueSheetsRequired * best.sheetWeightKg * 1000) / 1000
            : undefined,
        } : undefined;
      } else {
        smNestingFallbackReason = trueShape.reason;
        materialWarnings.push(`Material cost computed from rectangle-grid nesting (fallback) -- ${trueShape.reason}.`);
      }
    }

    const smTreatment = this.resolveSurfaceTreatment(item);
    const smSurfaceTreatmentDbRate = await this.resolveSurfaceTreatmentDbRate(
      accessToken,
      classifySurfaceTreatment(smTreatment),
      location,
      rates,
      smTreatment,
      (item.surfaceArea ?? 0) as number,
      batchSize,
    );
    const smProcessIdentities = await this.resolveProcessIdentities(accessToken, [
      mhrRates.laser.machineClass,
      mhrRates.pressBrake.machineClass,
      mhrRates.deburring.machineClass,
      mhrRates.tapping.machineClass,
      mhrRates.drillPress.machineClass,
      mhrRates.pemPress.machineClass,
      mhrRates.holeForming.machineClass,
      mhrRates.inspection.machineClass,
    ], family);

    // ── Inspection candidates — real CAD + drawing-intelligence data only ─────
    // See costing/inspection-engine.ts: fields are populated only where real
    // data exists today (per-hole diameter is real; per-hole tolerance/
    // criticality and bend angle are not extracted anywhere in the sheet-metal
    // pipeline yet — both already-disclosed gaps, not fabricated here either).
    const smHoleDiameters = (fg?.summary?.holeDiameters ?? []) as number[];
    const smBendRadiiForInspection = (fg?.summary?.bendRadii ?? []) as number[];
    const smInspectionHoles = smHoleDiameters.length > 0
      ? smHoleDiameters.map((d) => ({ diameterMm: d }))
      : Array.from({ length: holeCount }, () => ({}));
    const smInspectionBends = smRealBendLengths.length > 0
      ? smRealBendLengths.map((len, i) => ({ lengthMm: len, radiusMm: smBendRadiiForInspection[i] }))
      : Array.from({ length: bendCount }, () => ({}));
    const smDrawingIntel = (item.drawingIntelligence ?? null) as Record<string, any> | null;
    // gdt_callouts is real today but always [] — cad-engine/drawing_analyzer.py's
    // GD&T extraction (Module 3) isn't built yet. Mapped defensively so this
    // engine is ready the moment real data arrives, without assuming a shape
    // that was never actually produced.
    const smGdtCallouts = ((smDrawingIntel?.gdt_callouts ?? []) as any[]).map((c) => ({
      type: String(c.type ?? c.symbol ?? ''),
      toleranceMm: Number(c.toleranceMm ?? c.tolerance_mm ?? 0),
    }));
    const smCmmRate = await this.resolveCmmSpecificRate(accessToken, location, rates, mhrRates.inspection, materialWarnings);
    const smGenericInspectionRate = await this.resolveGenericInspectionRate(accessToken, location, rates, materialWarnings);

    // Manufacturing Physics Calculator architecture: Inspection's real
    // sampling/method-escalation/per-feature-time decisions stay in
    // planInspection() (legitimate real input resolution, same role Press
    // Brake's tonnage calc plays elsewhere) — the final cycle-time SUM comes
    // from the real "Sheet Metal - Inspection" DB calculator via
    // resolvePhysicsQuantity, not a second, independent addition in this
    // file or cost-engine.ts.
    const smInspectionInput: InspectionInput = {
      holes: smInspectionHoles,
      bends: smInspectionBends,
      sheetThicknessMm,
      hasOverallDimensions: blankLMm > 0 && blankWMm > 0 && (((item as any).maxHeight ?? 0) as number) > 0,
      threads,
      generalTolerances: (smDrawingIntel?.general_tolerances ?? null) as string | null,
      toleranceConfidence: Number(smDrawingIntel?.tolerance_confidence ?? 0),
      gdtCallouts: smGdtCallouts,
      inspectionRules: smInspectionRules,
      operationDefaults: smInspectionOperationDefaults,
      inspectionStrategy: 'sampling',
      samplingRate: smSamplingRate,
      batchSize,
      rate: smGenericInspectionRate,
      cmmRate: smCmmRate,
      qaInspectorRatePerHr: mhrRates.qaInspectorRate ?? null,
      processIdentity: smProcessIdentities[mhrRates.inspection.machineClass],
    };
    const smInspectionPlan = planInspection(smInspectionInput);
    const smInspectionCalc = smInspectionPlan.skip
      ? this.emptyPhysicsResult(['Total Time'])
      : await this.resolvePhysicsQuantity(accessToken, {
          machineClass: mhrRates.inspection.machineClass,
          process: 'Inspection',
          targetFieldNames: ['Total Time'],
          seedScope: {
            'Visual Pass Base': smInspectionPlan.visualPassBaseSec,
            'Holes to Inspect': smInspectionPlan.holesToInspect,
            'Hole Check Time': smInspectionPlan.holeCheckSec,
            'Bends to Inspect': smInspectionPlan.bendsToInspect,
            'Bend Check Time': smInspectionPlan.bendCheckSec,
            'Threads to Inspect': smInspectionPlan.threadsToInspect,
            'Thread Gauge Time': smInspectionPlan.threadGaugeSec,
            'Has Thickness Check': smInspectionPlan.hasThicknessCheck ? 1 : 0,
            'Thickness Check Time': smInspectionPlan.thicknessCheckSec,
            'Has Dimension Check': smInspectionPlan.hasDimensionCheck ? 1 : 0,
            'Dimension Check Time': smInspectionPlan.dimensionCheckSec,
          },
          seedProvenance: {
            'Visual Pass Base': 'inspection_operation_defaults — visual_base cycle time',
            'Holes to Inspect': 'Real sampling plan — feature count × AQL/strategy fraction',
            'Hole Check Time': `inspection_operation_defaults — hole check time for ${smInspectionPlan.method} method`,
            'Bends to Inspect': 'Real sampling plan — feature count × AQL/strategy fraction',
            'Bend Check Time': `inspection_operation_defaults — bend check time for ${smInspectionPlan.method} method`,
            'Threads to Inspect': 'Real sampling plan — feature count × AQL/strategy fraction',
            'Thread Gauge Time': `inspection_operation_defaults — thread gauge time for ${smInspectionPlan.method} method`,
            'Has Thickness Check': 'Real geometry — sheet thickness known',
            'Thickness Check Time': `inspection_operation_defaults — thickness check time for ${smInspectionPlan.method} method`,
            'Has Dimension Check': 'Real geometry — overall dimensions known',
            'Dimension Check Time': `inspection_operation_defaults — dimension check time for ${smInspectionPlan.method} method`,
          },
        });
    const smInspectionLineResult = finalizeInspectionLine(smInspectionInput, smInspectionPlan, {
      cycleTimeSec: smInspectionCalc.outputs['Total Time'],
      calculatorId: smInspectionCalc.calculatorId,
      calculatorVersion: smInspectionCalc.calculatorVersion,
      gap: smInspectionCalc.gap,
      confidence: smInspectionCalc.confidence,
    });

    // Manufacturing Physics Calculator architecture: Reaming cycle time
    // comes from the real "Machining - Reaming" DB calculator ONLY (real
    // rigid-reaming physics — RPM from cutting speed/diameter, machining
    // time from feed rate, using real HSS reaming speed/feed data — see
    // default-rates.ts's REAM_SURFACE_SPEED_M_MIN_BY_MATERIAL for
    // citations), one call per real hole-diameter group (mirrors
    // Counterboring's aggregation). Same part-level trigger/approximation as
    // before (tightTolerance < threshold -> ream ALL holes) — only the time
    // PHYSICS changed, not the scoping.
    const smTightTolerance = ((item as any).tightestToleranceMm ?? null) as number | null;
    const smReamTriggered = smTightTolerance != null && smTightTolerance > 0
      && smTightTolerance < TIGHT_TOLERANCE_REAM_THRESHOLD_MM && holeCount > 0;
    let smReamCycleTimeSec: number | undefined;
    let smReamCalculatorId: string | null = null;
    let smReamCalculatorVersion: number | null = null;
    let smReamGap: PhysicsGap | null = null;
    let smReamConfidence: ConfidenceLevel = 'unsupported';
    if (smReamTriggered) {
      const smReamGroups = (() => {
        const map = new Map<number, number>();
        for (const d of smHoleDiameters) {
          const key = Math.round(d * 10) / 10;
          map.set(key, (map.get(key) ?? 0) + 1);
        }
        return [...map.entries()].map(([diameter_mm, count]) => ({ diameter_mm, count }));
      })();
      if (smReamGroups.length === 0) {
        // No real per-hole diameter signal at all (holeCount is known but
        // no CAD diameter list extracted) — a genuine data gap, not a bug;
        // report it as such rather than guessing a diameter to feed the
        // calculator.
        smReamGap = {
          gapType: 'unsupported_operation',
          process: 'Reaming',
          machineClass: 'drill_press',
          reason: 'No real hole-diameter data extracted for this part — cannot resolve real reaming physics without a diameter.',
        };
      } else {
        const reamDepthMm = sheetThicknessMm > 0 ? sheetThicknessMm : 3;
        let totalSec = 0;
        let anyResolved = false;
        let reamConfidence: ConfidenceLevel = 'verified';
        for (const g of smReamGroups) {
          const reamInputs = resolveReamPhysicsInputs(g.diameter_mm, grade);
          const reamCalc = await this.resolvePhysicsQuantity(accessToken, {
            machineClass: 'drill_press',
            operation: 'Reaming',
            process: 'Reaming',
            targetFieldNames: ['Total Time'],
            seedScope: {
              Diameter: g.diameter_mm,
              Length: reamDepthMm,
              'Cutting Speed': reamInputs.surfaceSpeedMMin,
              'Feed per Rev': reamInputs.feedMmPerRev,
              'No of Uses': g.count,
            },
            seedProvenance: {
              Diameter: 'CAD feature extraction — real hole diameter',
              Length: 'BOM sheet thickness (reamed-hole depth)',
              'Cutting Speed': `Standard HSS reaming surface speed — ${reamInputs.materialFamily} family`,
              'Feed per Rev': 'Standard HSS reaming feed — diameter-scaled (engineering-standard assumption, disclosed)',
              'No of Uses': 'CAD feature extraction — hole count for this diameter group',
            },
          });
          smReamCalculatorId = reamCalc.calculatorId ?? smReamCalculatorId;
          smReamCalculatorVersion = reamCalc.calculatorVersion ?? smReamCalculatorVersion;
          const groupTotal = reamCalc.outputs['Total Time'];
          if (typeof groupTotal === 'number' && Number.isFinite(groupTotal)) {
            totalSec += groupTotal;
            anyResolved = true;
            reamConfidence = this.combineConfidence(reamConfidence, reamCalc.confidence);
          } else if (reamCalc.gap && !smReamGap) {
            smReamGap = reamCalc.gap;
          }
        }
        smReamCycleTimeSec = anyResolved ? totalSec : undefined;
        smReamConfidence = anyResolved ? reamConfidence : 'unsupported';
      }
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
        location,
        mhrRates,
        processIdentityByMachineClass: smProcessIdentities,
        // New lookup-driven inputs
        laserCycleTimeSecFromCalculator: smLaserCycleTimeSec,
        laserCalculatorId: smLaserCalc.calculatorId,
        laserCalculatorVersion: smLaserCalc.calculatorVersion,
        laserPhysicsGap: smLaserCalc.gap,
        laserConfidence: smLaserCalc.confidence,
        handlingTimeMin: smHandlingMin,
        toolSetupBrakeMin: smBrakeSetupMin,
        pressBrakeCycleTimeSecFromCalculator: smBendCycleTimeSec,
        pressBrakeSetupTimeMinFromCalculator: smBendSetupTimeMin,
        pressBrakeCalculatorId: smBendCalc.calculatorId,
        pressBrakeCalculatorVersion: smBendCalc.calculatorVersion,
        pressBrakePhysicsGap: smBendCalc.gap,
        pressBrakeConfidence: smBendCalc.confidence,
        tappingCycleTimeSecFromCalculator: smTappingCalc.cycleTimeSec,
        tappingCalculatorId: smTappingCalc.calculatorId,
        tappingCalculatorVersion: smTappingCalc.calculatorVersion,
        tappingPhysicsGap: smTappingCalc.gap,
        tappingConfidence: smTappingCalc.confidence,
        deburrCycleTimeSecFromCalculator: smDeburrCycleTimeSec,
        deburrCalculatorId: smDeburrCalc.calculatorId,
        deburrCalculatorVersion: smDeburrCalc.calculatorVersion,
        deburrPhysicsGap: smDeburrCalc.gap,
        deburrConfidence: smDeburrCalc.confidence,
        samplingRate: smSamplingRate,
        inspectionTimeMin: smInspectionMin,
        opSetupMinByOp: smOpSetupMinByOp,
        nestingResult: smNestingResult,
        partComplexity: smComplexity,
        utsMpa: smUtsMpa,
        shearStrengthMpa: smShearStrengthMpa,
        scrapPricePerKg: smScrapPricePerKg,
        machineOperators: 1,
        surfaceAreaMm2: (item.surfaceArea ?? 0) as number,
        surfaceTreatment: smTreatment,
        surfaceTreatmentDbRate: smSurfaceTreatmentDbRate,
        directLaborRatePerHr:  mhrRates.directLaborRate  ?? undefined,
        qaInspectorRatePerHr:  mhrRates.qaInspectorRate  ?? undefined,
        // Feature-driven secondary hole operations
        counterboreCount: smCounterboreCount,
        counterboreCycleTimeSecFromCalculator: smCounterboreCalc.cycleTimeSec,
        counterboreCalculatorId: smCounterboreCalc.calculatorId,
        counterboreCalculatorVersion: smCounterboreCalc.calculatorVersion,
        counterborePhysicsGap: smCounterboreCalc.gap,
        counterboreConfidence: smCounterboreCalc.confidence,
        countersinkCount: smCountersinkCount,
        countersinkCycleTimeSecFromCalculator: smCountersinkCalc.cycleTimeSec,
        countersinkCalculatorId: smCountersinkCalc.calculatorId,
        countersinkCalculatorVersion: smCountersinkCalc.calculatorVersion,
        countersinkPhysicsGap: smCountersinkCalc.gap,
        countersinkConfidence: smCountersinkCalc.confidence,
        pemCount: smPemCount,
        pemCycleTimeSecFromCalculator: smPemTotalSec,
        pemCalculatorId: smPemCalculatorId,
        pemCalculatorVersion: smPemCalculatorVersion,
        pemPhysicsGap: smPemGap,
        pemConfidence: smPemConfidence,
        pemPartSpecs: smPemPartSpecs,
        extrudedFlangeCount: smExtrudedFlangeCount,
        burringCycleTimeSecFromCalculator: smBurringTotalSec,
        burringCalculatorId: smBurringCalc.calculatorId,
        burringCalculatorVersion: smBurringCalc.calculatorVersion,
        burringPhysicsGap: smBurringCalc.gap,
        burringConfidence: smBurringCalc.confidence,
        tightestToleranceMm: smTightTolerance,
        reamCycleTimeSecFromCalculator: smReamCycleTimeSec,
        reamCalculatorId: smReamCalculatorId,
        reamCalculatorVersion: smReamCalculatorVersion,
        reamPhysicsGap: smReamGap,
        reamConfidence: smReamConfidence,
        inspectionResult: smInspectionLineResult,
      }),
      ...currencyMeta,
    };
    smResult.warnings.push(...materialWarnings);
    if (geo) {
      smResult.warnings.push(...geo.warnings);
      smResult.geometryProvenance = { bendSource: geo.bendSource, blankAreaSource: geo.blankAreaSource };
    }
    this.attachMachineSelections(smResult.processLines, mhrRates);
    // Attach eMithran-style feature breakdowns to laser + press brake + deburr lines
    {
      const bendRadii = (fg?.summary?.bendRadii ?? []) as number[];
      const laserLine = smResult.processLines.find((l) => l.process === 'Laser Cutting');
      if (laserLine) {
        laserLine.featureBreakdown = this.buildLaserFeatureBreakdown(
          cutLengthMm, pierceCount, smLaserParams,
        );
        if (smLaserCalc.trace.length) laserLine.calculationTrace = smLaserCalc.trace;
      }
      const pbLine = smResult.processLines.find((l) => l.process === 'Press Brake');
      if (pbLine) {
        pbLine.featureBreakdown = this.buildPressBrakeFeatureBreakdown(
          bendCount, bendRadii,
          smStrokeResult.dataFound ? smStrokeResult.secondsPerBend : null,
          smHandlingMin,
        );
        if (smBendCalc.trace.length) pbLine.calculationTrace = smBendCalc.trace;
      }
      const deburrLine = smResult.processLines.find((l) => l.process === 'Deburring');
      if (deburrLine) {
        deburrLine.featureBreakdown = this.buildDeburrFeatureBreakdown(cutLengthMm, pierceCount);
        if (smDeburrCalc.trace.length) deburrLine.calculationTrace = smDeburrCalc.trace;
      }
      const tappingLine = smResult.processLines.find((l) => l.process === 'Tapping');
      if (tappingLine) {
        tappingLine.featureBreakdown = this.buildTappingFeatureBreakdown(threads, sheetThicknessMm, grade);
      }
      const pemLine = smResult.processLines.find((l) => l.process === 'PEM Insertion');
      if (pemLine) {
        pemLine.featureBreakdown = this.buildPemFeatureBreakdown(smThroughHoleGroups, smPemResolved);
      }
    }
    // P0.2: process_cost_records is the applied-quote authority (Manufacturing
    // Process section, Excel export, BOM/project rollups, and the AI assistant
    // all already treat it this way -- see plan doc). Once a route has been
    // applied for this part, Cost Summary must show THAT persisted result for
    // its cutting/bending lines, not a fresh live recompute -- which, for
    // cutting, only ever knows how to fabricate a Laser Cutting line, even
    // after the user applied Turret Punch or Waterjet. Scoped to exactly the
    // two families where a live-vs-persisted divergence was found possible:
    // cutting (fiber_laser/co2_laser/turret_punch/waterjet -- mutually
    // exclusive alternatives for the same operation) and press_brake
    // (independently overridable via the Edit Process Cost dialog). Every
    // other resolvePhysicsQuantity-driven line (tapping, PEM, deburr, ...)
    // already uses the identical calculator call in both this method and
    // getRouteComparison(), so no divergence risk exists there -- not touched.
    try {
      const client = this.supabaseService.getClient(accessToken);
      const { data: appliedRows, error: appliedRowsError } = await client
        .from('process_cost_records')
        .select('machine_class, machine_name, mhr_id, operation, process_group, process_route, cycle_time, setup_time, direct_rate, setup_cost_per_part, total_cycle_cost_per_part, total_cost_per_part')
        .eq('bom_item_id', id)
        .eq('is_active', true)
        .in('machine_class', ['fiber_laser', 'co2_laser', 'turret_punch', 'waterjet', 'press_brake']);
      // P0.6: the Supabase client returns errors on the {error} field rather than
      // throwing -- this was previously never checked, so a real DB failure (not
      // "no applied route yet", a genuine query error) fell through indistinguishable
      // from the honest empty-result case, silently reverting to the live
      // pre-apply preview with no record anywhere that the applied-route read
      // actually failed. Logged, not thrown -- the live preview is still the
      // correct fallback behavior; only the silence was the bug.
      if (appliedRowsError) {
        this.logger.warn(
          `process_cost_records lookup failed for bom_item ${id} -- falling back to live pre-apply preview: ${appliedRowsError.message}`,
          'BOMItemsService',
        );
      } else if (appliedRows && appliedRows.length > 0) {
        Object.assign(smResult, applyPersistedRouteToSummary(smResult, appliedRows as AppliedProcessCostRecord[]));
      }
    } catch (e: unknown) {
      // No applied route yet (first-time costing, nothing in process_cost_records
      // for this item) is NOT expected to reach here (an empty/no-row result is
      // not an exception) -- this catch is for a genuine thrown error (e.g.
      // applyPersistedRouteToSummary itself throwing on malformed data).
      this.logger.warn(
        `Applied-route overlay threw for bom_item ${id} -- falling back to live pre-apply preview: ${e instanceof Error ? e.message : String(e)}`,
        'BOMItemsService',
      );
    }
    await this.attachSavedMachineExplanations(smResult.processLines, id, accessToken, location);
    this.appendRateWarnings(smResult, location, mhrRates.benchmarkMap, rateWarnThresholds);
    this.applyCostOverrides(smResult, costOverrides);
    if (costOverrides.size > 0) smResult.costOverrides = Object.fromEntries(costOverrides);
    if (flatPatternAreaMm2 > 0 && sheetThicknessMm > 0 && materialDensityKgM3 > 0) {
      if (smNestingResult) {
        smResult.blankSpec = {
          form:           'sheet',
          sizeLabel:      `${smNestingResult.sheetWidthMm}×${smNestingResult.sheetLengthMm}×${sheetThicknessMm}mm (${smNestingResult.partsPerSheet} parts/sheet)`,
          grossWeightKg:  smNestingResult.grossWeightPerPartKg,
          netWeightKg:    smNestingResult.grossWeightPerPartKg - smNestingResult.scrapWeightPerPartKg,
          utilizationPct: smNestingResult.utilisationPct,
          wasteKg:        smNestingResult.scrapWeightPerPartKg,
          wasteCost:      smNestingResult.scrapWeightPerPartKg * materialCostPerKg,
          nestingDimensionSource,
          nestingDimensionConfidence,
          // Theoretical per-position basis for grossWeightKg above.
          sheetWidthMm:   smNestingResult.sheetWidthMm,
          sheetLengthMm:  smNestingResult.sheetLengthMm,
          partsPerSheet:  smNestingResult.partsPerSheet,
          // The FULL physical stock-sheet weight -- see BlankSpecDto's own
          // doc comment for why this is exposed separately from
          // grossWeightKg (which is already per-part).
          sheetWeightKg:  smNestingResult.sheetWeightKg,
          // Actual batch sheet consumption -- distinct from grossWeightKg,
          // never used to derive it. See NestingResult's own doc comment.
          sheetsRequired:             smNestingResult.sheetsRequired,
          plannedParts:               smNestingResult.plannedParts,
          excessPositions:            smNestingResult.excessPositions,
          actualBatchGrossMaterialKg: smNestingResult.actualBatchGrossMaterialKg,
          nestingMethod: smNestingMethod,
          ...(smNestingFallbackReason && { nestingFallbackReason: smNestingFallbackReason }),
          // Present only once the "Sheet Metal - Gross Material Usage
          // (Nesting)" calculator's mapping is resolvable on this DB (see
          // resolvePhysicsQuantity's calculatorId===null safety net above) --
          // absent, never fabricated, until that migration is applied.
          ...(smCalculatorId && { calculatorId: smCalculatorId }),
          ...(smCalculatorVersion != null && { calculatorVersion: smCalculatorVersion }),
          ...(smCalculationTrace && { calculationTrace: smCalculationTrace }),
          ...(smCalculatorConfidence && { confidence: smCalculatorConfidence }),
        };
      } else {
        const effL = blankLMm > 0 ? blankLMm : Math.sqrt(flatPatternAreaMm2);
        const effW = blankLMm > 0
          ? (blankWMm > 0 ? blankWMm : flatPatternAreaMm2 / blankLMm)
          : Math.sqrt(flatPatternAreaMm2);
        smResult.blankSpec = {
          form:           'sheet',
          sizeLabel:      `${Math.round(effL)}×${Math.round(effW)}×${sheetThicknessMm}mm`,
          grossWeightKg:  smResult.grossWeightKg,
          netWeightKg:    smResult.sustainability.netWeightKg,
          utilizationPct: smResult.sustainability.materialUtilizationPct,
          wasteKg:        Math.max(0, smResult.grossWeightKg - smResult.sustainability.netWeightKg),
          wasteCost:      smResult.sustainability.wasteCostInr,
        };
      }
    }
    return this.normalizeCostSummaryToCurrency(smResult, rates, locInfo.code, item.scenarioOverrides);
  }

  /**
   * True (real polygon) 2D nesting placement -- visualization only, NOT a
   * material-cost source (see true-nest.dto.ts's own header comment).
   * Deliberately a separate, on-demand endpoint from getCostSummary above
   * (which is already a synchronous 14-40s-observed path with no job-queue
   * safety net) -- called only when the Nest view is actually opened, never
   * on page load or bundled into costing.
   *
   * Real flat-pattern outline/hole geometry comes from item.featureGraph.summary
   * (the exact same object populated by auto-fill.service.ts's
   * flatPatternOutlinePointsMm/flatPatternHolesMm/flatPatternOutlineSource --
   * see that file for how cad-engine's wire-walk result lands here). Returns
   * { result: null, reason } (never a fabricated layout) when that geometry
   * isn't available for this part, or cad-engine couldn't compute a nest for
   * it -- `reason` is always a specific, truthful diagnostic, never a
   * generic placeholder, so the controller can surface exactly which stage
   * of the pipeline (missing outline vs. cad-engine's own nest failure)
   * declined rather than collapsing both into one message.
   */
  async getTrueNest(
    id: string,
    userId: string,
    accessToken: string,
    quantity: number,
    sheetWidthMm: number,
    sheetLengthMm: number,
    kerfMm?: number,
    edgeMarginMm?: number,
  ): Promise<{ result: TrueNestResultDto | null; reason: string }> {
    const item = await this.findOne(id, userId, accessToken);
    const fg = item.featureGraph as any;
    const summary = fg?.summary ?? {};

    const outlinePointsMm = summary.flatPatternOutlinePointsMm;
    const outlineSource: 'wire_walk' | 'unavailable' = summary.flatPatternOutlineSource === 'wire_walk' ? 'wire_walk' : 'unavailable';
    if (!Array.isArray(outlinePointsMm) || outlinePointsMm.length < 3) {
      // No real outline resolved for this part -- honest gap, not a guess.
      const reason = outlineSource === 'unavailable'
        ? `No real flat-pattern outline is stored for this part (featureGraph.summary.flatPatternOutlineSource = 'unavailable'). ` +
          `cad-engine's wire-walk extractor could not build a valid boundary for this part's topology on the last analysis ` +
          `(fragmentation, self-intersection, or area-reconciliation failure). Re-run Reanalyze to retry extraction.`
        : `featureGraph.summary.flatPatternOutlinePointsMm is missing or has fewer than 3 points ` +
          `(source is reported as '${outlineSource}', but the point array itself is empty/absent) -- ` +
          `this part has not had CAD analysis run since the true-nest feature was added, or the stored ` +
          `featureGraph predates it. Re-run Reanalyze.`;
      return { result: null, reason };
    }
    const holesMmRaw: Array<{ cx_mm: number; cy_mm: number; diameter_mm: number }> = Array.isArray(summary.flatPatternHolesMm)
      ? summary.flatPatternHolesMm
      : [];

    const { result: cadResult, reason: cadReason } = await this.cadAnalysisService.computeTrueNest({
      outlinePointsMm,
      holesMm: holesMmRaw.map((h) => ({ cxMm: h.cx_mm, cyMm: h.cy_mm, diameterMm: h.diameter_mm })),
      sheetWidthMm,
      sheetLengthMm,
      quantity,
      kerfMm,
      edgeMarginMm,
    });
    if (!cadResult) {
      return { result: null, reason: `Outline was extracted (${outlinePointsMm.length} points, source '${outlineSource}'), but cad-engine could not nest it on the ${sheetWidthMm}x${sheetLengthMm}mm sheet: ${cadReason}` };
    }

    return {
      result: {
        outlinePointsMm,
        holesMm: holesMmRaw.map((h) => ({ cxMm: h.cx_mm, cyMm: h.cy_mm, diameterMm: h.diameter_mm })),
        outlineSource,
        sheetWidthMm: cadResult.sheetWidthMm,
        sheetLengthMm: cadResult.sheetLengthMm,
        partsPerSheet: cadResult.partsPerSheet,
        placements: cadResult.placements,
        utilizationPct: cadResult.utilizationPct,
        sheetsRequired: cadResult.sheetsRequired,
        capped: cadResult.capped,
      },
      reason: '',
    };
  }

  async getRouteComparison(
    id: string,
    userId: string,
    accessToken: string,
    batchSize = 1,
    location: string,
  ): Promise<RouteComparisonDto> {
    const item = await this.findOne(id, userId, accessToken);

    const fg = item.featureGraph as any;
    const summary = fg?.summary ?? {};

    const sheetThicknessMm = resolveEffectiveSheetThicknessMm(item.scenarioOverrides, summary.sheetThicknessMm, item.sheetThicknessMm ?? 0);
    const rawDiMaterialRC = (item.drawingIntelligence as any)?.material;
    const drawingGradeRC = this.sanitizeDrawingGrade((
      typeof rawDiMaterialRC === 'string' ? rawDiMaterialRC :
      rawDiMaterialRC != null && typeof rawDiMaterialRC === 'object' ? (rawDiMaterialRC.value ?? null) :
      null
    ) as string | null);
    const grade = drawingGradeRC ?? item.materialGrade ?? (item as any).material ?? null;

    // Override > material > geometry — same resolver as getCostSummary, by
    // construction (summary ≡ route invariant).
    const familyResolutionRC = this.resolveEffectiveFamily({ item, fg, grade, sheetThicknessMm });
    const family = familyResolutionRC.family;

    const cutLengthMm     = (summary.cutLengthMm      ?? item.cutLengthMm      ?? 0) as number;
    const pierceCount     = (summary.pierceCount       ?? item.pierceCount      ?? 0) as number;
    const geoBendCount    = (summary.bendCount         ?? item.bendCount        ?? 0) as number;
    const measuredFlatAreaMm2 = (summary.flatPatternAreaMm2 ?? item.flatPatternAreaMm2 ?? 0) as number;
    // Fix 1 (route comparison): same CNC hole-count logic as getCostSummary — prefer
    // feature recognizer counts over raw cylinder count to keep summary ≡ route invariant.
    const cncFeatureSummaryRC = fg?.cnc_features?.feature_summary ?? null;
    const holeCount = (
      cncFeatureSummaryRC !== null && (family === 'cnc_milled' || family === 'cnc_turned' || family === 'mill_turn')
        ? ((cncFeatureSummaryRC.through_hole ?? 0) + (cncFeatureSummaryRC.blind_hole ?? 0))
        : (summary.holeCount ?? item.holeCount ?? 0)
    ) as number;

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
    const threads = ((item.drawingIntelligence as any)?.threads ?? []).map((t: any) => ({
      size: String(t.size ?? t.spec ?? '').trim(),
      count: Number(t.count) || 1,
      ...(Number(t.pitch) > 0 ? { pitchMm: Number(t.pitch) } : {}),
    })) as Array<{ size: string; count: number; pitchMm?: number }>;

    // Flat pattern dimensions — from bom_items.max_length / max_width (set by CAD pipeline).
    // Access both camelCase and snake_case to handle FIELD_MAPPING variations safely.
    const flatPatternLengthMm = ((item as any).maxLength ?? (item as any).max_length ?? null) as number | null;
    const flatPatternWidthMm  = ((item as any).maxWidth  ?? (item as any).max_width  ?? null) as number | null;

    // ── Shared warnings ────────────────────────────────────────────────────────
    const comparisonWarnings: string[] = [];
    if (!grade) comparisonWarnings.push('Material grade not set — default mild steel rates applied');
    if (geo) comparisonWarnings.push(...geo.warnings);
    if (familyResolutionRC.warning) comparisonWarnings.push(familyResolutionRC.warning);

    // ── Material cost — same resolver as getCostSummary, by construction ──────
    const locInfo = LOCATION_INFO[location] ?? LOCATION_INFO['Other'];
    // One FX snapshot for this whole request — see getCostSummary's identical comment.
    const rates = await this.exchangeRateService.getSnapshot(accessToken);

    // Resolved ONCE here (before capabilityGeometry AND buildPartRequirements
    // below) so the tonnage capability check, machine selection, and $ cost
    // all consume the exact same real per-part UTS — previously capabilityGeometry
    // called resolveUtsMpa(grade) (the hardcoded fallback table) directly,
    // independently of this resolver's real raw_materials lookup, and could
    // silently disagree with it.
    const { materialCostPerKg, materialDensityKgM3, materialSource, utsMpa, shearStrengthMpa: rcShearStrengthMpa } =
      await this.resolveMaterialForFamily({
        accessToken,
        grade,
        family,
        materialCol: locInfo.materialCol,
        rates,
        locCurrencyCode: locInfo.code,
        warnings: comparisonWarnings,
      });

    const realMaxBendLengthMm = ((fg?.summary?.bendLengths ?? []) as number[]).length > 0
      ? Math.max(...(fg.summary.bendLengths as number[]))
      : null;
    const capabilityGeometry: PartGeometryForCapability = {
      sheetThicknessMm,
      flatPatternLengthMm,
      flatPatternWidthMm,
      // Real per-bend length when the CAD engine has it; falls back to the
      // longest flat-pattern edge as a conservative upper bound otherwise
      // (real bend lines are ≤ the longest edge, so tonnage errs safe).
      bendLengthMm: bendCount > 0
        ? (realMaxBendLengthMm ?? (Math.max(flatPatternLengthMm ?? 0, flatPatternWidthMm ?? 0) || null))
        : null,
      materialUtsMpa: utsMpa,
      // Real turret-punch force inputs — see estimateTurretPunchTonnage's doc
      // comment. cutLengthMm is the same real geometry the turret engine's own
      // nibbling calc already uses; null when there's nothing to punch/cut.
      punchCutLengthMm: cutLengthMm > 0 ? cutLengthMm : null,
      materialShearStrengthMpa: rcShearStrengthMpa,
      // Real material grade — only used for laser material-family-specific
      // thickness limits when a real per-machine capability is available.
      materialGrade: grade,
    };

    const thk = sheetThicknessMm > 0 ? sheetThicknessMm : 2.0;
    const volumeMm3 = flatPatternAreaMm2 * thk;
    const netWeightKg = (volumeMm3 / 1e9) * materialDensityKgM3;
    // Sheet metal: use the SAME true-shape nesting result getCostSummary uses
    // as its material-costing source of truth (resolveTrueShapeNestCosting —
    // sheet weight ÷ parts-per-sheet, no extra markup) rather than this
    // endpoint's own independent flat markup, so Route Comparison and Cost
    // Summary can never silently disagree on gross usage/utilization for the
    // identical part. resolveTrueShapeNestCosting caches its result on the
    // item (trueNestCostingCache), so when getCostSummary has already run
    // for this item/thickness/allowance this is a cache hit, not a second
    // expensive nest evaluation. Falls back to the flat MATERIAL_OVERHEAD_PCT
    // markup only when no real flat-pattern outline exists yet or every
    // candidate sheet genuinely fails — same last-resort role this constant
    // already plays in cost-engine.ts — never a substitute for a resolvable
    // true-shape result.
    let grossWeightKg = netWeightKg * (1 + MATERIAL_OVERHEAD_PCT / 100);
    if (family === 'sheet_metal' && netWeightKg > 0) {
      const partAllowanceMm = computePartAllowanceMm(sheetThicknessMm);
      const trueShape = await this.resolveTrueShapeNestCosting(
        item.id, summary, netWeightKg, materialDensityKgM3, sheetThicknessMm,
        partAllowanceMm, EDGE_ALLOWANCE_MM, userId, accessToken,
      );
      if (trueShape.selection) {
        grossWeightKg = trueShape.selection.grossWeightPerPartKg;
      }
    }
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
            bendLengthsMm: (fg?.summary?.bendLengths ?? []) as number[],
            utsMpa,
            extrudedFlangeCount: fg?.summary?.extrudedFlangeCount ?? 0,
            burlDiameterMm: estimateBurlDiameterMm(threads, (fg?.summary?.holeDiameters ?? []) as number[]),
            cutLengthMm,
            materialShearStrengthMpa: rcShearStrengthMpa,
          }),
          overrides: await this.fetchMachineOverrides(id, accessToken, location),
        }
      : undefined;

    const rateWarnThresholds = await this.loadRateWarnThresholds(accessToken, comparisonWarnings);
    const mhrRates = await this.resolveMHRRates(accessToken, location, physics, family, rates, comparisonWarnings, rateWarnThresholds);

    // Derive laser power from machine selection (same pattern as getCostSummary
    // — real mhr_records.power_kw only, no hardcoded class-wide assumption, no
    // name-inference; see getCostSummary's own doc comment on this same field).
    const rcLaserPowerW: number | null = (mhrRates.laser.selection?.balanced?.candidate as any)?.capability?.powerKw
      ? (mhrRates.laser.selection!.balanced.candidate as any).capability.powerKw * 1000
      : null;
    // See getCostSummary's smLaserPowerEstimated for the full rationale —
    // 'seed' capability (e.g. Salvagnini L3-30, migration 459) is a real,
    // sourced, disclosed estimate, never equivalent to a verified nameplate
    // reading. Tracked here so route comparison's confidence never silently
    // reads 'verified' off the back of it either.
    const rcLaserPowerEstimated = (mhrRates.laser.selection?.balanced?.candidate as any)?.capabilitySource === 'seed';
    if (rcLaserPowerW == null) {
      const rcLaserMachineName = (mhrRates.laser.selection?.balanced?.candidate as any)?.machineName ?? mhrRates.laser.machineName ?? null;
      comparisonWarnings.push(
        `MISSING_MACHINE_DATA: real laser power not on file for ` +
        `${rcLaserMachineName ? `"${rcLaserMachineName}"` : 'the selected laser'} — ` +
        `add a verified power_kw to this machine's mhr_records row to resolve Laser Cut cycle time.`,
      );
    } else if (rcLaserPowerEstimated) {
      const rcLaserMachineName = (mhrRates.laser.selection?.balanced?.candidate as any)?.machineName ?? mhrRates.laser.machineName ?? null;
      comparisonWarnings.push(
        `ESTIMATED (not verified): ${rcLaserMachineName ?? 'the selected laser'}'s power ` +
        `(${rcLaserPowerW}W) is a disclosed engineering estimate from documented model specs, ` +
        `not a nameplate/PO reading of this specific unit — verify before finalizing this quote.`,
      );
    }
    // Use material-specific laser params when material is known — makes route comparison
    // cycle times consistent with the cost summary tab. Technology must match the
    // ACTUAL selected laser's class (fiber vs co2, migration 457) — never assume fiber.
    const rcLaserTechnology: 'fiber' | 'co2' = mhrRates.laser.machineClass === 'co2_laser' ? 'co2' : 'fiber';
    const rcLaserParams = (grade && rcLaserPowerW != null) ? await this.smLookup.getLaserParams(grade, thk, rcLaserPowerW, rcLaserTechnology) : null;

    // Manufacturing Physics Calculator architecture: laser cycle time comes
    // from the real "Sheet Metal - Laser Cutting Manufacturing" DB calculator
    // ONLY, via the same resolvePhysicsQuantity call getCostSummary uses — so
    // route comparison (and whatever applyRoute persists) can never silently
    // diverge from the cost-summary tab for the identical part. Resolved once
    // here (not inside the engine loop below) since only the fiber_laser
    // engine has a registered calculator; waterjet/turret keep their own
    // params-based formulas until their own migration.
    const rcLaserCalc = (cutLengthMm > 0 || pierceCount > 0)
      ? await this.resolvePhysicsQuantity(accessToken, {
          machineClass: 'fiber_laser',
          process: 'Laser Cutting',
          targetFieldNames: ['Total Time'],
          seedScope: {
            'Cutting Length': cutLengthMm,
            'No Of Starts': pierceCount,
            ...(rcLaserParams?.dataFound ? {
              'Cutting Speed': rcLaserParams.cuttingSpeedMPerMin,
              'Piercing Time Per Start': rcLaserParams.pierceTimeMin,
            } : {}),
          },
          seedProvenance: {
            'Cutting Length': 'CAD feature extraction — total cut path length',
            'No Of Starts': 'CAD feature extraction — pierce/start count',
            'Cutting Speed': `sm_lookup_laser_cut — ${grade || 'material'}, ${thk}mm sheet` +
              (rcLaserPowerEstimated ? ` at an ESTIMATED (not verified) machine power` : ''),
            'Piercing Time Per Start': 'sm_lookup_laser_cut — same row as Cutting Speed',
          },
          lookupTableByField: {
            'Cutting Speed': 'sm_lookup_laser_cut',
            'Piercing Time Per Start': 'sm_lookup_laser_cut',
          },
          // See the matching comment on getCostSummary's own smLaserCalc call
          // — when power itself isn't on file, the table is never queried at
          // all, so the generic "no rows on file" gap wording would
          // misreport a real MISSING_MACHINE_DATA block as a coverage gap.
          ...(rcLaserPowerW == null ? {
            lookupResolutions: {
              'Cutting Speed': {
                table: 'sm_lookup_laser_cut',
                policy: await this.smLookup.resolveLookupPolicy('sm_lookup_laser_cut', 'INTERPOLATE'),
                queryParams: [{
                  column: 'laser_power_w',
                  value: `unknown — ${(mhrRates.laser.selection?.balanced?.candidate as any)?.machineName ?? mhrRates.laser.machineName ?? 'the selected laser'} has no verified power_kw on file (never inferred from its name)`,
                }],
                matchedRow: null,
                nearestRows: [],
              },
            },
          } : {}),
        })
      : this.emptyPhysicsResult(['Total Time']);
    const rcLaserCycleTimeSec = rcLaserCalc.outputs['Total Time'];

    // Same pattern for waterjet (migration 398's sm_lookup_waterjet_cut) — resolved
    // ONCE here and passed into computeWaterjetCost as plain numbers, exactly like
    // rcLaserParams above, so this is the ONLY place real waterjet cutting speed/
    // pierce time gets resolved. Without this, computeWaterjetCost silently used its
    // own hardcoded, material-blind fallback table, which is why the persisted
    // cycle time for an applied Waterjet Cutting route (via computeWaterjetCost's
    // caller below) diverged from the real, material-aware number the Cycle Time
    // calculator (ProcessCostDialog.tsx, wired to this same sm_lookup_waterjet_cut
    // table) computed for the identical part.
    const rcWaterjetParams = grade ? await this.smLookup.getWaterjetParams(grade, thk) : null;

    const attachToRoutes = (dto: RouteComparisonDto): RouteComparisonDto => {
      for (const route of dto.routes) {
        this.attachMachineSelections(route.processLines, mhrRates);
        // Inherited tapping runs on THIS route's primary machine — surface that
        // machine on the Tapping line, not the "class default (tapping)" panel.
        if (mhrRates.tapping.source !== 'mhr_database') {
          const primaryLine =
            route.processLines.find((l) => l.process === 'Setup') ?? route.processLines[0];
          const primarySelection = primaryLine
            ? (Object.values(mhrRates) as MHRRateInput[]).find((r) => r && typeof r.machineClass === 'string' && r.machineClass === primaryLine.machineClass)
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
        mhrRates.benchmarkMap,
        rateWarnThresholds,
      );
      return this.normalizeRouteComparisonToCurrency(dto, rates, locInfo.code, item.scenarioOverrides);
    };

    // Resolve surface treatment and waterjet abrasive from DB — used by CNC and SM route paths.
    // Both are non-blocking: null / 0 triggers warnings in the cost engine, not crashes.
    const [cncSurfaceTreatmentDbRate, waterjetAbrasivePricePerKg] = await Promise.all([
      this.resolveSurfaceTreatmentDbRate(
        accessToken,
        classifySurfaceTreatment(this.resolveSurfaceTreatment(item)),
        location,
        rates,
        this.resolveSurfaceTreatment(item),
        (item.surfaceArea ?? 0) as number,
        batchSize,
      ),
      this.resolveConsumablePrice(accessToken, 'garnet_abrasive', location, rates),
    ]);

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
          inspection, cncSurfaceTreatmentDbRate,
        ));
      }
      return attachToRoutes(this.buildCNCTurnedRoutes(
        id, item, fg, summary, grade, materialCostPerKg, materialDensityKgM3,
        materialSource, mhrRates, batchSize, comparisonWarnings, locInfo, location,
        inspection, cncSurfaceTreatmentDbRate,
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
          isFeasible: false,
          totalCost: null,
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
      const imBboxRC = [
        ((item as any).maxLength ?? 0) as number,
        ((item as any).maxWidth ?? 0) as number,
        ((item as any).maxHeight ?? 0) as number,
      ].sort((a, b) => b - a);
      const cadWallMmRC = (summary.wallThicknessNominalMm ?? 0) as number;
      const bboxMinMmRC = imBboxRC[2] ?? 0;
      const effectiveWallMmRC = cadWallMmRC > 0
        ? cadWallMmRC
        : (bboxMinMmRC > 0 && bboxMinMmRC <= 20 ? bboxMinMmRC : 0);
      const projectedAreaMm2 = imBboxRC[0] * imBboxRC[1] > 0 ? imBboxRC[0] * imBboxRC[1] : null;
      const partVolumeMm3 = (item.volume ?? 0) as number;
      const annualVolume = ((item as any).annualVolume as number | null | undefined) ?? undefined;

      const imSignals = {
        projectedAreaMm2,
        wallThicknessMinMm: (summary.wallThicknessMinMm as number) > 0 ? (summary.wallThicknessMinMm as number) : null,
        wallThicknessMaxMm: (summary.wallThicknessMaxMm as number) > 0 ? (summary.wallThicknessMaxMm as number) : null,
        ribCount: (summary.ribCount as number) > 0
          ? (summary.ribCount as number)
          : (summary.ribCountProxy as number) > 0 ? (summary.ribCountProxy as number) : null,
        bossCount: (summary.blindFeatureCount as number) > 0 ? (summary.blindFeatureCount as number) : null,
        undercutCount: (summary.undercutFaceCount as number) > 0 ? (summary.undercutFaceCount as number) : null,
        partingComplexity: (summary.partingComplexity as number | null) ?? null,
        insertCount: (summary.insertCandidateCount as number) > 0 ? (summary.insertCandidateCount as number) : null,
      };

      // Cavity count estimation for pre-selection clamp requirement
      const cavityCountEst = projectedAreaMm2 != null
        ? recommendCavityCount({
            projectedAreaMm2,
            annualVolume: annualVolume ?? 10_000,
            clampTonnageKN: 2000, // neutral 200T baseline for pre-selection
            shotCapacityCm3: 180,
            partVolumeMm3,
            gateType: 'edge',
          }).count
        : 1;

      // Runner volume estimate: 10% of part volume for cold runner; 0 for hot
      const runnerVolumeMm3 = partVolumeMm3 * 0.10;

      const imReq: IMSelectionRequirements = {
        projectedAreaMm2,
        cavityCount: cavityCountEst,
        partVolumeMm3,
        runnerVolumeMm3,
        materialDensityKgM3,
        materialGrade: grade,
        partLengthMm: imBboxRC[0] > 0 ? imBboxRC[0] : null,  // largest bbox dim
        partWidthMm: imBboxRC[1] > 0 ? imBboxRC[1] : null,
        partHeightMm: imBboxRC[2] > 0 ? imBboxRC[2] : null,
        // Tool height estimate: bbox max + 100mm tooling allowance (conservative)
        estimatedToolHeightMm: imBboxRC[0] > 0 ? imBboxRC[0] + 100 : null,
      };

      // Fetch machine pool and run tier-based 4-constraint selection.
      // Each tier (Small ≤120T / Standard 121–350T / Large 351T+) picks the best
      // DB machine in range; falls back to a synthetic class rate when the DB has
      // no machine for that tier so the comparison always shows 3 routes.
      let tierResults: ReturnType<typeof selectIMmachinesByTier> = [];
      try {
        const pool = await fetchMachinePool(this.supabaseService.getClient(accessToken), location);
        tierResults = selectIMmachinesByTier(pool, imReq);
      } catch (e) {
        this.logger.warn(
          `IM machine selection failed, using synthetic fallback: ${e instanceof Error ? e.message : e}`,
        );
      }

      // If pool fetch failed entirely, seed an empty tier structure
      if (tierResults.length === 0) {
        tierResults = [
          { tierId: 'small',  tierLabel: 'Small Press',    evaluation: null, syntheticTonnageT: 100  },
          { tierId: 'medium', tierLabel: 'Standard Press', evaluation: null, syntheticTonnageT: 200  },
          { tierId: 'large',  tierLabel: 'Large Press',    evaluation: null, syntheticTonnageT: 500  },
        ];
      }

      // MHR rate multipliers relative to the DB-selected standard rate
      // USA reference: 100T≈$65/hr (0.76×), 200T≈$85/hr (1.0×), 500T≈$130/hr (1.53×)
      // These ratios hold across all locations since they scale from the same baseline.
      const baseMhrRate = mhrRates.injectionMolding.rate;
      const TIER_RATE_MULT: Record<string, number> = { small: 0.76, medium: 1.00, large: 1.53 };

      // Synthetic clamp/shot specs per tier (used when no DB machine exists)
      const TIER_SPECS: Record<string, { clampKN: number; shotCm3: number; label: string }> = {
        small:  { clampKN: 1000, shotCm3: 90,  label: 'Small Press (100T)'    },
        medium: { clampKN: 2000, shotCm3: 180, label: 'Standard Press (200T)' },
        large:  { clampKN: 5000, shotCm3: 450, label: 'Large Press (500T)'    },
      };

      const TIER_ROUTE_IDS: Record<string, 'im-small-50t' | 'im-standard-200t' | 'im-large-500t'> = {
        small:  'im-small-50t',
        medium: 'im-standard-200t',
        large:  'im-large-500t',
      };

      const imRoutes: RouteResultDto[] = tierResults.map((tier) => {
        const ev = tier.evaluation;
        const cand = ev?.candidate;
        const spec = TIER_SPECS[tier.tierId]!;
        const mult = TIER_RATE_MULT[tier.tierId] ?? 1.0;

        const mhrRate: InjectionMoldingCostInput['mhrRate'] = cand
          ? { rate: cand.hourlyRate, source: cand.machineId ? 'mhr_database' : 'default_rate',
              machineClass: 'injection_molding', machineName: cand.machineName, commodityCode: cand.commodityCode }
          : { rate: Math.round(baseMhrRate * mult), source: 'tier_synthetic',
              machineClass: 'injection_molding', machineName: null, commodityCode: null };

        const clampKN = cand?.capability.maxTonnage != null
          ? cand.capability.maxTonnage * 10
          : spec.clampKN;
        const shotCm3 = cand?.capability.shotCapacityGrams != null
          ? cand.capability.shotCapacityGrams / (materialDensityKgM3 / 1000)
          : spec.shotCm3;

        const imInput: InjectionMoldingCostInput = {
          volume: partVolumeMm3, surfaceArea: (item.surfaceArea ?? 0) as number,
          wallThicknessNominalMm: effectiveWallMmRC, materialGrade: grade,
          materialCostPerKg, materialDensityKgM3, materialSource, batchSize, family,
          mhrRate, deburrRate: mhrRates.deburring, inspectionRate: mhrRates.inspection,
          clampTonnageKN: clampKN, shotCapacityCm3: shotCm3,
          annualVolume, productionLifeYears: 5,
          bboxMaxMm: imBboxRC[0], bboxMidMm: imBboxRC[1], signals: imSignals,
          currencySymbol: locInfo.symbol,
        };
        const cost = computeInjectionMoldedCostSummary(imInput);
        cost.warnings.push(...comparisonWarnings);
        if (ev && !ev.capable) cost.warnings.push(...ev.blockReasons.map((r) => `⚠ ${r}`));

        const isSynthetic = cand == null;
        const capable = ev ? ev.capable : true; // synthetic routes are always marked capable
        const routeLabel = cand?.machineName
          ? `${tier.tierLabel} — ${cand.machineName}`
          : spec.label;

        return {
          routeId: TIER_ROUTE_IDS[tier.tierId]!,
          routeLabel,
          processLines: cost.processLines, materialCost: cost.materialCost, abrasiveCost: 0,
          totalProcessCost: cost.totalProcessCost,
          isFeasible: capable,
          totalCost: capable ? cost.totalCost : null,
          cycleTimes: {
            cuttingMin: cost.cycleTimes.laserMin, pressBrakeMin: cost.cycleTimes.pressBrakeMin,
            tappingMin: cost.cycleTimes.tappingMin, deburrMin: cost.cycleTimes.deburrMin,
            totalMin: cost.cycleTimes.totalMin,
          },
          badges: { lowestCost: false, fastest: false, bestQuality: false },
          capability: {
            cuttingCapable: capable, pressBrakeCapable: capable, overallCapable: capable,
            confidence: isSynthetic ? 'low' : cand!.capabilitySource === 'imported' ? 'high' : 'medium',
            estimatedTonnage: cand?.capability.maxTonnage ?? tier.syntheticTonnageT,
            reasonCodes: capable ? [] : ['DIMENSIONS_UNAVAILABLE' as const],
            warnings: ev?.blockReasons ?? [],
          },
          warnings: cost.warnings, ratesSource: cost.ratesSource,
          sustainability: cost.sustainability ? {
            totalCo2Kg: cost.sustainability.totalCo2Kg,
            totalProcessEnergyKwh: cost.sustainability.totalProcessEnergyKwh,
            wasteCostInr: cost.sustainability.wasteCostInr,
            sustainabilityScore: cost.sustainability.sustainabilityScore,
          } : undefined,
        } satisfies RouteResultDto;
      });

      const capableRoutes = imRoutes.filter((r) => r.capability.overallCapable);
      if (capableRoutes.length > 0) {
        const feasibleRoutes = capableRoutes.filter((r) => r.isFeasible && r.totalCost != null);
        if (feasibleRoutes.length > 0) {
          const minFeasibleCost = Math.min(...feasibleRoutes.map((r) => r.totalCost!));
          feasibleRoutes.forEach((r) => { r.badges.lowestCost = r.totalCost === minFeasibleCost; });
        }
        capableRoutes.reduce((a, b) => a.cycleTimes.totalMin < b.cycleTimes.totalMin ? a : b).badges.fastest = true;
        // bestQuality = DB machine with clamp utilisation closest to 60-85% sweet spot
        const capableTiers = tierResults.filter((t) =>
          t.evaluation?.capable || t.evaluation == null,
        );
        const bestTier = capableTiers
          .filter((t) => t.evaluation != null)
          .sort((a, b) => {
            const au = a.evaluation!.clampUtil;
            const bu = b.evaluation!.clampUtil;
            const aInRange = au != null && au >= 0.60 && au <= 0.85 ? 1 : 0;
            const bInRange = bu != null && bu >= 0.60 && bu <= 0.85 ? 1 : 0;
            return bInRange - aInRange || b.evaluation!.score - a.evaluation!.score;
          })[0];
        const qualRoute = bestTier
          ? imRoutes[tierResults.indexOf(bestTier)]
          : capableRoutes[capableRoutes.length - 1];
        if (qualRoute) qualRoute.badges.bestQuality = true;
      }

      const imGrossKg = (partVolumeMm3 / 1e9) * materialDensityKgM3 * (1 + MATERIAL_OVERHEAD_PCT / 100);
      const medRoute = imRoutes.find((r) => r.routeId === 'im-standard-200t') ?? imRoutes[0];
      return attachToRoutes({
        bomItemId: id, batchSize,
        materialCost: medRoute?.materialCost ?? 0,
        materialGrade: grade ?? '', grossWeightKg: imGrossKg, materialCostPerKg, materialSource,
        currency: locInfo.code, currencySymbol: locInfo.symbol,
        routes: imRoutes, comparisonWarnings,
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
    // Press brake capability is shared across every cutting route (all of them
    // route through press brake for bending) — computed once here. Each cutting
    // engine's own capability check happens inside the registry loop below,
    // merged with this shared one via mergeCuttingAndPressBrakeCapability.
    const pbCapability = checkMachineCapability(
      mhrRates.pressBrake.machineClass,
      mhrRates.pressBrake.commodityCode,
      capabilityGeometry,
      mhrRates.pressBrake.selection?.balanced?.candidate?.capability,
      mhrRates.pressBrake.selection?.balanced?.candidate?.capabilitySource,
    );

    const CONF_RANK = { high: 2, medium: 1, low: 0 } as const;
    const minConf = (a: "high" | "medium" | "low", b: "high" | "medium" | "low"): "high" | "medium" | "low" =>
      CONF_RANK[a] <= CONF_RANK[b] ? a : b;
    const mergeCuttingAndPressBrakeCapability = (cutting: MachineCapabilityCheck, pb: MachineCapabilityCheck): RouteCapability => ({
      cuttingCapable:    cutting.capable,
      pressBrakeCapable: pb.capable,
      overallCapable:    cutting.capable && pb.capable,
      confidence:        minConf(cutting.confidence, pb.confidence),
      estimatedTonnage:  pb.estimatedTonnage,
      reasonCodes:       [...cutting.reasonCodes, ...pb.reasonCodes],
      warnings:          [...cutting.reasons, ...pb.reasons],
    });

    // Real cycle-time/setup-time lookups shared by the cutting-route loop below
    // and the shared press-brake/deburr lines here — resolved once, disclosed
    // via comparisonWarnings when a table has no row yet (never silent).
    // See migrations 413 (deburr), 414 (turret punch), 415 (waterjet abrasive),
    // 416 (setup times).
    const [rcOpSetupTimes, rcTurretParams, rcRealTurretParams, rcAbrasiveRate, rcRealAbrasiveRate, rcDeburrRate, rcHandlingAllowance, rcNozzleRate] = await Promise.all([
      this.smLookup.getOpSetupTimes(),
      this.smLookup.getTurretPunchParams(thk),
      this.smLookup.getTurretPunchParamsForMachine(mhrRates.turret.machineName),
      this.smLookup.getWaterjetAbrasiveRate(),
      this.smLookup.getWaterjetAbrasiveRateForMachine(mhrRates.waterjet.machineName),
      this.smLookup.getDeburrRate(),
      this.smLookup.getHandlingAllowanceUsd('turret_punch', grossWeightKg),
      this.smLookup.getWaterjetNozzleCostPerHr(),
    ]);
    // The specific selected machine's own real abrasive rate (machine_library.json,
    // via sm_reference_data) always wins over the generic pump-tier average when
    // it's on file — see getWaterjetAbrasiveRateForMachine's own doc comment.
    const effectiveAbrasiveRate = rcRealAbrasiveRate.dataFound ? rcRealAbrasiveRate : rcAbrasiveRate;
    // Same real-machine-wins-outright rule for turret punch rate/tool-change
    // time — see getTurretPunchParamsForMachine's own doc comment for why
    // nibbleMmPerMin is deliberately left untouched (no direct real-data
    // source for it). Only applied when the thickness curve itself found a
    // row (so nibbleMmPerMin/dataFound still come from a real source) —
    // TurretParams.dataFound is all-or-nothing, so partial real data can't
    // safely stand in when there's no thickness-curve row at all.
    const effectiveTurretParams = rcTurretParams.dataFound
      ? {
          ...rcTurretParams,
          hitsPerMin: rcRealTurretParams.hitsPerMin ?? rcTurretParams.hitsPerMin,
          toolChangeSec: rcRealTurretParams.toolChangeSec ?? rcTurretParams.toolChangeSec,
        }
      : rcTurretParams;
    const rcPbSetupMin = this.smLookup.resolveOpSetupMin(rcOpSetupTimes, 'press_brake');
    if (!rcPbSetupMin.dataFound) {
      comparisonWarnings.push("Press brake setup time from fallback — seed sm_lookup_op_setup_time for 'press_brake'");
    }
    if (!rcTurretParams.dataFound) {
      comparisonWarnings.push('Turret punch cycle-time params from fallback — seed sm_lookup_turret_punch for this thickness');
    }
    if (!effectiveAbrasiveRate.dataFound) {
      comparisonWarnings.push('Waterjet abrasive consumption rate from fallback — seed sm_lookup_waterjet_abrasive_rate, or add this machine to the machine library reference data');
    }
    if (!rcDeburrRate.dataFound) {
      comparisonWarnings.push('Deburr cycle-time rate from fallback — seed sm_lookup_deburr_rate');
    }

    // ── Shared process lines (computed once, reused across all three routes) ───

    const pbLines: ProcessLineCost[] = [];
    let pressBrakeMin = 0;
    if (bendCount > 0) {
      // Manufacturing Physics Calculator architecture: cycle/setup time come
      // from the real "Sheet Metal - Bending Manufacturing" DB calculator
      // ONLY, via the same resolvePhysicsQuantity call getCostSummary uses —
      // so route comparison (and whatever applyRoute persists from it) can
      // never silently diverge from the cost-summary tab or the interactive
      // Cycle Time calculator for the same part. No second, independent
      // formula and no PRESS_BRAKE_SEC_PER_BEND fallback here anymore — a
      // real coverage gap surfaces as a structured warning, not a guess.
      const rcBendComplexity: 'simple' | 'complex' =
        (((item as any).complexity ?? fg?.summary?.complexity) === 'complex') ? 'complex' : 'simple';
      const rcBendLengthMm = capabilityGeometry.bendLengthMm ?? 200;
      const rcBendTonnage = Math.ceil(
        estimateBendTonnage(utsMpa, thk, rcBendLengthMm) ?? 0,
      );
      // See resolveStrokeLookupTonnage's own doc comment — stroke time
      // belongs to the selected press brake's real tonnage capacity, not
      // this bend's own minimum required force.
      const rcBendStrokeTonnage = this.resolveStrokeLookupTonnage(rcBendTonnage, mhrRates.pressBrake);
      const [rcStrokeResult, rcHandlingResult, rcBrakeSetupResult] = await Promise.all([
        this.smLookup.getManualStrokeTimeForPressBrake(thk, rcBendStrokeTonnage, rcBendComplexity, mhrRates.pressBrake.machineName),
        this.smLookup.getHandlingTime(flatPatternAreaMm2 * thk / 1e9 * materialDensityKgM3 * 1.05),
        this.smLookup.getToolSetupTime('brake', Math.min(rcBendLengthMm, 500)),
      ]);
      if (!rcStrokeResult.dataFound) {
        comparisonWarnings.push('Press brake stroke time from fallback — seed sm_lookup_manual_stroke for accurate cycle times.');
      }
      if (!rcHandlingResult.dataFound) {
        comparisonWarnings.push('Material handling time from fallback — seed sm_lookup_handling_time for accurate estimates.');
      }
      if (!rcBrakeSetupResult.dataFound) {
        comparisonWarnings.push('Press brake tool setup time from fallback — seed sm_lookup_tool_setup for accurate estimates.');
      }

      const rcBendCalc = await this.resolvePhysicsQuantity(accessToken, {
        machineClass: 'press_brake',
        process: 'Press Brake',
        targetFieldNames: ['Cycle Time', 'Setup Time'],
        seedScope: {
          Thickness: thk,
          'Bending Line Length': rcBendLengthMm,
          'Shoulder Width': 8 * thk,
          ...(utsMpa != null ? { UTS: utsMpa } : {}),
          'No Of Bends': bendCount,
          ...(rcStrokeResult.dataFound ? { 'Time Per Stroke': rcStrokeResult.secondsPerBend } : {}),
          ...(rcHandlingResult.dataFound ? { 'Sheet Loading Time': rcHandlingResult.minutes } : {}),
          ...(rcBrakeSetupResult.dataFound ? { 'Tool Loading Time': rcBrakeSetupResult.minutes } : {}),
          'Lot Size': batchSize,
        },
        seedProvenance: {
          Thickness: 'BOM sheet thickness',
          'Bending Line Length': 'CAD/BOM part geometry — max bend length',
          'Shoulder Width': 'Approximated as 8× sheet thickness (standard V-die shoulder rule)',
          UTS: 'raw_materials — material grade Ultimate Tensile Strength',
          'No Of Bends': 'CAD/drawing feature extraction — bend count',
          'Time Per Stroke': this.describeStrokeTimeProvenance(thk, rcBendComplexity, rcStrokeResult.resolution, rcStrokeResult.roundedFromTonnage),
          'Sheet Loading Time': 'sm_lookup_handling_time — part weight estimate',
          'Tool Loading Time': 'sm_lookup_tool_setup — brake tool length',
          'Lot Size': 'Batch size for this route comparison',
        },
        lookupTableByField: {
          'Time Per Stroke': 'sm_lookup_manual_stroke',
          'Sheet Loading Time': 'sm_lookup_handling_time',
          'Tool Loading Time': 'sm_lookup_tool_setup',
        },
        lookupResolutions: {
          'Time Per Stroke': rcStrokeResult.resolution,
        },
      });

      const pbRate = mhrRates.pressBrake;
      const rcCycleTimeSec = rcBendCalc.outputs['Cycle Time'];
      if (typeof rcCycleTimeSec === 'number' && Number.isFinite(rcCycleTimeSec)) {
        pressBrakeMin = rcCycleTimeSec / 60;
      } else if (rcBendCalc.gap) {
        const gap = rcBendCalc.gap;
        comparisonWarnings.push(gap.gapType === 'missing_lookup'
          ? `Press brake cycle time unavailable — ${gap.requiredAction}`
          : `Press brake cycle time unavailable — ${gap.reason}`);
      } else {
        comparisonWarnings.push('Press brake cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
      }
      const rcSetupTimeSec = rcBendCalc.outputs['Setup Time'];
      const setupTimeMin = (typeof rcSetupTimeSec === 'number' && Number.isFinite(rcSetupTimeSec))
        ? rcSetupTimeSec
        : rcPbSetupMin.minutes;
      const totalPBSec = pressBrakeMin * 60;
      const setupCost = this.r2((setupTimeMin / 60) * pbRate.rate / Math.max(batchSize, 1));
      const runCost   = this.r2((totalPBSec / 3600) * pbRate.rate);
      pbLines.push({
        process: 'Press Brake',
        setupCost, runCost, totalCost: this.r2(setupCost + runCost),
        cycleTimeMin: this.r2(pressBrakeMin),
        hourlyRate: pbRate.rate, rateSource: pbRate.source,
        machineClass: pbRate.machineClass, machineName: pbRate.machineName, commodityCode: pbRate.commodityCode,
        ...(rcBendCalc.calculatorId ? { calculatorId: rcBendCalc.calculatorId } : {}),
        ...(rcBendCalc.calculatorVersion != null ? { calculatorVersion: rcBendCalc.calculatorVersion } : {}),
        ...(rcBendCalc.gap ? { physicsGap: rcBendCalc.gap } : {}),
        ...(rcBendCalc.confidence ? { confidence: rcBendCalc.confidence } : {}),
      });
    }

    const deburrLines: ProcessLineCost[] = [];
    let deburrMin = 0;
    // Real process_calculator_mappings identity per machine class for every line
    // built inline in this method (deburr/tapping/laser/turret/waterjet below) —
    // resolved from the DB once, never hardcoded. A class absent from the map is
    // simply omitted from its line rather than fabricated.
    const routeCompareProcessIdentities = await this.resolveProcessIdentities(accessToken, [
      mhrRates.deburring.machineClass,
      mhrRates.tapping.machineClass,
      mhrRates.laser.machineClass,
      mhrRates.turret.machineClass,
      mhrRates.waterjet.machineClass,
      mhrRates.holeForming.machineClass,
      mhrRates.inspection.machineClass,
    ], family);

    // Disclosed gap: active Sheet Metal cutting-shaped catalog rows (Sheet
    // Cutting / Laser Cutting / Waterjet Cutting routes) whose machine_class has
    // no registered ManufacturingProcessEngine — e.g. Plasma Cutting, Co2 Laser
    // Cutting on file today. Never silently dropped: surfaced once here as a
    // comparisonWarnings entry so the gap is visible, not fabricated into a cost.
    try {
      const registeredCuttingClasses = new Set(getEnginesForFamily('sheet_metal_cutting').map((e) => e.machineClass));
      const { data: cuttingCatalogRows } = await this.supabaseService
        .getClient(accessToken)
        .from('process_calculator_mappings')
        .select('machine_class, operation')
        .eq('process_group', 'Sheet Metal')
        .in('process_route', ['Sheet Cutting', 'Laser Cutting', 'Cutting', 'Sheet Metal Fabrication'])
        .eq('is_active', true)
        .not('machine_class', 'is', null);
      const ungatedOps = [...new Set(
        (cuttingCatalogRows ?? [])
          .filter((r: any) => !registeredCuttingClasses.has(r.machine_class))
          .map((r: any) => r.operation),
      )];
      if (ungatedOps.length > 0) {
        comparisonWarnings.push(
          `${ungatedOps.length} catalog cutting operation(s) have no cost engine implemented yet (${ungatedOps.join(', ')}) — not offered as a route`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`Disclosed cutting-gap check failed: ${err.message}`, 'BOMItemsService');
    }

    if (cutLengthMm > 0) {
      // Manufacturing Physics Calculator architecture: cycle time comes from
      // the real "Sheet Metal - Deburring" DB calculator ONLY, via the same
      // resolvePhysicsQuantity call getCostSummary uses — so route comparison
      // (and whatever applyRoute persists) can never silently diverge from
      // the cost-summary tab for the identical part.
      const rcDeburrCalc = await this.resolvePhysicsQuantity(accessToken, {
        machineClass: 'deburring',
        process: 'Deburring',
        targetFieldNames: ['Total Time'],
        seedScope: {
          'Length Of Cut (mm)': cutLengthMm,
          'No Of Starts': pierceCount,
          ...(rcDeburrRate.dataFound ? {
            'Sec Per Metre': rcDeburrRate.secPerMetre,
            'Sec Per Pierce': rcDeburrRate.secPerPierce,
          } : {}),
        },
        seedProvenance: {
          'Length Of Cut (mm)': 'CAD feature extraction — total cut path length',
          'No Of Starts': 'CAD feature extraction — pierce/start count',
          'Sec Per Metre': 'sm_lookup_deburr_rate — edge deburr rate for this material/process',
          'Sec Per Pierce': 'sm_lookup_deburr_rate — same row as Sec Per Metre',
        },
        lookupTableByField: {
          'Sec Per Metre': 'sm_lookup_deburr_rate',
          'Sec Per Pierce': 'sm_lookup_deburr_rate',
        },
      });
      const deburrSec = rcDeburrCalc.outputs['Total Time'];
      if (typeof deburrSec === 'number' && Number.isFinite(deburrSec)) {
        deburrMin = deburrSec / 60;
      } else if (rcDeburrCalc.gap) {
        const gap = rcDeburrCalc.gap;
        comparisonWarnings.push(gap.gapType === 'missing_lookup'
          ? `Deburring cycle time unavailable — ${gap.requiredAction}`
          : `Deburring cycle time unavailable — ${gap.reason}`);
      } else {
        comparisonWarnings.push('Deburring cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
      }
      const deburrRate = mhrRates.deburring;
      const runCost = this.r2(((deburrSec ?? 0) / 3600) * deburrRate.rate);
      const deburrIdentity = routeCompareProcessIdentities[deburrRate.machineClass];
      deburrLines.push({
        process: 'Deburring',
        ...(deburrIdentity ? { processGroup: deburrIdentity.processGroup, processRoute: deburrIdentity.processRoute, operation: deburrIdentity.operation } : {}),
        setupCost: 0, runCost, totalCost: runCost,
        cycleTimeMin: this.r2(deburrMin),
        hourlyRate: deburrRate.rate, rateSource: deburrRate.source,
        machineClass: deburrRate.machineClass, machineName: deburrRate.machineName, commodityCode: deburrRate.commodityCode,
        ...(rcDeburrCalc.calculatorId ? { calculatorId: rcDeburrCalc.calculatorId } : {}),
        ...(rcDeburrCalc.calculatorVersion != null ? { calculatorVersion: rcDeburrCalc.calculatorVersion } : {}),
        ...(rcDeburrCalc.gap ? { physicsGap: rcDeburrCalc.gap } : {}),
        ...(rcDeburrCalc.confidence ? { confidence: rcDeburrCalc.confidence } : {}),
      });
    }

    // Hole Extrusion (Burring) — identical 3-stage computation to getCostSummary
    // (estimateBurlTonnage force calc → getManualStrokeTime lookup → mhrRates.
    // holeForming rate), not a re-derived approximation. Route-independent (the
    // burl must happen regardless of which cutting method the candidate route
    // uses), so computed once here and reused across all three routes below —
    // must run before tappingLines since hole extrusion precedes tapping.
    const burringLines: ProcessLineCost[] = [];
    const rcExtrudedFlangeCount = summary.extrudedFlangeCount ?? 0;
    if (rcExtrudedFlangeCount > 0) {
      // See the identical warning in getCostSummary for why — no per-hole
      // extruded-flange linkage exists yet, so with no tapped threads to
      // average from, this falls back to the smallest hole on the WHOLE
      // part, which may not be the one actually being burred.
      const rcThreadTotalCount = threads.reduce((s, t) => s + t.count, 0);
      if (rcThreadTotalCount === 0) {
        comparisonWarnings.push(
          'Hole-extrusion (burring) diameter approximated from the smallest detected hole ' +
          '(no tapped-thread features to average from) — verify against the actual burred hole size on the drawing.',
        );
      }
      const burlDiameterMm = estimateBurlDiameterMm(threads, summary.holeDiameters ?? []);
      const rcBurlTonnage = Math.ceil(estimateBurlTonnage(utsMpa, thk, burlDiameterMm) ?? 0);
      const rcBurlComplexity: 'simple' | 'complex' =
        (((item as any).complexity ?? fg?.summary?.complexity) === 'complex') ? 'complex' : 'simple';
      // See resolveStrokeLookupTonnage's own doc comment — stroke time
      // belongs to the selected hole-forming machine's real tonnage
      // capacity, not this hole's own minimum required force.
      const rcBurlStrokeTonnage = this.resolveStrokeLookupTonnage(rcBurlTonnage, mhrRates.holeForming);
      const rcBurlStroke = await this.smLookup.getManualStrokeTime(thk, rcBurlStrokeTonnage, rcBurlComplexity);
      const totalBurlSec = rcExtrudedFlangeCount * rcBurlStroke.secondsPerBend;
      const burringMin = totalBurlSec / 60;
      const holeFormingRate = mhrRates.holeForming;
      const setupCost = this.r2((BURRING_SETUP_MIN / 60) * holeFormingRate.rate / Math.max(batchSize, 1));
      const runCost   = this.r2((totalBurlSec / 3600) * holeFormingRate.rate);
      const burringIdentity = routeCompareProcessIdentities[holeFormingRate.machineClass];
      burringLines.push({
        process: 'Hole Extrusion (Burring)',
        ...(burringIdentity ? { processGroup: burringIdentity.processGroup, processRoute: burringIdentity.processRoute, operation: burringIdentity.operation } : {}),
        setupCost, runCost, totalCost: this.r2(setupCost + runCost),
        cycleTimeMin: this.r2(burringMin),
        hourlyRate: holeFormingRate.rate, rateSource: holeFormingRate.source,
        machineClass: holeFormingRate.machineClass, machineName: holeFormingRate.machineName, commodityCode: holeFormingRate.commodityCode,
      });
    }

    const tappingLines: ProcessLineCost[] = [];
    let tappingMin = 0;
    if (threads.length > 0) {
      // Manufacturing Physics Calculator architecture: cycle time comes from
      // the real "Machining - Tapping" DB calculator ONLY, via the same
      // resolveTappingCycleTimeSec() helper getCostSummary uses — so route
      // comparison (and whatever applyRoute persists) can never silently
      // diverge from the cost-summary tab for the identical part. depthMm is
      // stripped (always undefined) here — real depth is never extracted for
      // threads on this path (drawing-OCR'd threads carry no depth field),
      // matching this call site's pre-migration behavior exactly.
      const rcThreadsNoDepth = threads.map((t) => ({ ...t, depthMm: undefined }));
      const rcTappingCalc = await this.resolveTappingCycleTimeSec(accessToken, rcThreadsNoDepth, sheetThicknessMm, grade);
      const totalSec = rcTappingCalc.cycleTimeSec;
      if (typeof totalSec === 'number' && Number.isFinite(totalSec)) {
        tappingMin = totalSec / 60;
      } else if (rcTappingCalc.gap) {
        const gap = rcTappingCalc.gap;
        comparisonWarnings.push(gap.gapType === 'missing_lookup'
          ? `Tapping cycle time unavailable — ${gap.requiredAction}`
          : `Tapping cycle time unavailable — ${gap.reason}`);
      } else {
        comparisonWarnings.push('Tapping cycle time unavailable — no calculator result and no reported gap (unexpected; check resolveTappingCycleTimeSec).');
      }
      const tappingRate = mhrRates.tapping;
      const setupCost = this.r2((TAPPING_SETUP_MIN / 60) * tappingRate.rate / Math.max(batchSize, 1));
      const runCost   = this.r2(((totalSec ?? 0) / 3600) * tappingRate.rate);
      const tappingIdentity = routeCompareProcessIdentities[tappingRate.machineClass];
      tappingLines.push({
        process: 'Tapping',
        ...(tappingIdentity ? { processGroup: tappingIdentity.processGroup, processRoute: tappingIdentity.processRoute, operation: tappingIdentity.operation } : {}),
        setupCost, runCost, totalCost: this.r2(setupCost + runCost),
        cycleTimeMin: this.r2(tappingMin),
        hourlyRate: tappingRate.rate, rateSource: tappingRate.source,
        machineClass: tappingRate.machineClass, machineName: tappingRate.machineName, commodityCode: tappingRate.commodityCode,
        ...(rcTappingCalc.calculatorId ? { calculatorId: rcTappingCalc.calculatorId } : {}),
        ...(rcTappingCalc.calculatorVersion != null ? { calculatorVersion: rcTappingCalc.calculatorVersion } : {}),
        ...(rcTappingCalc.gap ? { physicsGap: rcTappingCalc.gap } : {}),
        ...(rcTappingCalc.confidence ? { confidence: rcTappingCalc.confidence } : {}),
      });
    }

    // Inspection (general-purpose, tiered — see costing/inspection-engine.ts).
    // Route-independent, same convention as burringLines/tappingLines above.
    const inspectionLines: ProcessLineCost[] = [];
    {
      const [rcInspectionOperationDefaults, rcInspectionRules, rcSamplingResult] = await Promise.all([
        this.smLookup.getInspectionOperationDefaults(),
        this.inspectionKnowledge.getInspectionRules(accessToken),
        this.smLookup.getSamplingRate(batchSize),
      ]);
      const rcHoleDiameters = (summary.holeDiameters ?? []) as number[];
      const rcBendLengths = (summary.bendLengths ?? []) as number[];
      const rcBendRadii = (summary.bendRadii ?? []) as number[];
      const rcDrawingIntel = (item.drawingIntelligence ?? null) as Record<string, any> | null;
      const rcGdtCallouts = ((rcDrawingIntel?.gdt_callouts ?? []) as any[]).map((c) => ({
        type: String(c.type ?? c.symbol ?? ''),
        toleranceMm: Number(c.toleranceMm ?? c.tolerance_mm ?? 0),
      }));
      const rcCmmRate = await this.resolveCmmSpecificRate(accessToken, location, rates, mhrRates.inspection, comparisonWarnings);
      const rcGenericInspectionRate = await this.resolveGenericInspectionRate(accessToken, location, rates, comparisonWarnings);
      const rcInspectionInput: InspectionInput = {
        holes: rcHoleDiameters.length > 0 ? rcHoleDiameters.map((d) => ({ diameterMm: d })) : Array.from({ length: holeCount }, () => ({})),
        bends: rcBendLengths.length > 0 ? rcBendLengths.map((len, i) => ({ lengthMm: len, radiusMm: rcBendRadii[i] })) : Array.from({ length: bendCount }, () => ({})),
        sheetThicknessMm,
        hasOverallDimensions: (flatPatternLengthMm ?? 0) > 0 && (flatPatternWidthMm ?? 0) > 0 && (((item as any).maxHeight ?? 0) as number) > 0,
        threads,
        generalTolerances: (rcDrawingIntel?.general_tolerances ?? null) as string | null,
        toleranceConfidence: Number(rcDrawingIntel?.tolerance_confidence ?? 0),
        gdtCallouts: rcGdtCallouts,
        inspectionRules: rcInspectionRules,
        operationDefaults: rcInspectionOperationDefaults,
        inspectionStrategy: 'sampling',
        samplingRate: rcSamplingResult.rate,
        batchSize,
        rate: rcGenericInspectionRate,
        cmmRate: rcCmmRate,
        qaInspectorRatePerHr: mhrRates.qaInspectorRate ?? null,
        processIdentity: routeCompareProcessIdentities[mhrRates.inspection.machineClass],
      };
      // Manufacturing Physics Calculator architecture: same pattern as
      // getCostSummary — plan the real sampling/method/per-feature-time
      // decisions, resolve the sum via the real calculator, finalize the
      // line. See getCostSummary's identical block for the full rationale.
      const rcInspectionPlan = planInspection(rcInspectionInput);
      const rcInspectionCalc = rcInspectionPlan.skip
        ? this.emptyPhysicsResult(['Total Time'])
        : await this.resolvePhysicsQuantity(accessToken, {
            machineClass: mhrRates.inspection.machineClass,
            process: 'Inspection',
            targetFieldNames: ['Total Time'],
            seedScope: {
              'Visual Pass Base': rcInspectionPlan.visualPassBaseSec,
              'Holes to Inspect': rcInspectionPlan.holesToInspect,
              'Hole Check Time': rcInspectionPlan.holeCheckSec,
              'Bends to Inspect': rcInspectionPlan.bendsToInspect,
              'Bend Check Time': rcInspectionPlan.bendCheckSec,
              'Threads to Inspect': rcInspectionPlan.threadsToInspect,
              'Thread Gauge Time': rcInspectionPlan.threadGaugeSec,
              'Has Thickness Check': rcInspectionPlan.hasThicknessCheck ? 1 : 0,
              'Thickness Check Time': rcInspectionPlan.thicknessCheckSec,
              'Has Dimension Check': rcInspectionPlan.hasDimensionCheck ? 1 : 0,
              'Dimension Check Time': rcInspectionPlan.dimensionCheckSec,
            },
            seedProvenance: {
              'Visual Pass Base': 'inspection_operation_defaults — visual_base cycle time',
              'Holes to Inspect': 'Real sampling plan — feature count × AQL/strategy fraction',
              'Hole Check Time': `inspection_operation_defaults — hole check time for ${rcInspectionPlan.method} method`,
              'Bends to Inspect': 'Real sampling plan — feature count × AQL/strategy fraction',
              'Bend Check Time': `inspection_operation_defaults — bend check time for ${rcInspectionPlan.method} method`,
              'Threads to Inspect': 'Real sampling plan — feature count × AQL/strategy fraction',
              'Thread Gauge Time': `inspection_operation_defaults — thread gauge time for ${rcInspectionPlan.method} method`,
              'Has Thickness Check': 'Real geometry — sheet thickness known',
              'Thickness Check Time': `inspection_operation_defaults — thickness check time for ${rcInspectionPlan.method} method`,
              'Has Dimension Check': 'Real geometry — overall dimensions known',
              'Dimension Check Time': `inspection_operation_defaults — dimension check time for ${rcInspectionPlan.method} method`,
            },
          });
      const rcInspectionResult = finalizeInspectionLine(rcInspectionInput, rcInspectionPlan, {
        cycleTimeSec: rcInspectionCalc.outputs['Total Time'],
        calculatorId: rcInspectionCalc.calculatorId,
        calculatorVersion: rcInspectionCalc.calculatorVersion,
        gap: rcInspectionCalc.gap,
        confidence: rcInspectionCalc.confidence,
      });
      inspectionLines.push(...rcInspectionResult.processLines);
      comparisonWarnings.push(...rcInspectionResult.warnings);
    }

    // ── Cutting lines per route ────────────────────────────────────────────────
    // Computed generically below by the registry loop (after assembleRoute is
    // defined) — one engine.computeCost() call per registered process, no
    // per-machine-class block here anymore. See manufacturing-process-registry.ts's
    // doc comment for why membership there — not a process_calculator_mappings
    // catalog row existing — is what makes a cutting method real.

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
      // Burring + Tapping run BEFORE Press Brake + Deburr: the M3 threads sit
      // in the extruded collar (burl), so the collar must be formed and
      // tapped while the part is still flat — tapping into an already-bent
      // flange risks tool access/interference, and bending after tapping
      // means handling an already-threaded (and already-bent) part through
      // deburr instead of a flat blank. Real geometry-driven ordering call,
      // not an arbitrary reshuffle — see REAL_PROCESS_ORDER (page.tsx) for
      // the matching frontend sequencing.
      const allLines = [...cuttingLines, ...burringLines, ...tappingLines, ...pbLines, ...deburrLines, ...inspectionLines];
      const totalProcessCost = this.r2(allLines.reduce((s, l) => s + l.totalCost, 0) + abrasiveCost);
      const totalCost = this.r2(materialCost + totalProcessCost);
      const { totalCo2Kg, totalProcessEnergyKwh, wasteCostInr, sustainabilityScore } =
        computeSustainability(grade, materialCostPerKg, netWeightKg, grossWeightKg, batchSize, allLines);
      return {
        routeId, routeLabel,
        processLines: allLines,
        materialCost, abrasiveCost, totalProcessCost,
        isFeasible: capability.overallCapable,
        totalCost,
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

    // Each cutting route is offered only when BOTH are true: (1) this app has a
    // real, engineering-verified ManufacturingProcessEngine registered for the
    // machine class (MANUFACTURING_PROCESS_REGISTRY, via getEnginesForFamily —
    // never inferred from the catalog) and (2) the real process_calculator_
    // mappings catalog has an active row for that class for this part's family
    // (routeCompareProcessIdentities, resolved from the DB above — never
    // assumed). A route whose catalog mapping gets deactivated in the admin UI
    // stops being offered without any code change; a machine class with no
    // registered engine never gets offered no matter what the catalog says.
    // Neither condition alone is enough — this is the "engineering-gated, not
    // just data-driven" rule.
    //
    // Route id/label (ROUTE_ID_FOR_CLASS/ROUTE_LABEL_FOR_CLASS, imported from
    // manufacturing-process-registry.ts — shared with apply-route.dto.ts's
    // request validation) are a cosmetic UX lookup, not a candidacy gate —
    // falling back to the raw machine class keeps a future registered engine
    // (before its id/label are added there) visible rather than silently dropped.
    //
    // Local lookup by machine class, built from resolveMHRRates' existing fixed
    // fields — kept local rather than changing that method's return shape,
    // which has a dozen other unrelated fields (pressBrake, deburring,
    // injectionMolding, ...) read throughout getCostSummary and elsewhere.
    // Registering a future engine here means adding one field to resolveMHRRates
    // and one line to this map, same order of effort as today's registry entry.
    const mhrRatesByClass = new Map<string, MHRRateInput>([
      [mhrRates.laser.machineClass, mhrRates.laser],
      [mhrRates.turret.machineClass, mhrRates.turret],
      [mhrRates.waterjet.machineClass, mhrRates.waterjet],
    ]);

    const routes: RouteResultDto[] = [];
    for (const engine of getEnginesForFamily('sheet_metal_cutting')) {
      const identity = routeCompareProcessIdentities[engine.machineClass];
      const rate = mhrRatesByClass.get(engine.machineClass);
      if (!identity || !rate) continue; // no active catalog mapping, or no resolved rate — not offered, not fabricated

      const cutResult = engine.computeCost({
        sheetThicknessMm, cutLengthMm, pierceCount, holeCount, batchSize, grade, rate,
        processIdentity: identity,
        abrasivePricePerKg: waterjetAbrasivePricePerKg,
        waterjetParams: rcWaterjetParams,
        turretParams: effectiveTurretParams,
        abrasiveKgPerMin: effectiveAbrasiveRate.kgPerMin,
        opSetupMin: this.smLookup.resolveOpSetupMin(rcOpSetupTimes, engine.machineClass).minutes,
        partWeightKg: grossWeightKg,
        ...(engine.machineClass === 'turret_punch' ? { handlingAllowance: rcHandlingAllowance } : {}),
        ...(engine.machineClass === 'waterjet' ? { nozzleRate: rcNozzleRate } : {}),
        ...(engine.machineClass === 'fiber_laser' ? {
          cuttingSecFromCalculator: rcLaserCycleTimeSec,
          calculatorId: rcLaserCalc.calculatorId,
          calculatorVersion: rcLaserCalc.calculatorVersion,
          physicsGap: rcLaserCalc.gap,
          confidence: rcLaserCalc.confidence,
        } : {}),
      });
      const routeCapability = mergeCuttingAndPressBrakeCapability(
        engine.checkCapability(
          capabilityGeometry,
          rate.commodityCode,
          rate.selection?.balanced?.candidate?.capability,
          rate.selection?.balanced?.candidate?.capabilitySource,
        ),
        pbCapability,
      );
      routes.push(assembleRoute(
        (ROUTE_ID_FOR_CLASS[engine.machineClass] ?? engine.machineClass) as RouteId,
        ROUTE_LABEL_FOR_CLASS[engine.machineClass] ?? engine.machineClass,
        cutResult.processLines, cutResult.cuttingMin, cutResult.abrasiveCost, cutResult.warnings, routeCapability,
      ));
    }

    // ── Badges — only assigned among capable routes ────────────────────────────
    const capableRoutes = routes.filter((r) => r.capability.overallCapable);

    if (capableRoutes.length > 0) {
      const minCost = Math.min(...capableRoutes.map((r) => r.totalCost ?? Infinity));
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

  async getCandidateRoutes(
    id: string,
    userId: string,
    accessToken: string,
    batchSize = 1,
    location: string,
  ): Promise<CandidateRouteComparisonDto> {
    // Phase 1: primary routes from existing comparison + item geometry (parallel)
    const [comparison, item] = await Promise.all([
      this.getRouteComparison(id, userId, accessToken, batchSize, location),
      this.findOne(id, userId, accessToken),
    ]);

    const fg      = item.featureGraph as any;
    const summary = fg?.summary ?? {};
    const locInfo = LOCATION_INFO[location] ?? LOCATION_INFO['Other'];

    const sheetThicknessMm   = resolveEffectiveSheetThicknessMm(item.scenarioOverrides, summary.sheetThicknessMm, item.sheetThicknessMm ?? 0);
    const flatPatternAreaMm2 = (summary.flatPatternAreaMm2 ?? item.flatPatternAreaMm2 ?? 0) as number;
    const volume             = (item.volume ?? 0) as number;
    const maxLength          = ((item as any).maxLength ?? 0) as number;
    const maxWidth           = ((item as any).maxWidth  ?? 0) as number;
    const maxHeight          = ((item as any).maxHeight ?? 0) as number;
    const finishedWeightKg   = ((item as any).weight ?? 0) as number;
    const surfaceArea        = (item.surfaceArea ?? 0) as number;

    const rawDiMaterial = (item.drawingIntelligence as any)?.material;
    const drawingGrade = this.sanitizeDrawingGrade((
      typeof rawDiMaterial === 'string' ? rawDiMaterial :
      rawDiMaterial != null && typeof rawDiMaterial === 'object' ? (rawDiMaterial.value ?? null) : null
    ) as string | null);
    const grade = drawingGrade ?? item.materialGrade ?? (item as any).material ?? null;
    const { family } = this.resolveEffectiveFamily({ item, fg, grade, sheetThicknessMm });

    const isCNC = family === 'cnc_milled' || family === 'cnc_turned' || family === 'mill_turn';
    const bbox  = { length: maxLength, width: maxWidth, height: maxHeight };

    // Phase 2: material density + MHR rates (parallel)
    // One FX snapshot for this whole request — see getCostSummary's identical comment.
    const rates = await this.exchangeRateService.getSnapshot(accessToken);

    const [{ materialDensityKgM3 }, mhrRates] = await Promise.all([
      this.resolveMaterialForFamily({
        accessToken, grade, family,
        materialCol: locInfo.materialCol,
        rates,
        locCurrencyCode: locInfo.code,
        warnings: [],
      }),
      this.resolveMHRRates(accessToken, location, undefined, family, rates),
    ]);

    // Phase 3: blank optimizer for CNC primary routes (conditional)
    const blankResult = isCNC
      ? await this.blankOptimizer.selectOptimalBlank(
          bbox, volume, family as 'cnc_milled' | 'cnc_turned' | 'mill_turn', accessToken,
        )
      : null;

    // Blank spec shared by all primary routes (same stock across machine class variants)
    const primaryBlankSpec = this.buildCandidateBlankSpec({
      family, sheetThicknessMm, flatPatternAreaMm2,
      grossWeightKg: comparison.grossWeightKg,
      finishedWeightKg, maxLength, maxWidth,
      blankResult, materialDensityKgM3,
      materialCostPerKg: comparison.materialCostPerKg,
    });

    // Convert primary routes from route comparison
    const candidates: CandidateRouteDto[] = comparison.routes.map((route) => ({
      candidateId:      route.routeId,
      blankSpec:        primaryBlankSpec,
      routeLabel:       route.routeLabel,
      routeId:          route.routeId,
      processLines:     route.processLines,
      totalCost:        route.totalCost ?? 0,
      materialCost:     route.materialCost,
      totalProcessCost: route.totalProcessCost,
      cycleTimes:       { totalMin: route.cycleTimes.totalMin },
      isFeasible:       route.isFeasible,
      feasibilityNotes: route.capability.warnings,
      isPrimary:        true,
      badges:           { lowestCost: route.badges.lowestCost, fastest: route.badges.fastest, lowestWaste: false },
    }));

    const materialCostPerKg = comparison.materialCostPerKg;
    const materialSource    = comparison.materialSource;

    // Cross-family: SM primary → CNC milled alternative (always feasible, typically higher cost)
    if (family === 'sheet_metal') {
      const cncAlt = this.buildCNCMilledAlternativeCandidate({
        volume, surfaceArea, maxLength, maxWidth, maxHeight, finishedWeightKg,
        holeCount: (summary.holeCount ?? item.holeCount ?? 0) as number,
        materialCostPerKg, materialDensityKgM3, materialSource, batchSize, mhrRates, location,
      });
      if (cncAlt) candidates.push(cncAlt);
    }

    // Cross-family: CNC milled primary → SM alternative (only if flat pattern detected)
    if (family === 'cnc_milled' && sheetThicknessMm > 0 && flatPatternAreaMm2 > 0) {
      const smAlt = this.buildSMAlternativeCandidate({
        flatPatternAreaMm2, sheetThicknessMm, finishedWeightKg,
        cutLengthMm: (summary.cutLengthMm ?? item.cutLengthMm ?? 0) as number,
        pierceCount:  (summary.pierceCount ?? item.pierceCount ?? 0) as number,
        bendCount:    (summary.bendCount   ?? item.bendCount   ?? 0) as number,
        holeCount:    (summary.holeCount   ?? item.holeCount   ?? 0) as number,
        threads: ((item.drawingIntelligence as any)?.threads ?? []).map((t: any) => ({
          size: String(t.size ?? t.spec ?? '').trim(), count: Number(t.count) || 1,
        })),
        grade, materialCostPerKg, materialDensityKgM3, materialSource, batchSize, location, mhrRates,
      });
      if (smAlt) candidates.push(smAlt);
    }

    // lowestWaste badge — highest material utilization among feasible candidates
    const feasible = candidates.filter((c) => c.isFeasible);
    if (feasible.length > 0) {
      feasible.reduce((m, c) =>
        c.blankSpec.utilizationPct > m.blankSpec.utilizationPct ? c : m,
      ).badges.lowestWaste = true;
    }

    return {
      bomItemId: id, batchSize, location,
      currency: locInfo.code, currencySymbol: locInfo.symbol,
      candidates,
    };
  }

  private buildCandidateBlankSpec(args: {
    family: string;
    sheetThicknessMm: number;
    flatPatternAreaMm2: number;
    grossWeightKg: number;
    finishedWeightKg: number;
    maxLength: number;
    maxWidth: number;
    blankResult: import('./costing/blank-optimizer.service').BlankResult | null;
    materialDensityKgM3: number;
    materialCostPerKg: number;
  }): BlankSpecDto {
    const { family, sheetThicknessMm, flatPatternAreaMm2, grossWeightKg, finishedWeightKg,
            maxLength, maxWidth, blankResult, materialDensityKgM3, materialCostPerKg } = args;

    if (family === 'sheet_metal' && flatPatternAreaMm2 > 0 && sheetThicknessMm > 0) {
      const blankL  = maxLength > 0 ? maxLength : Math.sqrt(flatPatternAreaMm2);
      const blankW  = blankL > 0 ? flatPatternAreaMm2 / blankL : Math.sqrt(flatPatternAreaMm2);
      const wasteKg = Math.max(0, grossWeightKg - finishedWeightKg);
      return {
        form:           'sheet',
        sizeLabel:      `${Math.round(blankL)}×${Math.round(blankW)}×${sheetThicknessMm}mm`,
        grossWeightKg,
        netWeightKg:    finishedWeightKg,
        utilizationPct: grossWeightKg > 0 ? Math.min(100, (finishedWeightKg / grossWeightKg) * 100) : 0,
        wasteKg,
        wasteCost:      this.r2(wasteKg * materialCostPerKg),
      };
    }

    if (blankResult && materialDensityKgM3 > 0 && blankResult.billetVolMm3 > 0) {
      const blankGrossKg = blankResult.billetVolMm3 / 1e9 * materialDensityKgM3;
      const wasteKg      = Math.max(0, blankGrossKg - finishedWeightKg);
      return {
        form:           blankResult.form as BlankSpecDto['form'],
        sizeLabel:      blankResult.sizeLabel,
        grossWeightKg:  Math.round(blankGrossKg * 1000) / 1000,
        netWeightKg:    finishedWeightKg,
        utilizationPct: blankResult.utilizationPct ??
          (blankGrossKg > 0 ? Math.min(100, (finishedWeightKg / blankGrossKg) * 100) : 0),
        wasteKg:        Math.round(wasteKg * 1000) / 1000,
        wasteCost:      this.r2(wasteKg * materialCostPerKg),
      };
    }

    const wasteKg = Math.max(0, grossWeightKg - finishedWeightKg);
    return {
      form:           'billet',
      sizeLabel:      'Stock blank',
      grossWeightKg,
      netWeightKg:    finishedWeightKg,
      utilizationPct: grossWeightKg > 0 ? Math.min(100, (finishedWeightKg / grossWeightKg) * 100) : 0,
      wasteKg,
      wasteCost:      this.r2(wasteKg * materialCostPerKg),
    };
  }

  private buildCNCMilledAlternativeCandidate(args: {
    volume: number; surfaceArea: number;
    maxLength: number; maxWidth: number; maxHeight: number;
    finishedWeightKg: number; holeCount: number;
    materialCostPerKg: number; materialDensityKgM3: number;
    materialSource: 'db' | 'default'; batchSize: number;
    mhrRates: Awaited<ReturnType<typeof this.resolveMHRRates>>;
    location: string;
  }): CandidateRouteDto | null {
    const { volume, surfaceArea, maxLength, maxWidth, maxHeight, finishedWeightKg,
            holeCount, materialCostPerKg, materialDensityKgM3, materialSource,
            batchSize, mhrRates, location } = args;

    const allow     = 6;
    const billetVol = (maxLength + allow) * (maxWidth + allow) * (maxHeight + allow);
    const blankResult = {
      form:         'billet',
      sizeLabel:    `${Math.round(maxLength + allow)}×${Math.round(maxWidth + allow)}×${Math.round(maxHeight + allow)} billet`,
      billetVolMm3: billetVol,
      utilizationPct: billetVol > 0 && volume > 0 ? Math.min(100, (volume / billetVol) * 100) : null,
    };
    const blankGrossKg = materialDensityKgM3 > 0 ? billetVol / 1e9 * materialDensityKgM3 : 0;
    const wasteKg      = Math.max(0, blankGrossKg - finishedWeightKg);

    const cncInput: CNCCostInput = {
      volume, surfaceArea, maxLength, maxWidth, maxHeight,
      holeCount, holeGroups: [], pocketCount: 0,
      materialGrade: null, materialCostPerKg, materialDensityKgM3, materialSource,
      threads: [], tightestToleranceMm: null, gdtFeatureCount: 0,
      batchSize, family: 'cnc_milled', finishedWeightKg,
      deburrRate: mhrRates.deburring, inspectionRate: mhrRates.inspection,
      surfaceTreatment: null, surfaceTreatmentDbRate: null,
      samplingPerN: undefined, samplingPolicy: undefined,
      gdtFeatures: [], location, blankResult,
      machinabilityRating: undefined, featureOps: undefined,
      mhrRate: mhrRates.cnc3ax, tappingRate: mhrRates.tapping,
    };

    const cost = computeCNCMilledCostSummary(cncInput, 'cnc_3ax_vmc');
    const blankSpec: BlankSpecDto = {
      form:           'billet',
      sizeLabel:      blankResult.sizeLabel,
      grossWeightKg:  Math.round(blankGrossKg * 1000) / 1000,
      netWeightKg:    finishedWeightKg,
      utilizationPct: blankResult.utilizationPct ?? 0,
      wasteKg:        Math.round(wasteKg * 1000) / 1000,
      wasteCost:      this.r2(wasteKg * materialCostPerKg),
    };

    return {
      candidateId:      'alt-cnc-3ax',
      blankSpec,
      routeLabel:       '3-Axis Milling (from billet)',
      routeId:          'cnc-3ax',
      processLines:     cost.processLines,
      totalCost:        cost.totalCost,
      materialCost:     cost.materialCost,
      totalProcessCost: cost.totalProcessCost,
      cycleTimes:       { totalMin: cost.cycleTimes.totalMin },
      isFeasible:       true,
      feasibilityNotes: ['Alternative: machine from solid billet — higher material waste, typically 1.5–3× more expensive'],
      isPrimary:        false,
      badges:           { lowestCost: false, fastest: false, lowestWaste: false },
    };
  }

  private buildSMAlternativeCandidate(args: {
    flatPatternAreaMm2: number; sheetThicknessMm: number; finishedWeightKg: number;
    cutLengthMm: number; pierceCount: number; bendCount: number; holeCount: number;
    threads: Array<{ size: string; count: number }>;
    grade: string | null; materialCostPerKg: number; materialDensityKgM3: number;
    materialSource: 'db' | 'default'; batchSize: number; location: string;
    mhrRates: Awaited<ReturnType<typeof this.resolveMHRRates>>;
  }): CandidateRouteDto | null {
    const { flatPatternAreaMm2, sheetThicknessMm, finishedWeightKg, cutLengthMm, pierceCount,
            bendCount, holeCount, threads, grade, materialCostPerKg, materialDensityKgM3,
            materialSource, batchSize, location, mhrRates } = args;

    if (flatPatternAreaMm2 <= 0 || sheetThicknessMm <= 0) return null;

    // NOTE: this synchronous helper builds a secondary/alternative route candidate
    // ("machine from solid billet") and has no DB access, so it can't call
    // resolveProcessIdentities() the way the primary cost-summary path does (see
    // getCostSummary()). Its processLines are left without processGroup/processRoute/
    // operation — consumers must fall back to deriving group from machineClass for
    // this path rather than getting a fabricated value here.
    const cost = computeCostSummary({
      sheetThicknessMm, cutLengthMm, pierceCount, bendCount,
      flatPatternAreaMm2, holeCount, threads,
      materialGrade: grade,
      materialCostPerKg, materialDensityKgM3, materialSource,
      batchSize, family: 'sheet_metal', location,
      mhrRates,
      directLaborRatePerHr:  mhrRates.directLaborRate  ?? undefined,
      qaInspectorRatePerHr:  mhrRates.qaInspectorRate  ?? undefined,
    });

    const grossKg = flatPatternAreaMm2 * sheetThicknessMm / 1e9 * materialDensityKgM3;
    const wasteKg = Math.max(0, grossKg - finishedWeightKg);
    const blankSpec: BlankSpecDto = {
      form:           'sheet',
      sizeLabel:      `${sheetThicknessMm}mm sheet blank`,
      grossWeightKg:  Math.round(grossKg * 1000) / 1000,
      netWeightKg:    finishedWeightKg,
      utilizationPct: grossKg > 0 ? Math.min(100, (finishedWeightKg / grossKg) * 100) : 0,
      wasteKg:        Math.round(wasteKg * 1000) / 1000,
      wasteCost:      this.r2(wasteKg * materialCostPerKg),
    };

    return {
      candidateId:      'alt-sm-laser',
      blankSpec,
      routeLabel:       'Laser Cut + Press Brake (from sheet)',
      routeId:          'sm-laser',
      processLines:     cost.processLines,
      totalCost:        cost.totalCost,
      materialCost:     cost.materialCost,
      totalProcessCost: cost.totalProcessCost,
      cycleTimes:       { totalMin: cost.cycleTimes.totalMin },
      isFeasible:       true,
      feasibilityNotes: ['Alternative: form from constant-thickness sheet stock — requires flat pattern geometry'],
      isPrimary:        false,
      badges:           { lowestCost: false, fastest: false, lowestWaste: false },
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
    drawingThreads: Array<{ size: string; count: number; pitchMm?: number }>,
    fg: any,
  ): Array<{ size: string; count: number; pitchMm?: number; depthMm?: number; isThrough?: boolean }> {
    if (drawingThreads.length > 0) return this.normalizeThreadSpecs(drawingThreads);
    // Drawing not yet analyzed — synthesize from geometry-detected tapped holes.
    // depth_mm/through are real, already-computed fields on the CAD engine's
    // tapped_hole feature (cnc_feature_recognizer.py) — carried through here
    // instead of discarding them down to just the spec string.
    const cncFeatures = (fg?.cnc_features?.features ?? []) as Array<{ type: string; params: any }>;
    const tapped = cncFeatures.filter((f) => f.type === 'tapped_hole');
    if (tapped.length === 0) return [];
    const raw = tapped.map((f) => ({
      size: String(f.params?.spec ?? 'M3'),
      count: 1,
      depthMm: (Number(f.params?.depth_mm) || 0) > 0 ? Number(f.params.depth_mm) : undefined,
      isThrough: Boolean(f.params?.through),
    }));
    return this.normalizeThreadSpecs(raw);
  }

  // "M4×0.7" / "M4x0.7 - 6H" → "M4" so TAP_CYCLE_SEC/computeTapCycleSec lookups
  // hit the size key instead of silently falling back to a default. Merges
  // duplicate sizes, averaging depth and combining isThrough (true only when
  // every merged hole in the group is through) across the merge.
  private normalizeThreadSpecs(
    threads: Array<{ size: string; count: number; pitchMm?: number; depthMm?: number; isThrough?: boolean }>,
  ): Array<{ size: string; count: number; pitchMm?: number; depthMm?: number; isThrough?: boolean }> {
    interface Group { count: number; pitchMm?: number; depthSum: number; depthCount: number; throughCount: number }
    const groups: Record<string, Group> = {};
    for (const t of threads) {
      const raw = String(t.size ?? (t as any).spec ?? '').trim().toUpperCase();
      const metric = raw.match(/^M\s*(\d+(?:\.\d+)?)/);
      const key = metric ? `M${metric[1]}` : (raw || 'M3');
      const count = Number(t.count) || 0;
      if (count <= 0) continue;
      const g: Group = groups[key] ?? { count: 0, pitchMm: t.pitchMm, depthSum: 0, depthCount: 0, throughCount: 0 };
      g.count += count;
      if (g.pitchMm == null && t.pitchMm != null) g.pitchMm = t.pitchMm;
      if (t.depthMm != null) { g.depthSum += t.depthMm * count; g.depthCount += count; }
      if (t.isThrough) g.throughCount += count;
      groups[key] = g;
    }
    return Object.entries(groups).map(([size, g]) => ({
      size,
      count: g.count,
      ...(g.pitchMm != null ? { pitchMm: g.pitchMm } : {}),
      ...(g.depthCount > 0 ? { depthMm: Math.round((g.depthSum / g.depthCount) * 100) / 100 } : {}),
      ...(g.depthCount > 0 ? { isThrough: g.throughCount === g.depthCount } : {}),
    }));
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

  // Surface treatment resolution precedence (Fix 5 — drawing intelligence injection):
  //  1. drawingIntelligence.surface_treatment  (legacy field name)
  //  2. drawingIntelligence.coating.value       (drawing analysis API returns {value, confidence})
  //  3. drawingIntelligence.coating             (flat string fallback)
  //  4. item.coating                            (manually set or auto-filled column)
  private resolveSurfaceTreatment(item: any): string | null {
    const di = item?.drawingIntelligence as any;
    return (
      (di?.surface_treatment as string | undefined) ??
      (typeof di?.coating === 'object' ? (di.coating?.value as string | undefined) : undefined) ??
      (typeof di?.coating === 'string' ? di.coating : undefined) ??
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
    locInfo: (typeof LOCATION_INFO)[string],
    location: string,
    inspection?: { rules: InspectionRuleRow[]; policy?: InspectionStagePolicy },
    surfaceTreatmentDbRate?: SurfaceTreatmentDbRate | null,
  ): RouteComparisonDto {
    // Fix 1: milled parts always use feature recognizer hole count (not raw cylinder count)
    const milledCncSummary = fg?.cnc_features?.feature_summary ?? null;
    const holeCount = milledCncSummary !== null
      ? ((milledCncSummary.through_hole ?? 0) + (milledCncSummary.blind_hole ?? 0))
      : (summary.holeCount ?? item.holeCount ?? 0) as number;
    const threads = ((item.drawingIntelligence as any)?.threads ?? []).map((t: any) => ({
      size: String(t.size ?? t.spec ?? '').trim(),
      count: Number(t.count) || 1,
      ...(Number(t.pitch) > 0 ? { pitchMm: Number(t.pitch) } : {}),
    })) as Array<{ size: string; count: number; pitchMm?: number }>;
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
      surfaceTreatmentDbRate: surfaceTreatmentDbRate ?? null,
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
        isFeasible: overallCapable,
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
        routes.map((r) => ({ route: r, totalCost: r.totalCost ?? Infinity, capable: r.capability.overallCapable, setupCount: r.setupCount ?? 99 })),
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
    locInfo: (typeof LOCATION_INFO)[string],
    location: string,
    inspection?: { rules: InspectionRuleRow[]; policy?: InspectionStagePolicy },
    surfaceTreatmentDbRate?: SurfaceTreatmentDbRate | null,
  ): RouteComparisonDto {
    // Fix 1: turned parts also use feature recognizer hole count
    const turnedCncSummary = fg?.cnc_features?.feature_summary ?? null;
    const holeCount = turnedCncSummary !== null
      ? ((turnedCncSummary.through_hole ?? 0) + (turnedCncSummary.blind_hole ?? 0))
      : (summary.holeCount ?? item.holeCount ?? 0) as number;
    const drawingThreads = ((item.drawingIntelligence as any)?.threads ?? []).map((t: any) => ({
      size: String(t.size ?? t.spec ?? '').trim(),
      count: Number(t.count) || 1,
      ...(Number(t.pitch) > 0 ? { pitchMm: Number(t.pitch) } : {}),
    })) as Array<{ size: string; count: number; pitchMm?: number }>;
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
      surfaceTreatmentDbRate: surfaceTreatmentDbRate ?? null,
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
        isFeasible: capability.overallCapable,
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
        routes.map((r) => ({ route: r, totalCost: r.totalCost ?? Infinity, capable: r.capability.overallCapable, setupCount: r.setupCount ?? 99 })),
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

  // Resolves a consumable price from the consumable_prices DB table (migration 362).
  // Table stores prices in USD; result is converted to local currency via the
  // caller's RateSnapshot (real FX, one read per request) — never a hardcoded pivot.
  // Returns 0 when the DB has no row — the caller treats 0 as "add data to get this costed."
  private async resolveConsumablePrice(
    accessToken: string,
    consumableType: string,
    location: string,
    rates: RateSnapshot,
  ): Promise<number> {
    try {
      const locInfo = LOCATION_INFO[location] ?? LOCATION_INFO['USA']!;
      const usdToLocal = rates.convertStrict('USD', locInfo.code);
      for (const loc of [location, '__default__']) {
        const { data } = await this.supabaseService
          .getClient(accessToken)
          .from('consumable_prices')
          .select('price_per_unit')
          .eq('consumable_type', consumableType)
          .eq('location', loc)
          .maybeSingle();
        if (data?.price_per_unit) return Number(data.price_per_unit) * usdToLocal;
      }
    } catch { /* non-critical */ }
    return 0;
  }

  // Evaluates one or more `calculated`-type fields on a real DB calculator
  // (e.g. "Sheet Metal - Laser Cutting Manufacturing") using the SAME shared
  // mathjs evaluator the interactive "Edit Process Cost" calculator dialog
  // runs (calculators/calculator-formula-evaluator.ts), seeded with already-
  // resolved real CAD/DB-lookup values — never re-implemented as a second,
  // hardcoded formula in cost-engine.ts. Returns undefined (not a fallback
  // number) for any target field that failed to evaluate to a finite number,
  // so the caller's own last-resort inline formula can take over exactly as
  // it did before this calculator-driven path existed.
  private async evaluateCalculatorFields(
    accessToken: string,
    calculatorId: string,
    seedScope: Record<string, number | string>,
    targetFieldNames: string[],
    // Per-field provenance labels ("CAD feature extraction — total cut path
    // length", "sm_lookup_laser_cut — ...") for the fields present in
    // seedScope — real audit-trail text, the same "Why:" reasoning already
    // shown in the interactive calculator dialog, not fabricated for display.
    seedProvenance: Record<string, string> = {},
    // Only consumed by the sheet-metal net/gross-usage physics_keys below
    // (they need the bound BOM item's stored CAD outline/cache, which isn't
    // a value a calculator form can hold as a scalar input) -- every other
    // physics_key/formula calculator ignores this.
    ctx?: { itemId?: string; userId?: string },
  ): Promise<{ values: Record<string, number | undefined>; trace: CalculationTraceStep[]; gapReasonOverride?: string }> {
    const emptyValues = Object.fromEntries(targetFieldNames.map((n) => [n, undefined])) as Record<string, number | undefined>;
    try {
      const [{ data: calcFields, error }, { data: calcRow }] = await Promise.all([
        this.supabaseService
          .getClient(accessToken)
          .from('calculator_fields')
          .select('id, field_name, display_label, field_type, unit, default_value, display_order')
          .eq('calculator_id', calculatorId)
          .order('display_order'),
        this.supabaseService
          .getClient(accessToken)
          .from('calculators')
          .select('physics_key')
          .eq('id', calculatorId)
          .single(),
      ]);
      if (error || !calcFields?.length) return { values: emptyValues, trace: [] };

      // Physics-backed calculator (migration 056): a real TypeScript function
      // (physics-registry.ts) — the exact same one calculators.service.ts's
      // execute() dispatches to for the interactive popup — computes the
      // results directly. This is NOT optional/equivalent to evaluating the
      // calculator's own stored default_value formula strings below: those
      // strings are left in the DB purely as "Why: {formula}" caption text
      // (migration 056's own comment) and can genuinely omit real physics
      // terms the TS function includes (e.g. Tapping's approach/retract/
      // tool-change/unload overhead) — using them here instead of the real
      // function would silently regress accuracy relative to cost-engine.ts's
      // own pre-migration numbers, not just duplicate them.
      const physicsKey = (calcRow as any)?.physics_key as string | null | undefined;
      // Sheet-metal net/gross material usage: dispatched here, BEFORE the
      // generic PHYSICS_REGISTRY lookup, because their implementation needs
      // async DB access (the bound BOM item's stored CAD outline/cache) --
      // PHYSICS_REGISTRY's contract (tapping/deburring) is plain sync math
      // with no I/O, so these two can't live there. Both calculators'
      // physics_key values route through this same branch as
      // CalculatorsServiceV2.execute() (the interactive dialog), so the two
      // paths can never drift from each other.
      let gapReasonOverride: string | undefined;
      let scope: Record<string, any>;
      // true for every path that returns a flat object keyed by the exact
      // calculator_fields.field_name strings (all three physics paths);
      // false only for the string-formula evaluator, whose scope is keyed
      // by normalizeFieldName() instead.
      let usesExactFieldNames = true;
      if (physicsKey === 'sheet_metal_net_usage') {
        scope = resolveNetUsagePhysics(seedScope);
      } else if (physicsKey === 'sheet_metal_gross_usage_nesting') {
        const raw = await this.resolveGrossUsageForCalculator(seedScope, {
          itemId: ctx?.itemId, userId: ctx?.userId ?? '', accessToken,
        });
        const { _gapReason, _internalReason, ...rest } = raw;
        gapReasonOverride = _gapReason as string | undefined;
        scope = rest;
      } else {
        const physicsFn = physicsKey ? PHYSICS_REGISTRY[physicsKey] : undefined;
        if (physicsFn) {
          const { _warnings, ...rawResults } = physicsFn(seedScope) as Record<string, any>;
          scope = rawResults;
        } else {
          usesExactFieldNames = false;
          scope = evaluateCalculatorFormulas(calcFields as CalculatorFieldRow[], [], seedScope).scope;
        }
      }

      const values: Record<string, number | undefined> = { ...emptyValues };
      for (const name of targetFieldNames) {
        const val = usesExactFieldNames ? scope[name] : scope[normalizeFieldName(name)];
        values[name] = typeof val === 'number' && Number.isFinite(val) ? val : undefined;
      }

      // Full audit trail: every real input actually used, then every
      // calculated field in evaluation order with its real DB formula string
      // (still shown as documentation even when physics-backed — see comment
      // above).
      const trace: CalculationTraceStep[] = [];
      for (const f of calcFields as any[]) {
        const val = usesExactFieldNames ? scope[f.field_name] : scope[normalizeFieldName(f.field_name)];
        if (f.field_type !== 'calculated') {
          const hasSeed = seedScope[f.field_name] !== undefined;
          const hasDefault = f.default_value !== undefined && f.default_value !== null && f.default_value !== '';
          if (!hasSeed && !hasDefault) continue; // genuinely unset — omit, don't fabricate
          trace.push({
            fieldName: f.field_name,
            displayLabel: f.display_label ?? f.field_name,
            kind: 'input',
            value: hasSeed ? (seedScope[f.field_name] as any) : (typeof val === 'number' || typeof val === 'string' ? val : (val ?? f.default_value)),
            unit: f.unit ?? null,
            source: seedProvenance[f.field_name] ?? (hasSeed ? 'Provided value' : "Calculator's own default value"),
          });
        } else {
          if (val === undefined || (val && typeof val === 'object' && 'error' in val)) continue; // unresolved — omit, don't fabricate
          trace.push({
            fieldName: f.field_name,
            displayLabel: f.display_label ?? f.field_name,
            kind: 'calculated',
            value: typeof val === 'number' || typeof val === 'string' ? val : null,
            unit: f.unit ?? null,
            formula: f.default_value ?? undefined,
          });
        }
      }

      return { values, trace, ...(gapReasonOverride ? { gapReasonOverride } : {}) };
    } catch {
      return { values: emptyValues, trace: [] };
    }
  }

  /**
   * Manufacturing Physics Calculator — the single, generalized entry point
   * every physics quantity (cycle time, tonnage, force, ...) for every
   * process must resolve through. Wraps the existing, already-generic
   * evaluateCalculatorFields() (reused as-is — this method does not
   * reimplement formula evaluation) with three things that method didn't
   * have: (1) dynamic calculator resolution via process_calculator_mappings
   * instead of a hardcoded literal UUID at each call site, (2) calculator
   * versioning (migration 428), (3) real, structured gap reporting
   * (LookupGap/UnsupportedOperationGap) instead of a silently-undefined
   * value the caller then papers over with its own hardcoded fallback.
   *
   * Every caller — cost-engine.ts's per-process blocks (via this service),
   * getRouteComparison's route assembly, apply-route's persistence, the AI
   * planner's resolver.service.ts — must call this instead of computing a
   * physics quantity itself. No process is allowed to write cycle_time (or
   * any other physics quantity) directly.
   */
  // One-line, ready-to-display message for a PhysicsGap — used to populate
  // ManufacturingPhysicsResult.warnings so callers aren't each re-deriving
  // the same missing_lookup/unsupported_operation formatting. Callers that
  // want more specific wording (e.g. "for this material/thickness/power")
  // may still build their own string from `gap` directly — this is a
  // reasonable default, not the only allowed message.
  private physicsGapToWarning(process: string, gap: PhysicsGap): string {
    return gap.gapType === 'missing_lookup'
      ? `${process} cycle time unavailable — ${gap.requiredAction}`
      : `${process} cycle time unavailable — ${gap.reason}`;
  }

  // ConfidenceLevel inference (see its own doc comment, cost-breakdown.dto.ts):
  // a gap means nothing real resolved at all -> 'unsupported'. Otherwise,
  // scans each input step's disclosed source text for the same wording this
  // codebase already uses everywhere it discloses a standard/assumption
  // rather than a real measurement or exact lookup hit (e.g. "Assumed depth",
  // "Standard HSS drilling feed", "no real angle extracted") — if any input
  // reads that way, the result is real but not exact for this specific part
  // ('derived'); otherwise every input was a real CAD/BOM value or an exact
  // lookup hit ('verified'). Inferred from the trace itself, not a separate
  // flag a caller sets by hand, so it can't drift out of sync with what the
  // trace actually shows.
  private deriveConfidence(inputs: CalculationTraceStep[], gap: PhysicsGap | null): ConfidenceLevel {
    if (gap) return 'unsupported';
    const derivedMarkers = ['assum', 'standard', 'fallback', 'disclosed', 'approxim', 'not yet extracted', 'not extracted', 'no real', 'interpolat', 'extrapolat', 'rounded from', 'estimat'];
    const isDerived = inputs.some((step) => {
      const src = (step.source ?? '').toLowerCase();
      return derivedMarkers.some((m) => src.includes(m));
    });
    return isDerived ? 'derived' : 'verified';
  }

  // Folds a per-group ConfidenceLevel into a running aggregate for
  // multi-group resolutions (Tapping/Counterboring/Countersinking/PEM/
  // Reaming, one calculator call per real diameter/size group) — the
  // aggregate is only as trustworthy as its LEAST-trustworthy group
  // ('unsupported' beats 'derived' beats 'verified').
  private combineConfidence(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
    const rank: Record<ConfidenceLevel, number> = { verified: 0, derived: 1, unsupported: 2 };
    return rank[b] > rank[a] ? b : a;
  }

  // ResolutionStatus inference (see its own doc comment, cost-breakdown.dto.ts)
  // — a gap maps 1:1 onto its own gapType (LookupGap/UnsupportedOperationGap
  // already use the same two literal strings this type does). Otherwise,
  // scans the same disclosed input-source text deriveConfidence reads for a
  // caller-disclosed "nearest match" substitution — dormant until a caller's
  // seedProvenance actually discloses one (none do yet; every current
  // lookup-sourced seed field is either an exact hit or reports its own real
  // gap), same convention as deriveConfidence's own marker scan.
  private deriveResolutionStatus(inputs: CalculationTraceStep[], gap: PhysicsGap | null): ResolutionStatus {
    if (gap) return gap.gapType;
    const nearestMarkers = ['nearest match', 'nearest-match', 'nearest neighbor', 'interpolat', 'extrapolat'];
    const isNearest = inputs.some((step) => {
      const src = (step.source ?? '').toLowerCase();
      return nearestMarkers.some((m) => src.includes(m));
    });
    return isNearest ? 'nearest_match' : 'resolved';
  }

  // Folds a per-group ResolutionStatus into a running aggregate, same
  // worst-wins pattern as combineConfidence — 'invalid_input' outranks both
  // gap types, which outrank 'nearest_match', which outranks 'resolved'.
  private combineResolutionStatus(a: ResolutionStatus, b: ResolutionStatus): ResolutionStatus {
    const rank: Record<ResolutionStatus, number> = {
      resolved: 0, nearest_match: 1, missing_lookup: 2, unsupported_operation: 3, invalid_input: 4,
    };
    return rank[b] > rank[a] ? b : a;
  }

  // The "not attempted" ManufacturingPhysicsResult — for call sites that
  // skip resolvePhysicsQuantity entirely because the feature isn't present
  // on this part at all (e.g. zero cut length, zero bend count). Never a
  // gap (a gap means the calculator was asked and couldn't resolve; here it
  // was never asked), so downstream cost-engine.ts blocks correctly stay
  // silent rather than warning about a process that doesn't apply.
  private emptyPhysicsResult(targetFieldNames: string[]): ManufacturingPhysicsResult {
    return {
      calculatorId: null,
      calculatorVersion: null,
      formulaVersion: null,
      inputs: [],
      lookupTrace: [],
      formulas: [],
      intermediateResults: {},
      outputs: Object.fromEntries(targetFieldNames.map((n) => [n, undefined])),
      warnings: [],
      provenance: {},
      trace: [],
      gap: null,
      confidence: 'unsupported',
      resolutionStatus: 'unsupported_operation',
    };
  }

  private async resolvePhysicsQuantity(
    accessToken: string,
    params: {
      machineClass: string;
      process: string;
      targetFieldNames: string[];
      seedScope: Record<string, number | string>;
      seedProvenance?: Record<string, string>;
      // Field name -> real sm_lookup_* table name, for input fields whose
      // value could be missing because a specific lookup had no matching
      // row. Used to build a real, specific LookupGap (not a generic
      // "something failed") when a target field can't resolve. Caller
      // supplies this because it already knows which of its seed values are
      // lookup-sourced vs. plain CAD/BOM data — this method has no other way
      // to distinguish the two.
      lookupTableByField?: Record<string, string>;
      // Field name -> the REAL, structured LookupResolution the caller's own
      // lookup service call already produced (table/policy/queryParams/
      // matchedRow/nearestRows — see its own doc comment). Supplied by
      // callers whose underlying SheetMetalLookupService method has been
      // upgraded to return one (getManualStrokeTime today). When a field in
      // lookupTableByField has no entry here, the gap falls back to a
      // minimal resolution (table name only, no query detail) rather than
      // failing — a caller not yet upgraded still gets a real gap, just a
      // less detailed one.
      lookupResolutions?: Record<string, LookupResolution>;
      // Disambiguates machine classes that host MULTIPLE distinct
      // operations with their own calculators — e.g. 'drill_press' covers
      // Counterboring, Countersinking, and Reaming, each a different real
      // calculator. Without this, the machine-class-only lookup below would
      // pick whichever of those rows happens to have the lowest
      // display_order, silently running the wrong process's calculator.
      // Omitted for machine classes with only one calculator-bearing
      // operation (fiber_laser, press_brake, tapping, deburring today).
      operation?: string;
      // Only consumed by the sheet-metal net/gross-usage machine classes
      // (their physics_key implementation needs the bound BOM item's stored
      // CAD outline/cache) -- every other machine class ignores it.
      itemId?: string;
      userId?: string;
    },
  ): Promise<ManufacturingPhysicsResult> {
    const emptyOutputs = Object.fromEntries(params.targetFieldNames.map((n) => [n, undefined])) as Record<string, number | undefined>;
    const lookupTableByField = params.lookupTableByField ?? {};
    const empty = (gap: PhysicsGap | null, calculatorId: string | null = null, calculatorVersion: number | null = null): ManufacturingPhysicsResult => ({
      calculatorId,
      calculatorVersion,
      formulaVersion: calculatorVersion,
      inputs: [],
      lookupTrace: [],
      formulas: [],
      intermediateResults: {},
      outputs: emptyOutputs,
      warnings: gap ? [this.physicsGapToWarning(params.process, gap)] : [],
      provenance: {},
      trace: [],
      gap,
      confidence: this.deriveConfidence([], gap),
      resolutionStatus: this.deriveResolutionStatus([], gap),
    });

    // A provided numeric input that isn't a finite number (NaN/Infinity) is
    // never a real physical value — checked before even resolving the
    // calculator, since garbage in would otherwise silently propagate through
    // the formula evaluator as a "resolved" NaN/Infinity result (see the
    // matching output-side check below).
    const invalidSeedFields = Object.entries(params.seedScope)
      .filter(([, v]) => typeof v === 'number' && !Number.isFinite(v))
      .map(([k]) => k);
    if (invalidSeedFields.length > 0) {
      return {
        calculatorId: null, calculatorVersion: null, formulaVersion: null,
        inputs: [], lookupTrace: [], formulas: [], intermediateResults: {},
        outputs: emptyOutputs,
        warnings: [`${params.process} result unavailable — invalid input value(s): ${invalidSeedFields.join(', ')} (not a finite number).`],
        provenance: {}, trace: [], gap: null,
        confidence: 'unsupported',
        resolutionStatus: 'invalid_input',
      };
    }

    // ── Resolve the calculator via the registry (rule 2) — never a hardcoded
    // literal UUID at the call site. One representative active row per
    // machine class (+ operation, when given — see doc comment), lowest
    // display_order, same convention as resolveProcessIdentities.
    const client = this.supabaseService.getClient(accessToken);
    let mappingQuery = client
      .from('process_calculator_mappings')
      .select('calculator_id')
      .eq('machine_class', params.machineClass)
      .eq('is_active', true)
      .not('calculator_id', 'is', null);
    if (params.operation) {
      mappingQuery = mappingQuery.eq('operation', params.operation);
    }
    const { data: mappingRows } = await mappingQuery
      .order('display_order', { ascending: true })
      .limit(1);
    const calculatorId = mappingRows?.[0]?.calculator_id as string | undefined;

    if (!calculatorId) {
      const gap: UnsupportedOperationGap = {
        gapType: 'unsupported_operation',
        process: params.process,
        machineClass: params.machineClass,
        reason: `No calculator registered for machine class '${params.machineClass}' — this process has not been migrated onto the Manufacturing Physics Calculator pipeline yet.`,
      };
      void this.recordLookupCoverageGap(gap);
      return empty(gap);
    }

    const { data: calcRow } = await client
      .from('calculators')
      .select('version')
      .eq('id', calculatorId)
      .single();
    const calculatorVersion = (calcRow as any)?.version ?? 1;

    const { values, trace: rawTrace, gapReasonOverride } = await this.evaluateCalculatorFields(
      accessToken, calculatorId, params.seedScope, params.targetFieldNames, params.seedProvenance,
      { itemId: params.itemId, userId: params.userId },
    );

    // Tag each step physics/lookup (rule 3): a 'calculated' step is a
    // physics formula by construction in this architecture (lookup-sourced
    // values are always fed in as inputs, never as formula fields
    // themselves). An 'input' step is 'lookup' when the caller told us it
    // came from a named sm_lookup_* table; otherwise it's plain CAD/BOM data
    // (left untagged — neither a physics formula nor a DB lookup).
    const trace: CalculationTraceStep[] = rawTrace.map((step) => ({
      ...step,
      stepType: step.kind === 'calculated' ? 'physics' : (lookupTableByField[step.fieldName] ? 'lookup' : undefined),
    }));

    // Standardized views over the same trace (ManufacturingPhysicsResult) —
    // sliced once here so every caller gets them for free instead of
    // filtering `trace` itself.
    const inputs = trace.filter((s) => s.kind === 'input');
    const lookupTrace = inputs.filter((s) => s.stepType === 'lookup');
    const formulas = trace.filter((s) => s.kind === 'calculated');
    const intermediateResults: Record<string, number> = {};
    for (const f of formulas) {
      if (typeof f.value === 'number') intermediateResults[f.fieldName] = f.value;
    }
    const provenance: Record<string, string> = {};
    for (const i of inputs) {
      if (i.source) provenance[i.fieldName] = i.source;
    }

    const unresolved = params.targetFieldNames.filter((n) => values[n] === undefined);
    // A resolved-looking value that's actually NaN/Infinity (e.g. a
    // divide-by-zero inside the calculator's own formula, such as a zero
    // 'Shoulder Width') is not a real result — it's an invalid computation,
    // not a missing lookup row, so it gets its own status rather than being
    // reported as 'resolved' just because it isn't `undefined`.
    const invalidOutputFields = unresolved.length === 0
      ? params.targetFieldNames.filter((n) => typeof values[n] === 'number' && !Number.isFinite(values[n] as number))
      : [];
    if (unresolved.length === 0 && invalidOutputFields.length === 0) {
      return {
        calculatorId, calculatorVersion, formulaVersion: calculatorVersion,
        inputs, lookupTrace, formulas, intermediateResults,
        outputs: values, warnings: [], provenance, trace, gap: null,
        confidence: this.deriveConfidence(inputs, null),
        resolutionStatus: this.deriveResolutionStatus(inputs, null),
      };
    }
    if (invalidOutputFields.length > 0) {
      return {
        calculatorId, calculatorVersion, formulaVersion: calculatorVersion,
        inputs, lookupTrace, formulas, intermediateResults,
        outputs: values,
        warnings: [`${params.process} result unavailable — ${invalidOutputFields.join(', ')} computed to a non-finite value (NaN/Infinity), likely a divide-by-zero in the calculator's formula — check its inputs, not a missing lookup row.`],
        provenance, trace, gap: null,
        confidence: 'unsupported',
        resolutionStatus: 'invalid_input',
      };
    }

    // Something didn't resolve — find which lookup-sourced input the caller
    // omitted (it omits rather than passes undefined specifically so this
    // detection works, see the two call sites' own comments) and build a
    // real, specific LookupGap. If nothing lookup-sourced is missing, this is
    // a genuine formula/configuration problem, not a data gap — report it as
    // unsupported rather than silently returning undefined with no reason.
    const missingLookupField = Object.keys(lookupTableByField).find(
      (fieldName) => params.seedScope[fieldName] === undefined,
    );
    let gap: PhysicsGap;
    if (missingLookupField) {
      const table = lookupTableByField[missingLookupField]!;
      // Real, structured resolution when the caller's own lookup service
      // call already produced one (see lookupResolutions's own doc
      // comment); a minimal, honest fallback (table name only, no query
      // detail) when it hasn't been upgraded yet — never a fabricated query.
      const lookupResolution: LookupResolution = params.lookupResolutions?.[missingLookupField] ?? {
        table,
        // Real, table-specific classification (lookup_table_policy,
        // migration 427) rather than an unconditional literal — this is the
        // generic fallback shared by every process's resolvePhysicsQuantity
        // call, so it's the one place a wrong hardcoded policy label would
        // have been wrong for every table, not just one.
        policy: await this.smLookup.resolveLookupPolicy(table, 'EXACT_MATCH'),
        queryParams: [],
        matchedRow: null,
        nearestRows: [],
      };
      // Every OTHER real input the calculator used — confirmed present, so
      // a reader can see at a glance these are NOT the problem (the actual
      // bug this replaced: dumping every resolved seedScope value as if it
      // were part of the gap).
      const inputValidation: ValidatedInput[] = Object.entries(params.seedScope)
        .filter(([fieldName]) => fieldName !== missingLookupField)
        .map(([fieldName, value]) => ({
          fieldName,
          value,
          source: params.seedProvenance?.[fieldName] ?? 'Provided value',
        }));
      const queryDescription = lookupResolution.queryParams.length > 0
        ? lookupResolution.queryParams.map((p) => `${p.column}=${p.value}${p.unit ?? ''}`).join(', ')
        : missingLookupField;
      gap = {
        gapType: 'missing_lookup',
        process: params.process,
        machineClass: params.machineClass,
        inputValidation,
        lookupResolution,
        requiredAction: `Add a real, sourced row to ${table} for ${queryDescription}.`,
        priority: 'medium',
      };
    } else {
      gap = {
        gapType: 'unsupported_operation',
        process: params.process,
        machineClass: params.machineClass,
        // gapReasonOverride: the sheet-metal net/gross-usage physics_keys
        // supply their own exact, user-facing reason (e.g. "Unable to
        // calculate true-shape gross usage — verified flat pattern
        // required") instead of this generic template -- every other
        // machine class is unaffected (evaluateCalculatorFields only sets
        // this for those two physics_keys).
        reason: gapReasonOverride ?? `Calculator '${calculatorId}' (v${calculatorVersion}) did not resolve ${unresolved.join(', ')} from the given inputs — check the calculator's formula/fields, not a missing lookup row.`,
      };
    }
    void this.recordLookupCoverageGap(gap);
    return {
      calculatorId, calculatorVersion, formulaVersion: calculatorVersion,
      inputs, lookupTrace, formulas, intermediateResults,
      outputs: values, warnings: [this.physicsGapToWarning(params.process, gap)], provenance, trace, gap,
      confidence: this.deriveConfidence(inputs, gap),
      resolutionStatus: this.deriveResolutionStatus(inputs, gap),
    };
  }

  // Persists this gap into lookup_coverage_gaps (migration 429's table,
  // migration 431's upsert function) — the raw event log the Lookup
  // Coverage Dashboard's per-table stats are aggregated FROM. Matches
  // migration 429's own comment ("upsert-on-gap") — real occurrence counts
  // and last-seen timestamps, not a one-off runtime message the engineer
  // sees once and forgets. Fire-and-forget from both call sites (never
  // awaited there) and swallows its own errors — a coverage-logging failure
  // must never affect the cost calculation the gap is attached to.
  private async recordLookupCoverageGap(gap: PhysicsGap): Promise<void> {
    try {
      const db = this.supabaseService.getAdminClient();
      const tableName = gap.gapType === 'missing_lookup' ? gap.lookupResolution.table : null;
      const missingInputs = gap.gapType === 'missing_lookup'
        ? Object.fromEntries(gap.lookupResolution.queryParams.map((p) => [p.column, p.value]))
        : {};
      await db.rpc('upsert_lookup_coverage_gap', {
        p_gap_type: gap.gapType,
        p_table_name: tableName,
        p_process: gap.process,
        p_machine_class: gap.machineClass,
        p_missing_inputs: missingInputs,
        p_suggested_sources: gap.gapType === 'missing_lookup' ? (gap.suggestedSources ?? null) : null,
        p_reason: gap.gapType === 'unsupported_operation' ? gap.reason : null,
        p_required_capability: gap.gapType === 'unsupported_operation' ? (gap.requiredCapability ?? null) : null,
        p_priority: gap.gapType === 'missing_lookup' ? gap.priority : 'medium',
      });
    } catch {
      // Diagnostics-only — see doc comment above.
    }
  }

  /**
   * Tapping cycle time — the real "Machining - Tapping" DB calculator
   * (physics_key='tapping', migration 056 — dispatches to the exact same
   * computeTapPhysics() rigid-tapping physics the interactive popup uses),
   * resolved via resolvePhysicsQuantity so this is the ONE place tapping time
   * gets computed — shared by getCostSummary and getRouteComparison, which
   * previously each called computeTapCycleSec() independently.
   *
   * One calculator call per distinct thread-size group (a tool change is
   * real per group; the calculator's own 'Tool Change Time'/'Time per Use'
   * fields are requested separately, not 'Total Time', specifically so this
   * method can compose toolChangeTime + count*timePerUse per group and add
   * exactly ONE unload allowance for the whole operation — matching the
   * pre-migration aggregation exactly, not double-counting unload per group).
   */
  private async resolveTappingCycleTimeSec(
    accessToken: string,
    threads: Array<{ size: string; count: number; pitchMm?: number; depthMm?: number }>,
    sheetThicknessMm: number,
    materialGrade: string | null,
  ): Promise<{ cycleTimeSec: number | undefined; gap: PhysicsGap | null; calculatorId: string | null; calculatorVersion: number | null; confidence: ConfidenceLevel; resolutionStatus: ResolutionStatus }> {
    if (threads.length === 0) return { cycleTimeSec: undefined, gap: null, calculatorId: null, calculatorVersion: null, confidence: 'unsupported', resolutionStatus: 'unsupported_operation' };

    const fallbackDepthMm = sheetThicknessMm > 0 ? sheetThicknessMm : 3;
    let totalSec = 0;
    let anyResolved = false;
    let gap: PhysicsGap | null = null;
    let calculatorId: string | null = null;
    let calculatorVersion: number | null = null;
    let confidence: ConfidenceLevel = 'verified';
    // Two separate accumulators, mirroring `confidence`'s own split: groups
    // that DID resolve fold into `resolutionStatus` (worst-of-the-resolved,
    // same as confidence); groups that didn't fold into `failureStatus`
    // instead, so a run where every group fails still reports WHY (e.g.
    // 'invalid_input') instead of falling through to a generic
    // 'unsupported_operation' just because `gap` stayed null.
    let resolutionStatus: ResolutionStatus = 'resolved';
    let failureStatus: ResolutionStatus | null = null;

    for (const t of threads) {
      const tapInputs = resolveTapPhysicsInputs(t.size, t.pitchMm, t.depthMm, fallbackDepthMm, materialGrade);
      const tapCalc = await this.resolvePhysicsQuantity(accessToken, {
        machineClass: 'tapping',
        process: 'Tapping',
        targetFieldNames: ['Time per Use', 'Tool Change Time'],
        seedScope: {
          'Tap Diameter': tapInputs.diameterMm,
          Length: tapInputs.depthMm,
          'Cutting Speed': tapInputs.surfaceSpeedMMin,
          'Feed per Rev': tapInputs.pitchMm,
          'No of Uses': t.count,
        },
        seedProvenance: {
          'Tap Diameter': `Parsed from thread size "${t.size}"`,
          Length: tapInputs.depthIsAssumed
            ? `Assumed depth — no real tapped-hole depth extracted (${tapInputs.depthMm}mm fallback)`
            : 'CAD/drawing feature extraction — real tapped-hole depth',
          'Cutting Speed': `Material-specific surface speed — ${tapInputs.materialFamily} family`,
          'Feed per Rev': t.pitchMm != null
            ? 'CAD/drawing feature extraction — real thread pitch'
            : 'Standard pitch for this nominal diameter (no real pitch extracted)',
          'No of Uses': 'CAD/drawing feature extraction — thread count for this size group',
        },
      });
      calculatorId = tapCalc.calculatorId ?? calculatorId;
      calculatorVersion = tapCalc.calculatorVersion ?? calculatorVersion;
      const timePerUse = tapCalc.outputs['Time per Use'];
      const toolChangeTime = tapCalc.outputs['Tool Change Time'];
      const groupOk = typeof timePerUse === 'number' && Number.isFinite(timePerUse)
        && typeof toolChangeTime === 'number' && Number.isFinite(toolChangeTime);
      if (groupOk) {
        totalSec += toolChangeTime + t.count * timePerUse;
        anyResolved = true;
        confidence = this.combineConfidence(confidence, tapCalc.confidence);
        resolutionStatus = this.combineResolutionStatus(resolutionStatus, tapCalc.resolutionStatus);
      } else {
        if (tapCalc.gap && !gap) gap = tapCalc.gap;
        failureStatus = failureStatus
          ? this.combineResolutionStatus(failureStatus, tapCalc.resolutionStatus)
          : tapCalc.resolutionStatus;
      }
    }

    return {
      cycleTimeSec: anyResolved ? totalSec + TAP_UNLOAD_SEC : undefined,
      gap: anyResolved ? null : gap,
      calculatorId,
      calculatorVersion,
      confidence: anyResolved ? confidence : 'unsupported',
      resolutionStatus: anyResolved ? resolutionStatus : (failureStatus ?? 'unsupported_operation'),
    };
  }

  /**
   * Counterboring/Countersinking cycle time — real rigid-drilling-style
   * physics (Spindle RPM from cutting speed/diameter, machining time from
   * feed rate) via the registered "Sheet Metal - Counterboring"/"Sheet Metal
   * - Countersinking" calculators (migrations 050/051), replacing the flat
   * per-diameter sm_lookup_counterbore/sm_lookup_countersink cycle_time_sec
   * this used to consume directly. `operation` disambiguates 'drill_press',
   * which also hosts Reaming/Drilling/Boring/Gun Drilling with their own
   * calculators — see resolvePhysicsQuantity's own doc comment.
   *
   * One calculator call per distinct diameter group — mirrors
   * resolveTappingCycleTimeSec's aggregation exactly: each group's own tool-
   * change time + per-hole time × count, summed across groups, plus ONE
   * unload allowance for the whole operation.
   */
  private async resolveHoleOperationCycleTimeSec(
    accessToken: string,
    groups: Array<{ diameter_mm: number; count: number }>,
    config: {
      operation: 'Counterboring' | 'Countersinking';
      process: string;
      materialGrade: string | null;
      speedFactor?: number;
      // Op-specific depth strategy: Counterbore has no real depth signal
      // today (disclosed fallback); Countersink's depth is real cone
      // geometry derived from diameter + included angle. Kept out of this
      // shared method so neither operation's convention leaks into the other.
      resolveDepthMm: (diameterMm: number) => { depthMm: number; provenance: string };
    },
  ): Promise<{ cycleTimeSec: number | undefined; gap: PhysicsGap | null; calculatorId: string | null; calculatorVersion: number | null; confidence: ConfidenceLevel; resolutionStatus: ResolutionStatus }> {
    if (groups.length === 0) return { cycleTimeSec: undefined, gap: null, calculatorId: null, calculatorVersion: null, confidence: 'unsupported', resolutionStatus: 'unsupported_operation' };

    const speedFeed = resolveDrillingSpeedFeed(config.materialGrade, config.speedFactor ?? 1);
    let totalSec = 0;
    let anyResolved = false;
    let gap: PhysicsGap | null = null;
    let calculatorId: string | null = null;
    let calculatorVersion: number | null = null;
    let confidence: ConfidenceLevel = 'verified';
    // See resolveTappingCycleTimeSec's own comment — same two-accumulator split.
    let resolutionStatus: ResolutionStatus = 'resolved';
    let failureStatus: ResolutionStatus | null = null;

    for (const g of groups) {
      const { depthMm, provenance: depthProvenance } = config.resolveDepthMm(g.diameter_mm);
      const calc = await this.resolvePhysicsQuantity(accessToken, {
        machineClass: 'drill_press',
        operation: config.operation,
        process: config.process,
        targetFieldNames: ['Time per Use', 'Tool Change Time'],
        seedScope: {
          Diameter: g.diameter_mm,
          Depth: depthMm,
          'Cutting Speed': speedFeed.surfaceSpeedMMin,
          'Feed per Rev': speedFeed.feedMmPerRev,
          'No of Uses': g.count,
        },
        seedProvenance: {
          Diameter: 'CAD feature extraction — real hole diameter',
          Depth: depthProvenance,
          'Cutting Speed': `Standard HSS drilling surface speed — ${speedFeed.materialFamily} family` + (config.speedFactor && config.speedFactor !== 1 ? ` × ${config.speedFactor} (countersink design rule)` : ''),
          'Feed per Rev': 'Standard HSS drilling/counterbore feed (engineering-standard assumption, disclosed)',
          'No of Uses': 'CAD feature extraction — hole count for this diameter group',
        },
      });
      calculatorId = calc.calculatorId ?? calculatorId;
      calculatorVersion = calc.calculatorVersion ?? calculatorVersion;
      const timePerUse = calc.outputs['Time per Use'];
      const toolChangeTime = calc.outputs['Tool Change Time'];
      const groupOk = typeof timePerUse === 'number' && Number.isFinite(timePerUse)
        && typeof toolChangeTime === 'number' && Number.isFinite(toolChangeTime);
      if (groupOk) {
        totalSec += toolChangeTime + g.count * timePerUse;
        anyResolved = true;
        confidence = this.combineConfidence(confidence, calc.confidence);
        resolutionStatus = this.combineResolutionStatus(resolutionStatus, calc.resolutionStatus);
      } else {
        if (calc.gap && !gap) gap = calc.gap;
        failureStatus = failureStatus
          ? this.combineResolutionStatus(failureStatus, calc.resolutionStatus)
          : calc.resolutionStatus;
      }
    }

    return {
      cycleTimeSec: anyResolved ? totalSec + HOLE_OP_UNLOAD_SEC : undefined,
      gap: anyResolved ? null : gap,
      calculatorId,
      calculatorVersion,
      confidence: anyResolved ? confidence : 'unsupported',
      resolutionStatus: anyResolved ? resolutionStatus : (failureStatus ?? 'unsupported_operation'),
    };
  }

  // Resolves surface treatment rate from surface_treatment_rates DB table (migration 362).
  // Table stores rates in USD/m²; result is converted to local currency via LOCATION_INFO FX pivot.
  //
  // Resolution order (avoids hardcoded regex keys where possible):
  //   1. If rawCallout provided: fuzzy-match against process_calculator_mappings.operation
  //      (process DB canonical names) then look up surface_treatment_rates.process_operation.
  //   2. Fallback: treatmentKey (regex-derived internal key) → surface_treatment_rates.treatment_type.
  //   3. Returns null when no DB row found — computeSurfaceTreatmentLine emits a warning.
  private async resolveSurfaceTreatmentDbRate(
    accessToken: string,
    treatmentKey: string | null,
    location: string,
    rates: RateSnapshot,
    rawCallout?: string | null,
    surfaceAreaMm2 = 0,
    batchSize = 1,
  ): Promise<SurfaceTreatmentDbRate | null> {
    if (!treatmentKey && !rawCallout?.trim()) return null;
    try {
      const locInfo = LOCATION_INFO[location] ?? LOCATION_INFO['USA']!;
      const usdToLocal = rates.convertStrict('USD', locInfo.code);
      const db = this.supabaseService.getClient(accessToken);

      // Step 1: Query process_calculator_mappings for the canonical operation name.
      // 'Post Processing' and 'Sheet Metal' are the process DB groups containing
      // surface treatment operations (anodize, powder coat, plating, passivation, etc.).
      if (rawCallout?.trim()) {
        const calloutLower = rawCallout.trim().toLowerCase();
        const { data: pcmOps } = await db
          .from('process_calculator_mappings')
          .select('operation')
          .in('process_group', ['Post Processing', 'Sheet Metal'])
          .eq('is_active', true);

        // Longest-match wins: avoids short noise words (e.g. 'coat' matching 'Clearcoat')
        let resolvedProcessOp: string | null = null;
        let bestLen = 0;
        for (const row of pcmOps ?? []) {
          const op = (row.operation as string | null) ?? '';
          const opLower = op.toLowerCase();
          if (opLower && calloutLower.includes(opLower) && op.length > bestLen) {
            resolvedProcessOp = op;
            bestLen = op.length;
          }
        }

        if (resolvedProcessOp) {
          for (const loc of [location, '__default__']) {
            const { data } = await db
              .from('surface_treatment_rates')
              .select('treatment_type, label, rate_per_m2_usd, min_lot_charge_usd')
              .eq('process_operation', resolvedProcessOp)
              .eq('location', loc)
              .maybeSingle();
            if (data) {
              return this.enrichSurfaceTreatmentRate(accessToken, {
                treatmentType: data.treatment_type as string,
                label: data.label as string,
                ratePerM2Local: Number(data.rate_per_m2_usd) * usdToLocal,
                minLotChargeLocal: Number(data.min_lot_charge_usd) * usdToLocal,
              }, surfaceAreaMm2, batchSize);
            }
          }
        }
      }

      // Step 2: Fallback — regex-derived treatment_type key.
      if (!treatmentKey) return null;
      for (const loc of [location, '__default__']) {
        const { data } = await db
          .from('surface_treatment_rates')
          .select('treatment_type, label, rate_per_m2_usd, min_lot_charge_usd')
          .eq('treatment_type', treatmentKey)
          .eq('location', loc)
          .maybeSingle();
        if (data) {
          return this.enrichSurfaceTreatmentRate(accessToken, {
            treatmentType: data.treatment_type as string,
            label: data.label as string,
            ratePerM2Local: Number(data.rate_per_m2_usd) * usdToLocal,
            minLotChargeLocal: Number(data.min_lot_charge_usd) * usdToLocal,
          }, surfaceAreaMm2, batchSize);
        }
      }
    } catch { /* non-critical */ }
    return null;
  }

  // Resolves the real "Post Processing - Surface Treatment" calculator's
  // Total Cost (area×rate vs. amortized min-lot, via resolvePhysicsQuantity)
  // for this part's real surface area/batch size, and merges it onto the
  // raw DB rate — the ONE enrichment point resolveSurfaceTreatmentDbRate's
  // two return sites both go through, so every caller gets it for free.
  // Skips the calculator call (returns `rate` unenriched) when surface area
  // isn't known yet — computeSurfaceTreatmentLine's own "area unknown" guard
  // already warns and skips the line entirely in that case, so there is
  // nothing real to seed the calculator with.
  private async enrichSurfaceTreatmentRate(
    accessToken: string,
    rate: SurfaceTreatmentDbRate,
    surfaceAreaMm2: number,
    batchSize: number,
  ): Promise<SurfaceTreatmentDbRate> {
    if (surfaceAreaMm2 <= 0) return rate;
    const calc = await this.resolvePhysicsQuantity(accessToken, {
      machineClass: 'surface_treatment',
      process: 'Surface Treatment',
      targetFieldNames: ['Total Cost'],
      seedScope: {
        'Surface Area': surfaceAreaMm2,
        'Rate Per M2': rate.ratePerM2Local,
        'Min Lot Charge': rate.minLotChargeLocal,
        'Lot Size': batchSize,
      },
      seedProvenance: {
        'Surface Area': 'CAD 3D surface area (bom_items.surface_area)',
        'Rate Per M2': `surface_treatment_rates — real rate for "${rate.label}" at this location`,
        'Min Lot Charge': `surface_treatment_rates — same row as Rate Per M2`,
        'Lot Size': 'Batch size for this quote',
      },
    });
    return {
      ...rate,
      totalCostFromCalculatorLocal: calc.outputs['Total Cost'],
      calculatorId: calc.calculatorId,
      calculatorVersion: calc.calculatorVersion,
      gap: calc.gap,
      confidence: calc.confidence,
      resolutionStatus: calc.resolutionStatus,
    };
  }

  private r2(n: number): number {
    return Math.round(n * 100) / 100;
  }
}