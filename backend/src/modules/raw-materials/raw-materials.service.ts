import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { readAllRows } from '../../common/supabase/read-all-rows';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateRawMaterialDto, UpdateRawMaterialDto, QueryRawMaterialsDto } from './dto/raw-materials.dto';
import { RawMaterialResponseDto, RawMaterialListResponseDto } from './dto/raw-material-response.dto';
import { shapeRankForFamily } from './constants/material-shape-ranking';

import {
  MATERIAL_SEARCH_SPELLING_VARIANTS,
  expandSearchTermSpellingVariants,
} from './material-search-spelling';
import { orderByRelevance, rankableFromDbRow } from './material-search-ranking';

// Re-exported so existing importers (and the spelling spec) keep working;
// the definitions live in material-search-spelling.ts so the search ranker
// can use them without a circular import back into this service.
export { MATERIAL_SEARCH_SPELLING_VARIANTS, expandSearchTermSpellingVariants };

// Builds the real PostgREST OR-ILIKE clause across material/material_group/
// material_grade for a search term, expanded across the real spelling
// variants above. Quotes each pattern so literal commas/parentheses in a
// real material name (e.g. "Generic Stainless Steel, Alloy (X10CrNi18-8)
// Wrought/AM") are never misread as PostgREST filter-syntax tokens — the
// same escaping the original single-block version of this search used; the
// OTHER call site (getEnhancedMaterials, below) previously built its
// OR-clause inline WITHOUT this escaping, a real latent bug this shared
// helper closes for both call sites at once, not just the reported one.
export function buildMaterialSearchOrClause(searchTerm: string): string {
  const variants = expandSearchTermSpellingVariants(searchTerm);
  const clauses = variants.flatMap((v) => {
    const safe = v.replace(/"/g, '\\"');
    return [
      `grade.ilike."%${safe}%"`,
      `material_group.ilike."%${safe}%"`,
      `name.ilike."%${safe}%"`,
    ];
  });
  return clauses.join(',');
}

@Injectable()
export class RawMaterialsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  // Full alias list. The material picker no longer needs it (search is ranked
  // server-side by findAll(), alias-aware); kept for any client that still
  // does its own alias matching.
  /** Stock-form prices (material_stock_prices, migration 833), optionally for one location. */
  async getStockPrices(accessToken: string, location?: string): Promise<Array<{
    referenceMaterial: string; rawMaterialName: string | null; stockForm: string; location: string;
    pricePerKg: number; currencyCode: string; source: string;
  }>> {
    let q = this.supabaseService.getClient(accessToken).from('material_stock_prices')
      .select('reference_material, raw_material_name, stock_form, location, price_per_kg, currency_code, source')
      .order('reference_material').order('stock_form');
    if (location) q = q.eq('location', location);
    const { data, error } = await q;
    if (error) {
      this.logger.error(`Error fetching material stock prices: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException('Material stock prices are not available (migration 833).');
    }
    return (data ?? []).map((r: any) => ({
      referenceMaterial: r.reference_material, rawMaterialName: r.raw_material_name, stockForm: r.stock_form,
      location: r.location, pricePerKg: Number(r.price_per_kg), currencyCode: r.currency_code, source: r.source,
    }));
  }

  async getAliases(accessToken?: string): Promise<Array<{ aliasNormalized: string; rawMaterialId: string }>> {
    const { data, error } = await this.supabaseService
      .getUserClient(accessToken)
      .from('material_aliases')
      .select('alias_normalized, raw_material_id');
    if (error) {
      this.logger.error(`Error fetching material aliases: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to fetch material aliases: ${error.message}`);
    }
    return (data || []).map((r) => ({ aliasNormalized: r.alias_normalized, rawMaterialId: r.raw_material_id }));
  }

  // Alias lookup: a drawing/search term like "AL6101" or "EN AW-6101" has no
  // substring in common with the row it should match ("Generic Aluminum, ANSI
  // 6101"), so ilike alone can never find it. Checked first, exact match only —
  // no fuzzy/nearest-neighbour guessing (a wrong material silently substituted
  // is worse than an honest "not found").
  private async resolveAliasId(searchTerm: string, accessToken?: string): Promise<string | null> {
    const normalized = searchTerm.toUpperCase().replace(/[\s-]/g, '');
    if (!normalized) return null;
    const { data } = await this.supabaseService
      .getUserClient(accessToken)
      .from('material_aliases')
      .select('raw_material_id')
      .eq('alias_normalized', normalized)
      .maybeSingle();
    return data?.raw_material_id ?? null;
  }

  async findAll(query: QueryRawMaterialsDto, userId?: string, accessToken?: string): Promise<RawMaterialListResponseDto> {
    this.logger.log('Fetching all raw materials', 'RawMaterialsService');

    let queryBuilder = this.supabaseService
      .getUserClient(accessToken)
      .from('raw_materials')
      .select('*', { count: 'exact' });

    // Apply filters
    if (query.materialGroup) {
      queryBuilder = queryBuilder.eq('material_group', query.materialGroup);
    }
    if (query.materialClass) {
      queryBuilder = queryBuilder.eq('material_class', query.materialClass);
    }
    let processMaterialGroups: string[] | undefined;
    if (query.processGroup) {
      processMaterialGroups = await this.materialGroupsForProcess(query.processGroup, accessToken);
      if (processMaterialGroups.length > 0) queryBuilder = queryBuilder.in('material_group', processMaterialGroups);
    }

    if (query.material) {
      queryBuilder = queryBuilder.eq('grade', query.material);
    }



    // Search across multiple fields.
    // Wrap pattern in double quotes so PostgREST treats commas and parentheses
    // inside the search term as literal characters, not filter-syntax tokens.
    // e.g. "Generic Stainless Steel, Alloy (X10CrNi18-8) Wrought/AM" would
    // otherwise split on the comma and be misread as nested grouping.
    let aliasId: string | null = null;
    if (query.search) {
      aliasId = await this.resolveAliasId(query.search, accessToken);
      if (aliasId) {
        queryBuilder = queryBuilder.eq('id', aliasId);
      } else {
        queryBuilder = queryBuilder.or(buildMaterialSearchOrClause(query.search));
      }
    }

    // Apply sorting
    // The list sorts by the DB column; 'material' (the Name header's key) sorts the source name, as before.
    const SORT_COLUMN: Record<string, string> = { material: 'grade', material_grade: 'name' };
    const sortBy = SORT_COLUMN[query.sortBy || 'material'] ?? query.sortBy ?? 'grade';
    const sortOrder = query.sortOrder || 'asc';
    queryBuilder = queryBuilder.order(sortBy, { ascending: sortOrder === 'asc' });

    // Pages are cut here, not left to the database default (1000 rows), so every
    // page is reachable. A browse pages in the database; a search is ranked over
    // its whole match set first, then paged in memory.
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(1000, Math.max(1, query.limit ?? 100));
    const offset = (page - 1) * limit;
    queryBuilder = query.search ? queryBuilder.limit(1000) : queryBuilder.range(offset, offset + limit - 1);

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching raw materials: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to fetch raw materials: ${error.message}`);
    }

    const rows = data || [];

    // A search is a recommendation problem, not just a filter: order by
    // relevance (exact > alias > designation > cross-standard > prefix) so the
    // grade the user meant is first, and say WHY each row matched. An explicit
    // sortBy from the caller still wins -- relevance only replaces the
    // default alphabetical order. Results are reordered, never dropped.
    if (query.search && !query.sortBy) {
      const ordered = orderByRelevance(
        query.search,
        rows,
        rankableFromDbRow,
        { aliasRowIds: aliasId ? new Set([aliasId]) : undefined },
      );
      const items = ordered.map(({ item, tier, reason, isBest }) => ({
        ...RawMaterialResponseDto.fromDatabase(item),
        matchTier: tier,
        matchReason: reason,
        matchIsBest: isBest,
      }));
      return {
        items: await this.withStockCoverage(items.slice(offset, offset + limit), accessToken), total: count || 0,
        ...(processMaterialGroups ? { processMaterialGroups } : {}),
      };
    }

    const items = rows.map(row => RawMaterialResponseDto.fromDatabase(row));

    return {
      items: await this.withStockCoverage(items, accessToken), total: count || 0,
      ...(processMaterialGroups ? { processMaterialGroups } : {}),
    };
  }

  /** Every process group <-> material group link (process_material_groups, migration 879). */
  async processMaterialGroups(accessToken?: string): Promise<Array<{ processGroup: string; materialGroup: string }>> {
    const { data, error } = await this.supabaseService
      .getUserClient(accessToken)
      .from('process_material_groups')
      .select('process_group, material_group')
      .order('process_group');
    if (error) throw new InternalServerErrorException(`Failed to read process material groups: ${error.message}`);
    return (data ?? []).map((r: { process_group: string; material_group: string }) => ({ processGroup: r.process_group, materialGroup: r.material_group }));
  }

  /** The material groups linked to a process group (process_material_groups, migration 879). */
  private async materialGroupsForProcess(processGroup: string, accessToken?: string): Promise<string[]> {
    const { data, error } = await this.supabaseService
      .getUserClient(accessToken)
      .from('process_material_groups')
      .select('material_group')
      .eq('process_group', processGroup);
    if (error) throw new InternalServerErrorException(`Failed to read process material groups: ${error.message}`);
    return (data ?? []).map((r: { material_group: string }) => r.material_group);
  }

  // Adds how many USA stock forms each listed material has priced (migration 864). The key is the
  // one the costing uses: grade, falling back to the name.
  private async withStockCoverage<T extends { materialGrade?: string; material: string; stockFormsPriced?: number }>(
    items: T[],
    accessToken?: string,
  ): Promise<T[]> {
    const keys = [...new Set(items.map((i) => i.materialGrade || i.material))];
    if (keys.length === 0) return items;
    const { data, error } = await this.supabaseService
      .getUserClient(accessToken)
      .rpc('material_stock_coverage', { p_keys: keys, p_location: 'USA' });
    if (error) throw new InternalServerErrorException(`Failed to read stock coverage: ${error.message}`);
    const counts = new Map((data ?? []).map((r: { reference_material: string; priced_forms: number }) => [r.reference_material, r.priced_forms]));
    return items.map((i) => ({ ...i, stockFormsPriced: counts.get(i.materialGrade || i.material) ?? 0 }));
  }

  /**
   * The material class of each named material (raw_materials.material_class,
   * migration 897), matched exactly on grade or name — the names a BOM item
   * stores are picked from this table (migration 892). No match, or a name
   * whose rows disagree on the class, is null: never a nearest guess.
   */
  async materialClassesFor(names: readonly string[], accessToken?: string): Promise<Record<string, string | null>> {
    const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const out: Record<string, string | null> = Object.fromEntries(wanted.map((n) => [n, null]));
    if (wanted.length === 0) return out;
    const client = this.supabaseService.getUserClient(accessToken);
    const classesOf = new Map<string, Set<string | null>>();
    for (const column of ['grade', 'name'] as const) {
      const { data, error } = await readAllRows<{ grade: string | null; name: string | null; material_class: string | null }>(
        (from, to) => client.from('raw_materials').select('grade, name, material_class').in(column, wanted).order('id').range(from, to),
      );
      if (error) throw new InternalServerErrorException(`Failed to read material classes: ${error.message}`);
      for (const row of data) {
        const key = row[column];
        if (!key) continue;
        if (!classesOf.has(key)) classesOf.set(key, new Set());
        classesOf.get(key)?.add(row.material_class);
      }
    }
    for (const [key, classes] of classesOf) out[key] = classes.size === 1 ? [...classes][0] ?? null : null;
    return out;
  }

  async getFilterOptions(userId?: string, accessToken?: string): Promise<{
    materialGroups: string[];
    materialClasses: string[];
    materialTypes: string[];
    countries: string[];
    grades: string[];
  }> {
    this.logger.log('Fetching filter options', 'RawMaterialsService');

    // Every row: one request is capped at 1000 rows and the table is larger.
    const { data, error } = await readAllRows<{ material_group: string | null; material_class: string | null; grade: string | null; name: string | null }>(
      (from, to) => this.supabaseService
        .getUserClient(accessToken)
        .from('raw_materials')
        .select('material_group, material_class, grade, name')
        .order('id', { ascending: true })
        .range(from, to),
    );

    if (error) {
      this.logger.error(`Error fetching filter options: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to fetch filter options: ${error.message}`);
    }

    // Extract unique values
    const distinct = (values: (string | null)[]): string[] =>
      [...new Set(values.filter((v): v is string => !!v))].sort();
    const materialGroups = distinct(data.map(m => m.material_group));
    const materialClasses = distinct(data.map(m => m.material_class));
    const materialTypes = distinct(data.map(m => m.grade));
    const grades = distinct(data.map(m => m.name));

    return {
      materialGroups,
      materialClasses,
      materialTypes,
      countries: [],
      grades,
    };
  }

  async getProperties(id: string, accessToken: string): Promise<Array<{
    propertyKey: string; valueNum: number | null; valueText: string | null; unit: string | null; sourceVersion: string;
  }>> {
    const { data, error } = await this.supabaseService
      .getUserClient(accessToken)
      .from('raw_material_properties')
      .select('property_key, value_num, value_text, unit, source_version')
      .eq('raw_material_id', id)
      .order('property_key', { ascending: true });
    if (error) {
      this.logger.error(`Failed to read properties for ${id}: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to read material properties: ${error.message}`);
    }
    return (data ?? []).map((r: any) => ({
      propertyKey: r.property_key, valueNum: r.value_num === null ? null : Number(r.value_num),
      valueText: r.value_text, unit: r.unit, sourceVersion: r.source_version,
    }));
  }


  async findOne(id: string, userId: string, accessToken: string): Promise<RawMaterialResponseDto> {
    this.logger.log(`Fetching raw material: ${id}`, 'RawMaterialsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      this.logger.error(`Raw material not found: ${id}`, 'RawMaterialsService');
      throw new NotFoundException(`Raw material with ID ${id} not found`);
    }

    return RawMaterialResponseDto.fromDatabase(data);
  }

  async create(createRawMaterialDto: CreateRawMaterialDto, userId: string, accessToken: string, organizationId: string): Promise<RawMaterialResponseDto> {
    this.logger.log('Creating raw material', 'RawMaterialsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .insert({
        material_group: createRawMaterialDto.materialGroup,
        grade: createRawMaterialDto.material,
        name: createRawMaterialDto.materialGrade,
        material_type: createRawMaterialDto.materialType,
        material_description: createRawMaterialDto.materialDescription,
        stock_form: createRawMaterialDto.stockForm,
        matl_state: createRawMaterialDto.matlState,
        regrinding: createRawMaterialDto.regrinding,
        regrinding_percentage: createRawMaterialDto.regrindingPercentage,
        clamping_pressure_mpa: createRawMaterialDto.clampingPressureMpa,
        eject_deflection_temp_c: createRawMaterialDto.ejectDeflectionTempC,
        melting_temp_c: createRawMaterialDto.meltingTempC,
        mold_temp_c: createRawMaterialDto.moldTempC,
        density_kg_m3: createRawMaterialDto.densityKgM3,
        specific_heat_melt: createRawMaterialDto.specificHeatMelt,
        thermal_conductivity_melt: createRawMaterialDto.thermalConductivityMelt,
        location: createRawMaterialDto.location,
        cost: createRawMaterialDto.costIndia ?? createRawMaterialDto.cost ?? createRawMaterialDto.unitCost,
        currency: createRawMaterialDto.currency || 'USD',
        cost_france: createRawMaterialDto.costFrance,
        cost_germany: createRawMaterialDto.costGermany,
        cost_w_europe: createRawMaterialDto.costWEurope,
        cost_usa: createRawMaterialDto.costUsa,
        cost_india: createRawMaterialDto.costIndia,
        cost_e_europe: createRawMaterialDto.costEEurope,
        cost_china: createRawMaterialDto.costChina,
        cost_mexico: createRawMaterialDto.costMexico,
        // Additional properties
        density: createRawMaterialDto.density,
        ultimate_tensile_strength: createRawMaterialDto.ultimate_tensile_strength,
        yield_tensile_strength: createRawMaterialDto.yield_tensile_strength,
        shearing_strength: createRawMaterialDto.shearing_strength,
        astm_standard: createRawMaterialDto.astm_standard,
        din_standard: createRawMaterialDto.din_standard,
        en_standard: createRawMaterialDto.en_standard,
        jis_standard: createRawMaterialDto.jis_standard,
        shape: createRawMaterialDto.shape,
        strength_coeff_k_mpa: createRawMaterialDto.strengthCoeffKMpa,
        strain_hardening_exponent_n: createRawMaterialDto.strainHardeningExponentN,
        lankford_coefficient_r: createRawMaterialDto.lankfordCoefficientR,
        milling_speed_m_min: createRawMaterialDto.millingSpeedMMin,
        scrap_factor: createRawMaterialDto.scrapFactor,
        user_id: userId,
        organization_id: organizationId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(
        `Error creating raw material: ${error.message}`,
        'RawMaterialsService',
      );
      this.logger.error(
        `Supabase error details: ${JSON.stringify(error)}`,
        'RawMaterialsService',
      );
      throw new InternalServerErrorException(
        `Failed to create raw material: ${error.message}. Details: ${error.details || 'N/A'}`,
      );
    }

    return RawMaterialResponseDto.fromDatabase(data);
  }

  async createBatch(materials: CreateRawMaterialDto[], userId: string, accessToken: string, organizationId: string): Promise<number> {
    this.logger.log(`Batch creating ${materials.length} raw materials`, 'RawMaterialsService');

    const records = materials.map(dto => ({
      material_group: dto.materialGroup,
      grade: dto.material,
      name: dto.materialGrade,
      material_type: dto.materialType,
      material_description: dto.materialDescription,
      stock_form: dto.stockForm,
      matl_state: dto.matlState,
      regrinding: dto.regrinding,
      regrinding_percentage: dto.regrindingPercentage,
      clamping_pressure_mpa: dto.clampingPressureMpa,
      eject_deflection_temp_c: dto.ejectDeflectionTempC,
      melting_temp_c: dto.meltingTempC,
      mold_temp_c: dto.moldTempC,
      density_kg_m3: dto.densityKgM3,
      specific_heat_melt: dto.specificHeatMelt,
      thermal_conductivity_melt: dto.thermalConductivityMelt,
      location: dto.location,
      cost: dto.costIndia ?? dto.cost ?? dto.unitCost,
      currency: dto.currency || 'USD',
      cost_france: dto.costFrance,
      cost_germany: dto.costGermany,
      cost_w_europe: dto.costWEurope,
      cost_usa: dto.costUsa,
      cost_india: dto.costIndia,
      cost_e_europe: dto.costEEurope,
      cost_china: dto.costChina,
      cost_mexico: dto.costMexico,
      // Additional properties
      density: dto.density,
      ultimate_tensile_strength: dto.ultimate_tensile_strength,
      yield_tensile_strength: dto.yield_tensile_strength,
      shearing_strength: dto.shearing_strength,
      hardness: dto.hardness,
      hardness_system: dto.hardnessSystem,
      cut_code: dto.cutCode,
      astm_standard: dto.astm_standard,
      din_standard: dto.din_standard,
      en_standard: dto.en_standard,
      jis_standard: dto.jis_standard,
      shape: dto.shape,
      strength_coeff_k_mpa: dto.strengthCoeffKMpa,
      strain_hardening_exponent_n: dto.strainHardeningExponentN,
      lankford_coefficient_r: dto.lankfordCoefficientR,
      milling_speed_m_min: dto.millingSpeedMMin,
      scrap_factor: dto.scrapFactor,
      user_id: userId,
      organization_id: organizationId,
    }));

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .insert(records)
      .select();

    if (error) {
      this.logger.error(`Error batch creating materials: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to batch create materials: ${error.message}`);
    }

    const count = data?.length || 0;
    this.logger.log(`Successfully created ${count} materials in batch`, 'RawMaterialsService');
    return count;
  }

  async update(id: string, updateRawMaterialDto: UpdateRawMaterialDto, userId: string, accessToken: string): Promise<RawMaterialResponseDto> {
    this.logger.log(`Updating raw material: ${id}`, 'RawMaterialsService');

    await this.findOne(id, userId, accessToken);

    const updateData: any = {};
    
    // Helper function to handle string fields - convert empty strings to null
    const handleStringField = (value: string | undefined): string | null | undefined => {
      if (value === undefined) return undefined;
      if (value === '') return null;
      return value;
    };
    
    // Helper function to handle number fields - convert empty strings/undefined to null
    const handleNumberField = (value: number | undefined): number | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      return value;
    };
    
    if (updateRawMaterialDto.materialGroup !== undefined) updateData.material_group = handleStringField(updateRawMaterialDto.materialGroup);
    if (updateRawMaterialDto.material !== undefined) updateData.grade = handleStringField(updateRawMaterialDto.material);
    if (updateRawMaterialDto.materialGrade !== undefined) updateData.name = handleStringField(updateRawMaterialDto.materialGrade);
    if (updateRawMaterialDto.materialType !== undefined) updateData.material_type = handleStringField(updateRawMaterialDto.materialType);
    if (updateRawMaterialDto.materialDescription !== undefined) updateData.material_description = handleStringField(updateRawMaterialDto.materialDescription);
    if (updateRawMaterialDto.stockForm !== undefined) updateData.stock_form = handleStringField(updateRawMaterialDto.stockForm);
    if (updateRawMaterialDto.matlState !== undefined) updateData.matl_state = handleStringField(updateRawMaterialDto.matlState);
    if (updateRawMaterialDto.regrinding !== undefined) updateData.regrinding = handleStringField(updateRawMaterialDto.regrinding);
    if (updateRawMaterialDto.regrindingPercentage !== undefined) updateData.regrinding_percentage = handleNumberField(updateRawMaterialDto.regrindingPercentage);
    if (updateRawMaterialDto.clampingPressureMpa !== undefined) updateData.clamping_pressure_mpa = handleNumberField(updateRawMaterialDto.clampingPressureMpa);
    if (updateRawMaterialDto.ejectDeflectionTempC !== undefined) updateData.eject_deflection_temp_c = handleNumberField(updateRawMaterialDto.ejectDeflectionTempC);
    if (updateRawMaterialDto.meltingTempC !== undefined) updateData.melting_temp_c = handleNumberField(updateRawMaterialDto.meltingTempC);
    if (updateRawMaterialDto.moldTempC !== undefined) updateData.mold_temp_c = handleNumberField(updateRawMaterialDto.moldTempC);
    if (updateRawMaterialDto.densityKgM3 !== undefined) updateData.density_kg_m3 = handleNumberField(updateRawMaterialDto.densityKgM3);
    if (updateRawMaterialDto.specificHeatMelt !== undefined) updateData.specific_heat_melt = handleNumberField(updateRawMaterialDto.specificHeatMelt);
    if (updateRawMaterialDto.thermalConductivityMelt !== undefined) updateData.thermal_conductivity_melt = handleNumberField(updateRawMaterialDto.thermalConductivityMelt);
    if (updateRawMaterialDto.location !== undefined) updateData.location = handleStringField(updateRawMaterialDto.location);
    if (updateRawMaterialDto.cost !== undefined) updateData.cost = handleNumberField(updateRawMaterialDto.cost);
    if (updateRawMaterialDto.unitCost !== undefined) updateData.cost = handleNumberField(updateRawMaterialDto.unitCost);
    // The table's Cost column reads cost_usa for the USA region, so an edited USA cost must land there.
    if (updateRawMaterialDto.costUsa !== undefined) updateData.cost_usa = handleNumberField(updateRawMaterialDto.costUsa);
    if (updateRawMaterialDto.currency !== undefined) updateData.currency = updateRawMaterialDto.currency;
    
    // Update additional properties
    if (updateRawMaterialDto.density !== undefined) updateData.density = handleNumberField(updateRawMaterialDto.density);
    if (updateRawMaterialDto.ultimate_tensile_strength !== undefined) updateData.ultimate_tensile_strength = handleNumberField(updateRawMaterialDto.ultimate_tensile_strength);
    if (updateRawMaterialDto.yield_tensile_strength !== undefined) updateData.yield_tensile_strength = handleNumberField(updateRawMaterialDto.yield_tensile_strength);
    if (updateRawMaterialDto.shearing_strength !== undefined) updateData.shearing_strength = handleNumberField(updateRawMaterialDto.shearing_strength);
    if (updateRawMaterialDto.astm_standard !== undefined) updateData.astm_standard = handleStringField(updateRawMaterialDto.astm_standard);
    if (updateRawMaterialDto.din_standard !== undefined) updateData.din_standard = handleStringField(updateRawMaterialDto.din_standard);
    if (updateRawMaterialDto.en_standard !== undefined) updateData.en_standard = handleStringField(updateRawMaterialDto.en_standard);
    if (updateRawMaterialDto.jis_standard !== undefined) updateData.jis_standard = handleStringField(updateRawMaterialDto.jis_standard);
    if (updateRawMaterialDto.shape !== undefined) updateData.shape = handleStringField(updateRawMaterialDto.shape);
    if (updateRawMaterialDto.strengthCoeffKMpa !== undefined) updateData.strength_coeff_k_mpa = handleNumberField(updateRawMaterialDto.strengthCoeffKMpa);
    if (updateRawMaterialDto.strainHardeningExponentN !== undefined) updateData.strain_hardening_exponent_n = handleNumberField(updateRawMaterialDto.strainHardeningExponentN);
    if (updateRawMaterialDto.lankfordCoefficientR !== undefined) updateData.lankford_coefficient_r = handleNumberField(updateRawMaterialDto.lankfordCoefficientR);
    if (updateRawMaterialDto.millingSpeedMMin !== undefined) updateData.milling_speed_m_min = handleNumberField(updateRawMaterialDto.millingSpeedMMin);
    if (updateRawMaterialDto.scrapFactor !== undefined) updateData.scrap_factor = handleNumberField(updateRawMaterialDto.scrapFactor);

    this.logger.debug(`Update data to be sent to database: ${JSON.stringify(updateData, null, 2)}`, 'RawMaterialsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating raw material: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to update raw material: ${error.message}`);
    }

    return RawMaterialResponseDto.fromDatabase(data);
  }

  async remove(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting raw material: ${id}`, 'RawMaterialsService');

    await this.findOne(id, userId, accessToken);

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting raw material: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to delete raw material: ${error.message}`);
    }

    return { message: 'Raw material deleted successfully' };
  }

  async removeAll(userId: string, accessToken: string) {
    this.logger.log(`Deleting raw materials owned by the caller's organization`, 'RawMaterialsService');

    // Org-scoped via RLS (migration 621) — the global catalog (organization_id
    // IS NULL) is never matched by the UPDATE/DELETE policy, so this can only
    // ever delete rows the caller's own organization created, never the
    // shared reference catalog or another org's rows.
    const { count } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('*', { count: 'exact', head: true })
      .not('id', 'is', null);

    if (count === 0) {
      return { message: 'No materials to delete', deleted: 0 };
    }

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .delete()
      .not('id', 'is', null);

    if (error) {
      this.logger.error(`Error deleting raw materials: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to delete raw materials: ${error.message}`);
    }

    this.logger.log(`Successfully deleted ${count} raw materials`, 'RawMaterialsService');
    return { message: `Successfully deleted ${count} raw material(s)`, deleted: count };
  }

  async getGroupedByMaterialGroup(userId: string, accessToken: string): Promise<any> {
    this.logger.log('Fetching raw materials grouped by material group', 'RawMaterialsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('material_group, grade')
      .order('material_group', { ascending: true })
      .order('grade', { ascending: true });

    if (error) {
      this.logger.error(`Error fetching grouped materials: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to fetch grouped materials: ${error.message}`);
    }

    // Group by material_group
    const grouped = (data || []).reduce((acc: any, row: any) => {
      const group = row.material_group || 'Uncategorized';
      if (!acc[group]) {
        acc[group] = [];
      }
      acc[group].push({
        material: row.grade,
      });
      return acc;
    }, {});

    return grouped;
  }

  async getEnhancedMaterials(
    query: {
      page: number;
      limit: number;
      materialClass?: string;
      search?: string;
      partFamily?: string;
    },
    userId?: string,
    accessToken?: string
  ): Promise<{
    items: any[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
    success: boolean;
  }> {
    this.logger.log('Fetching enhanced raw materials', 'RawMaterialsService');

    // Use the reliable fallback approach directly
    this.logger.log('Using raw_materials table for enhanced materials', 'RawMaterialsService');
    
    let queryBuilder = this.supabaseService
      .getUserClient(accessToken)
      .from('raw_materials')
      .select('*', { count: 'exact' });

    // Apply filters to query
    // Ferrous / Non-Ferrous / Plastic & Rubber (raw_materials.material_class, migration 897).
    if (query.materialClass) {
      queryBuilder = queryBuilder.eq('material_class', query.materialClass);
    }

    let aliasId: string | null = null;
    if (query.search) {
      aliasId = await this.resolveAliasId(query.search, accessToken);
      if (aliasId) {
        queryBuilder = queryBuilder.eq('id', aliasId);
      } else {
        queryBuilder = queryBuilder.or(buildMaterialSearchOrClause(query.search));
      }
    }

    // Apply pagination. A SEARCH must be ranked across the whole match set
    // before it is paged (a DB range() over alphabetical order would put the
    // best match on whichever page its name happens to fall on), so a search
    // fetches its matches (capped) and pages the ranked list in memory; a
    // plain browse still pages in the database.
    const offset = (query.page - 1) * query.limit;
    if (query.search) {
      queryBuilder = queryBuilder.order('grade', { ascending: true }).limit(1000);
    } else {
      queryBuilder = queryBuilder.range(offset, offset + query.limit - 1);
      queryBuilder = queryBuilder.order('grade', { ascending: true });
    }

    const { data: fetched, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Enhanced materials query failed: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to fetch materials: ${error.message}`);
    }

    let data = fetched;
    const matchInfo = new Map<string, { tier: string; reason: string; isBest: boolean }>();
    if (query.search) {
      const ordered = orderByRelevance(
        query.search,
        fetched || [],
        rankableFromDbRow,
        { family: query.partFamily, aliasRowIds: aliasId ? new Set([aliasId]) : undefined },
      );
      for (const { item, tier, reason, isBest } of ordered) matchInfo.set(item.id, { tier, reason, isBest });
      data = ordered.slice(offset, offset + query.limit).map((o) => o.item);
    }

    // Transform data to match enhanced format with proper null handling
    const transformedData = (data || []).map(item => {
      // Ensure we have valid material name
      const materialName = item.grade || 'Unknown Material';
      const materialGrade = item.name || '';
      const materialGroup = item.material_group || 'Unknown';
      
      return {
        id: item.id,
        materialName: materialName,
        materialGrade: materialGrade,
        materialClass: item.material_class ?? null,
        costPerKg: item.cost || 0,
        costPerUnit: item.cost || 0,
        unitType: 'kg',
        densityKgM3: item.density_kg_m3 || null,
        utsMpa: item.ultimate_tensile_strength || item.uts_mpa || null,
        ytsMpa: item.yield_strength_mpa || null,
        shearingStrength: item.shearing_strength || null,
        elasticModulusGpa: item.elastic_modulus_gpa || null,
        hardnessValue: item.hardness || null,
        hardnessScale: item.hardness_scale || null,
        meltingTempCelsius: item.melting_temp_c || item.melting_temp_celsius || null,
        ejectDeflectionTempCelsius: item.eject_deflection_temp_c || item.eject_deflection_temp_celsius || null,
        thermalConductivityWMK: item.thermal_conductivity_melt || item.thermal_conductivity_w_m_k || null,
        specificHeatJGK: item.specific_heat_melt || item.specific_heat_j_g_k || null,
        maxServiceTempCelsius: item.max_service_temp_celsius || null,
        moldTempCelsiusMin: item.mold_temp_c || item.mold_temp_celsius_min || null,
        moldTempCelsiusMax: item.mold_temp_c || item.mold_temp_celsius_max || null,
        clampingPressureMpa: item.clamping_pressure_mpa || null,
        injectionPressureMpaMin: item.injection_pressure_mpa_min || null,
        injectionPressureMpaMax: item.injection_pressure_mpa_max || null,
        shrinkageRatePercent: item.regrinding_percentage || item.shrinkage_rate_percent || null,
        storageLocation: item.location || item.storage_location || '',
        leadTimeDays: item.lead_time_days || null,
        minimumOrderQuantity: item.minimum_order_quantity || null,
        qualityGrade: item.quality_grade || '',
        // Add missing fields
        shape: item.shape || '',
        status: 'active',
        createdAt: item.created_at || new Date().toISOString(),
        updatedAt: item.updated_at || new Date().toISOString(),
        matchTier: matchInfo.get(item.id)?.tier,
        matchReason: matchInfo.get(item.id)?.reason,
        matchIsBest: matchInfo.get(item.id)?.isBest,
      };
    });

    // Form-based ranking by manufacturing family — shared with the BOM costing
    // material lookup so browse order and costing pick can never disagree.
    // (A search already applied the family as a ranking tie-break above;
    // re-sorting here would undo relevance order.)
    if (query.partFamily && !query.search) {
      const family = query.partFamily;
      transformedData.sort((a, b) => {
        const rankA = shapeRankForFamily(a.shape, family);
        const rankB = shapeRankForFamily(b.shape, family);
        if (rankA !== rankB) return rankA - rankB;
        return (a.materialName ?? '').localeCompare(b.materialName ?? '');
      });
    }

    return {
      items: transformedData,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / query.limit),
        hasNext: query.page < Math.ceil((count || 0) / query.limit),
        hasPrev: query.page > 1,
      },
      success: true,
    };
  }
}
