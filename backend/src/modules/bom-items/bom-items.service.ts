import type { DbClient } from '../../common/db/postgrest-client';
import { BadRequestException, Injectable, Logger, NotFoundException, InternalServerErrorException, ForbiddenException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { quoteFilterValue } from '../../common/db/postgrest-filter';
import { expandSearchTermSpellingVariants } from '../raw-materials/material-search-spelling';
import { CreateBOMItemDto, UpdateBOMItemDto } from './dto/bom-items.dto';
import { BOM_ITEM_DTO_COLUMNS, BOMItemResponseDto, BOMItemListResponseDto } from './dto/bom-item-response.dto';

import { organizationIdOf } from '../../common/exchange-rate/exchange-rate.service';
import { MaterialResolutionService } from './services/material-resolution.service';
import { orIlikeContains } from '../../common/db/postgrest-filter';

/** Refusal when a BOM item is still used by a production lot the caller does not own (BOMItemsService.remove). */
export const IN_ANOTHER_MEMBERS_LOT =
  'This part is used in a production lot owned by another member; remove it from that lot first, or ask an organization admin to force the delete';

/** The machine-readable code of that refusal; `details` carries the blocking lots (LotBlockers). */
export const BOM_ITEM_IN_PRODUCTION_LOTS = 'BOM_ITEM_IN_PRODUCTION_LOTS';

/** Production lots that use a BOM item: the ids of those the caller can see, and how many more they cannot. */
export interface LotBlockers {
  visibleLotIds: string[];
  hiddenLotCount: number;
}

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
    private readonly databaseService: DatabaseService,
    private readonly materialResolutionService: MaterialResolutionService,
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

    // A new 3D model makes a stored thumbnail a picture of the old part; clear
    // it so the BOM list renders and stores a fresh one.
    if (
      (transformed.file_3d_path !== undefined || transformed.file_step_path !== undefined) &&
      transformed.thumbnail_url === undefined
    ) {
      transformed.thumbnail_url = null;
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
    this.logger.log('Fetching BOM items');

    const client = this.databaseService.getUserClient(accessToken);

    let query = client
      .from('bom_items')
      .select(BOM_ITEM_DTO_COLUMNS)
      .order('created_at', { ascending: false });

    // Apply filters
    if (bomId) {
      query = query.eq('bom_id', bomId);
      this.logger.log(`Filtering BOM items for BOM ID: ${bomId}`);
    }
    if (search) {
      query = query.or(orIlikeContains(['part_number', 'description'], search));
    }
    if (itemType) {
      query = query.eq('item_type', itemType);
    }

    // Get total count with same filters
    let countQuery = client
      .from('bom_items')
      .select('*', { count: 'exact', head: true });

    if (bomId) countQuery = countQuery.eq('bom_id', bomId);
    if (search) countQuery = countQuery.or(orIlikeContains(['part_number', 'description'], search));
    if (itemType) countQuery = countQuery.eq('item_type', itemType);

    const { count } = await countQuery;

    // Apply pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    this.logger.log(`Query results: Found ${data?.length || 0} BOM items for BOM ID: ${bomId}`);
    
    // Additional debug: Check if the BOM exists but has no items
    if (bomId && (!data || data.length === 0)) {
      const { data: bomCheck } = await client.from('boms').select('id, name').eq('id', bomId).single();
      if (bomCheck) {
        this.logger.log(`BOM exists but has no items: ${bomCheck.name} (${bomCheck.id})`);
      } else {
        this.logger.log(`BOM not found with ID: ${bomId}`);
      }
    }
    
    if (error) {
      this.logger.error(`Error fetching BOM items: ${error.message}`);
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
    this.logger.log(`Fetching BOM item with ID: ${id}`);

    const client = this.databaseService.getUserClient(accessToken);

    const { data, error } = await client
      .from('bom_items')
      .select(BOM_ITEM_DTO_COLUMNS)
      .eq('id', id)
      .limit(1);

    if (error) {
      this.logger.error(`Error fetching BOM item: ${error.message}`);
      throw new InternalServerErrorException(`Failed to fetch BOM item: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new NotFoundException(`BOM item with ID ${id} not found`);
    }

    return BOMItemResponseDto.fromDatabase(row);
  }

  /**
   * The organization a BOM item belongs to (null when it has none), read as the caller: the costing of a part converts with
   * that organization's budget exchange rates (ExchangeRateService.getSnapshot).
   */
  async organizationOfItem(id: string, accessToken?: string | null): Promise<string | null> {
    const { data, error } = await this.databaseService
      .getUserClient(accessToken ?? undefined)
      .from('bom_items')
      .select('organization_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(`Failed to read the BOM item's organization: ${error.message}`);
    if (!data) throw new NotFoundException(`BOM item with ID ${id} not found`);
    return organizationIdOf(data);
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
    return this.insertItem(this.databaseService.getUserClient(accessToken), createBOMItemDto, userId, organizationId);
  }

  private async insertItem(
    client: DbClient,
    createBOMItemDto: CreateBOMItemDto,
    userId?: string,
    organizationId?: string | null,
  ): Promise<BOMItemResponseDto> {
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
      this.logger.error(`Error creating BOM item: ${error.message}`);
      throw new InternalServerErrorException(`Failed to create BOM item: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new InternalServerErrorException('Failed to create BOM item: no row returned');
    return BOMItemResponseDto.fromDatabase(row);
  }

  /**
   * The three methods below serve the CAD upload runner, a background job with no user session. The upload
   * endpoint has already checked, through RLS, that the user can see the BOM, and the items carry that user and
   * organization exactly as if they had created them.
   */
  async createForUpload(dto: CreateBOMItemDto, userId: string, organizationId: string | null): Promise<BOMItemResponseDto> {
    return this.insertItem(
      this.databaseService.getPrivilegedClient('cad-upload runner: create BOM items for a checked upload'),
      dto,
      userId,
      organizationId,
    );
  }

  async setFile3dPathForUpload(itemId: string, file3dPath: string): Promise<void> {
    const { error } = await this.databaseService
      .getPrivilegedClient('cad-upload runner: attach the uploaded 3D file to its item')
      .from('bom_items')
      .update({ file_3d_path: file3dPath, thumbnail_url: null }) // a new model invalidates any stored thumbnail, as update() does
      .eq('id', itemId);
    if (error) throw new InternalServerErrorException(`Failed to attach the 3D file: ${error.message}`);
  }

  /**
   * Removes the items of a failed or retried upload and returns their stored 3D file paths, so the caller can remove
   * those files too. Children go before parents (reverse creation order), so no item is removed while another still
   * points at it.
   */
  async deleteItemsForUpload(itemIds: string[]): Promise<string[]> {
    const client = this.databaseService.getPrivilegedClient('cad-upload runner: remove the items of a failed or retried upload');
    const { data } = await client.from('bom_items').select('file_3d_path').in('id', itemIds);
    const paths = (data ?? []).map((row: { file_3d_path: string | null }) => row.file_3d_path).filter((p): p is string => !!p);
    for (const id of [...itemIds].reverse()) {
      const { error } = await client.from('bom_items').delete().eq('id', id);
      if (error) this.logger.warn(`Could not remove BOM item ${id} of an upload: ${error.message}`);
    }
    return paths;
  }

  async update(
    id: string,
    updateBOMItemDto: UpdateBOMItemDto,
    userId?: string,
    accessToken?: string,
  ): Promise<BOMItemResponseDto> {
    this.logger.log(`Updating BOM item with ID: ${id}`);

    const client = this.databaseService.getUserClient(accessToken);

    // Transform camelCase DTO to snake_case database columns
    const dbData = this.transformDtoToDb(updateBOMItemDto);

    // Root cause (2026-09-19, confirmed live): a part's real net weight was
    // never computed anywhere once a material grade was chosen.
    // auto-fill.service.ts deliberately writes weight: 0 at CAD-import time
    // ("Weight is NOT computed either, because it cannot be... weight
    // follows once a real material is chosen and its real density
    // applies") but no code path ever performed that follow-up — confirmed
    // by grep: bom_items.weight is written 0 at import and never written
    // again anywhere in this codebase. Every consumer reading (item as
    // any).weight (Blank Stock "Net weight", the CNC capability weight
    // gate, sustainability calcs) saw a permanent 0 regardless of real
    // geometry — e.g. Blank Stock showing "Net weight: 0.000 kg" next to a
    // real, nonzero Utilization % computed independently from real volume.
    // materialGrade is committed through this single generic update
    // endpoint (manufacturing-intelligence/page.tsx's own "Single commit
    // point for Material Grade" — every picker only stages a value until
    // Apply calls updateBOMItem), so this is the one real place to close
    // the gap for good: resolve the real density for the grade being
    // committed and persist the real weight in the SAME write, rather than
    // leaving the column permanently stale and recomputing a display-only
    // number wherever it's read.
    const gradeBeingSet = (updateBOMItemDto.materialGrade ?? '').trim();
    if (gradeBeingSet && updateBOMItemDto.weight === undefined) {
      let volumeMm3 = updateBOMItemDto.volume;
      let family: string | null = null;
      if (volumeMm3 == null) {
        const { data: existing } = await client
          .from('bom_items')
          .select('volume, family_classification')
          .eq('id', id)
          .maybeSingle();
        volumeMm3 = (existing?.volume as number | null) ?? undefined;
        family = (existing?.family_classification as string | null) ?? null;
      }
      if (volumeMm3 != null && volumeMm3 > 0) {
        const densityKgM3 = await this.materialResolutionService.resolveDensityKgM3(
          accessToken ?? '', gradeBeingSet, family ?? undefined,
        );
        if (densityKgM3 != null && densityKgM3 > 0) {
          dbData.weight = Math.round((volumeMm3 / 1e9) * densityKgM3 * 1000) / 1000;
        }
      }
    }

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
      this.logger.error(`Error updating BOM item: ${error.message}`);
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
    this.logger.log(`Updating thumbnail for BOM item: ${id}`);
    const { error } = await this.databaseService
      .getUserClient(accessToken)
      .from('bom_items')
      .update({ thumbnail_url: thumbnailUrl, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      this.logger.error(`Error updating thumbnail: ${error.message}`);
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
    const client = this.databaseService.getUserClient(accessToken);

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
      this.logger.error(`Error merging scenario overrides for ${id}: ${error.message}`);
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
    this.logger.log(`Updating sort order for ${items.length} BOM items`);

    const client = this.databaseService.getUserClient(accessToken);
    
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
        this.logger.error(`Error batch updating sort order: ${error.message}`);
        return { updated: 0 };
      }

      return { updated: count || items.length };
    } catch (error) {
      this.logger.error(`Error in batch sort order update: ${error}`);
      return { updated: 0 };
    }
  }

  /**
   * The stored path of an item's 2D or 3D file, read as the caller (so RLS
   * decides whether they may see the item), or null if it has none.
   * Only the two path columns: the full row (feature graph, analyses, embedded
   * thumbnail) is many KB per call, and this runs for every thumbnail.
   */
  async findFilePath(id: string, fileType: '2d' | '3d', accessToken?: string): Promise<string | null> {
    const { data, error } = await this.databaseService
      .getUserClient(accessToken)
      .from('bom_items')
      .select('file_2d_path, file_3d_path')
      .eq('id', id)
      .limit(1);
    if (error) {
      this.logger.error(`Error fetching BOM item file paths: ${error.message}`);
      throw new InternalServerErrorException(`Failed to fetch BOM item: ${error.message}`);
    }
    const row = (data as { file_2d_path: string | null; file_3d_path: string | null }[] | null)?.[0];
    if (!row) {
      throw new NotFoundException(`BOM item with ID ${id} not found`);
    }
    return (fileType === '2d' ? row.file_2d_path : row.file_3d_path) ?? null;
  }


  /**
   * Deletes a BOM item and the references the caller may remove: their production lot materials and the parent link of its
   * children. Everything else that hangs off the item (its process routes and their steps among them) goes with it by the
   * foreign keys' ON DELETE CASCADE: the database does that, so no table beyond the item's own is read here. Everything is written as the caller (RLS). Production lot materials are
   * readable and writable only by the owner of the lot's BOM (migration 067) and reference the item ON DELETE RESTRICT, so when
   * another member's lot uses the part the delete is refused before anything is changed, with 409 BOM_ITEM_IN_PRODUCTION_LOTS
   * naming the blocking lots (LotBlockers); never forced through with the privileged client. An organization admin can force it
   * with forceRemove().
   */
  async remove(
    id: string,
    _userId?: string,
    accessToken?: string,
  ): Promise<void> {
    this.logger.log(`Removing BOM item with ID: ${id}`);
    const client = this.databaseService.getUserClient(accessToken);
    const fail = (what: string, error: { message: string }): never => {
      this.logger.error(`BOM item ${id}: ${what}: ${error.message}`);
      throw new InternalServerErrorException(`Failed to delete BOM item: ${what}: ${error.message}`);
    };

    const { data: items, error: fetchError } = await client.from('bom_items').select('id, part_number').eq('id', id).limit(1);
    if (fetchError) fail('could not read the item', fetchError);
    const item = (items as Array<{ id: string; part_number: string | null }> | null)?.[0];
    if (!item) throw new NotFoundException(`BOM item with ID ${id} not found`);

    // Production lot materials: the caller's own (visible under RLS) are removed below; any the caller cannot see belong to a
    // lot owned by another member, and the item must not be deleted from under them.
    const blockers = await this.lotBlockers(client, id, fail);
    if (blockers.hiddenLotCount > 0) throw this.inProductionLots(blockers);

    if (blockers.visibleLotIds.length > 0) {
      const { error } = await client.from('production_lot_materials').delete().eq('bom_item_id', id);
      if (error) fail('could not remove production lot materials', error);
    }

    const { error: childError } = await client.from('bom_items').update({ parent_item_id: null }).eq('parent_item_id', id);
    if (childError) fail('could not detach child items', childError);

    const { error: deleteError } = await client.from('bom_items').delete().eq('id', id);
    if (deleteError) {
      if (deleteError.code === '23503') {
        // a lot material added by another member since the check above
        if (deleteError.message.includes('production_lot_materials')) throw this.inProductionLots(await this.lotBlockers(client, id, fail));
        throw new ConflictException(
          `Cannot delete BOM item "${item.part_number || id}": it is referenced by other data. Remove those references first.`,
        );
      }
      if (deleteError.code === '42501') throw new ForbiddenException('Insufficient permissions to delete this BOM item');
      fail('could not delete the item', deleteError);
    }
    this.logger.log(`Deleted BOM item "${item.part_number || id}"`);
  }

  /**
   * An organization admin's delete of an item other members' production lots still use: delete_bom_item_cascade() (migration 945)
   * checks the caller is an admin of the item's organization, removes every lot's reference to it, its routes and the item, and
   * writes the audit event, in one transaction, as one reviewed SECURITY DEFINER function.
   */
  async forceRemove(id: string, accessToken: string): Promise<{ lotMaterials: number; lots: number }> {
    const { data, error } = await this.databaseService.getUserClient(accessToken).rpc('delete_bom_item_cascade', { p_item_id: id });
    if (error) {
      if (error.code === 'P0002') throw new NotFoundException(`BOM item with ID ${id} not found`);
      if (error.code === '42501') throw new ForbiddenException('Only an admin of the item\'s organization can force its delete.');
      this.logger.error(`BOM item ${id}: forced delete failed: ${error.message}`);
      throw new InternalServerErrorException(`Failed to delete BOM item: ${error.message}`);
    }
    return data as { lotMaterials: number; lots: number };
  }

  /**
   * The production lots using an item: the lot materials the caller can see (their own lots) give the visible lot ids; reading
   * every lot material of the item is the one privileged step, read only, and only its count of other lots leaves this method.
   */
  private async lotBlockers(
    client: ReturnType<DatabaseService['getUserClient']>,
    id: string,
    fail: (what: string, error: { message: string }) => never,
  ): Promise<LotBlockers> {
    const { data: visible, error: visibleError } = await client.from('production_lot_materials').select('production_lot_id').eq('bom_item_id', id);
    if (visibleError) fail('could not check production lot materials', visibleError);
    const { data: all, error: allError } = await this.databaseService
      .getPrivilegedClient('bom-item delete: which production lots use a BOM item the caller can see, to refuse when another member\'s lot uses it (read only)')
      .from('production_lot_materials')
      .select('production_lot_id')
      .eq('bom_item_id', id);
    if (allError || !all) fail('could not check production lot materials', allError ?? { message: 'no rows returned' });
    const lotsOf = (rows: unknown) => new Set(((rows ?? []) as Array<{ production_lot_id: string }>).map((r) => r.production_lot_id));
    const visibleLots = lotsOf(visible);
    const hiddenLotCount = [...lotsOf(all)].filter((lot) => !visibleLots.has(lot)).length;
    return { visibleLotIds: [...visibleLots].sort(), hiddenLotCount };
  }

  private inProductionLots(blockers: LotBlockers): ConflictException {
    return new ConflictException({ code: BOM_ITEM_IN_PRODUCTION_LOTS, message: IN_ANOTHER_MEMBERS_LOT, details: blockers });
  }

  /**
   * Density of a material grade (g/cm³): the curated material_density_lookup reference table first (exact, then partial match, any
   * real spelling variant), then the caller's own raw materials. Nulls when nothing plausible is found.
   */
  async materialDensity(
    grade: string,
    accessToken: string,
  ): Promise<{ density_g_cm3: number | null; material_name: string | null; material_grade: string | null }> {
    const none = { density_g_cm3: null, material_name: null, material_grade: null };
    const g = grade.trim();
    if (!g) return none;
    const client = this.databaseService.getPrivilegedClient('reference-data: material_density_lookup, global shared');
    // Same real AmE/BrE spelling variants the Material search already reconciles (material-search-spelling.ts): a drawing
    // extracting "ALUMINIUM" must resolve to the same "Aluminum"-spelled rows the search box finds.
    const variants = expandSearchTermSpellingVariants(g);
    const orClause = (columns: string[], wildcard: boolean) =>
      variants.flatMap((v) => {
        const pattern = wildcard ? `%${v}%` : v;
        return columns.map((col) => `${col}.ilike.${quoteFilterValue(pattern)}`);
      }).join(',');

    // 1. Exact match in the curated lookup table, 2. partial match there
    let { data } = await client
      .from('material_density_lookup')
      .select('material_name, material_grade, density_g_cm3')
      .or(orClause(['material_grade'], false))
      .limit(1)
      .maybeSingle();
    if (!data) {
      ({ data } = await client
        .from('material_density_lookup')
        .select('material_name, material_grade, density_g_cm3')
        .or(orClause(['material_grade', 'material_name'], true))
        .limit(1)
        .maybeSingle());
    }

    // 3. The caller's own raw materials (density in g/cm³), org-scoped: read as the caller, never with the service role.
    if (!data) {
      const rm = await this.databaseService.getUserClient(accessToken)
        .from('raw_materials')
        .select('grade, name, density')
        .or(orClause(['name', 'grade'], true))
        .not('density', 'is', null)
        .limit(1)
        .maybeSingle();
      if (rm.data) {
        const d = parseFloat(rm.data.density);
        // Real engineering materials are 0.5–22 g/cm³
        if (isFinite(d) && d >= 0.5 && d <= 22) {
          return { density_g_cm3: d, material_name: rm.data.grade, material_grade: rm.data.name };
        }
      }
    }

    if (!data) return none;
    return {
      density_g_cm3: parseFloat(data.density_g_cm3),
      material_name: data.material_name,
      material_grade: data.material_grade,
    };
  }

  async getBOMIdForItem(
    itemId: string,
    userId?: string,
    accessToken?: string,
  ): Promise<string> {
    this.logger.log(`Getting BOM ID for item: ${itemId}`);

    const client = this.databaseService.getUserClient(accessToken);

    const { data, error } = await client
      .from('bom_items')
      .select('bom_id')
      .eq('id', itemId)
      .single();

    if (error) {
      this.logger.error(`Error fetching BOM ID for item: ${error.message}`);
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
    this.logger.log(`Checking delete dependencies for BOM item: ${id}`);

    const client = this.databaseService.getUserClient(accessToken);
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
    const client = this.databaseService.getUserClient(accessToken);

    const { data, error } = await client
      .from('boms')
      .select('project_id')
      .eq('id', bomId)
      .single();

    if (error) {
      this.logger.error(`Error fetching project ID for BOM: ${error.message}`);
      throw new InternalServerErrorException(`Failed to fetch project ID: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException(`BOM with ID ${bomId} not found`);
    }

    return data.project_id;
  }
}
