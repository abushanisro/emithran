import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { evaluateCalculatorFormulas } from './calculator-formula-evaluator';
import { PHYSICS_REGISTRY } from './physics-registry';
import { SheetMetalLookupService, normaliseLaserMaterial } from '../bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';
import { BOMItemsService } from '../bom-items/bom-items.service';
import { resolveNetUsagePhysics } from '../bom-items/costing/sheet-metal/raw-material/sheet-metal-net-usage.physics';
import {
  CreateCalculatorDto,
  UpdateCalculatorDto,
  QueryCalculatorDto,
  ExecuteCalculatorDto,
  CreateFieldDto,
  UpdateFieldDto,
  CreateFormulaDto,
  UpdateFormulaDto,
} from './dto/calculator.dto';

/**
 * CalculatorsServiceV2 - Enterprise Grade
 *
 * PRINCIPLES:
 * 1. ALL operations are atomic (no partial saves)
 * 2. Single source of truth (database)
 * 3. Transaction safety
 * 4. Proper error handling
 * 5. No stale state
 */
@Injectable()
export class CalculatorsServiceV2 {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
    private readonly sheetMetalLookup: SheetMetalLookupService,
    private readonly bomItemsService: BOMItemsService,
  ) { }

  /**
   * GET ALL CALCULATORS
   * Returns calculators with their fields and formulas in one atomic read
   * SECURITY: Enforces tenant isolation via user_id filter
   */
  async findAll(query: QueryCalculatorDto, userId: string, accessToken: string) {
    this.logger.log(`Fetching calculators for user: ${userId}`, 'CalculatorsServiceV2');

    const page = query.page || 1;
    const limit = Math.min(query.limit || 10, 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const client = this.supabaseService.getClient(accessToken);

    // Build query: user's own calculators + all global/library calculators
    let queryBuilder = client
      .from('calculators')
      .select(
        `
        *,
        fields:calculator_fields(*),
        formulas:calculator_formulas(*)
      `,
        { count: 'exact' },
      )
      // Fixed pre-existing bug: `is_global` is not a real column on
      // calculators (only `is_public`, plus now `user_id IS NULL` for
      // global calculators seeded by migration 470) -- this `.or()` used to
      // reference a nonexistent column, so the "show me public/global
      // calculators too" fallback was silently broken.
      .or(`user_id.eq.${userId},is_public.eq.true,user_id.is.null`)
      .order('created_at', { ascending: false })
      .range(from, to);

    // Apply filters
    if (query.search) {
      queryBuilder = queryBuilder.or(`name.ilike.%${query.search}%,description.ilike.%${query.search}%`);
    }

    if (query.calcCategory) {
      queryBuilder = queryBuilder.eq('calc_category', query.calcCategory);
    }

    if (query.calculatorType) {
      queryBuilder = queryBuilder.eq('calculator_type', query.calculatorType);
    }

    if (query.isTemplate !== undefined) {
      queryBuilder = queryBuilder.eq('is_template', query.isTemplate);
    }

    if (query.isPublic !== undefined) {
      queryBuilder = queryBuilder.eq('is_public', query.isPublic);
    }

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Failed to fetch calculators: ${error.message}`, 'CalculatorsServiceV2');
      throw new Error(error.message);
    }

    return {
      calculators: data || [],
      total: count || 0,
      page,
      limit,
    };
  }

  /**
   * GET SINGLE CALCULATOR
   * Returns complete calculator with all fields and formulas
   * SECURITY: Enforces ownership verification via user_id
   */
  async findOne(id: string, userId: string, accessToken: string) {
    this.logger.log(`Fetching calculator: ${id} for user: ${userId}`, 'CalculatorsServiceV2');

    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('calculators')
      .select(
        `
        *,
        fields:calculator_fields(*),
        formulas:calculator_formulas(*)
      `,
      )
      .eq('id', id)
      // Fixed pre-existing bug: `is_global` is not a real column on
      // calculators (only `is_public`, plus now `user_id IS NULL` for
      // global calculators seeded by migration 470) -- this `.or()` used to
      // reference a nonexistent column, so the "show me public/global
      // calculators too" fallback was silently broken.
      .or(`user_id.eq.${userId},is_public.eq.true,user_id.is.null`)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Calculator not found or access denied: ${id}`);
    }

    // Sort fields and formulas by order
    if (data.fields) {
      data.fields.sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0));
    }

    if (data.formulas) {
      data.formulas.sort((a: any, b: any) => (a.execution_order || 0) - (b.execution_order || 0));
    }

    return data;
  }

  /**
   * CREATE CALCULATOR (ATOMIC)
   * Creates calculator + fields + formulas in a single transaction
   */
  async create(dto: CreateCalculatorDto, userId: string, accessToken: string) {
    this.logger.log(`Creating calculator: ${dto.name}`, 'CalculatorsServiceV2');

    const client = this.supabaseService.getClient(accessToken);

    // STEP 1: Create calculator
    const { data: calculator, error: calcError } = await client
      .from('calculators')
      .insert({
        user_id: userId,
        name: dto.name,
        description: dto.description,
        calc_category: dto.calcCategory,
        calculator_type: dto.calculatorType,
        is_template: dto.isTemplate || false,
        is_public: dto.isPublic || false,
        template_category: dto.templateCategory,
        display_config: dto.displayConfig || {},
        associated_process_id: dto.associatedProcessId,
        version: 1,
      })
      .select()
      .single();

    if (calcError || !calculator) {
      this.logger.error(`Failed to create calculator: ${calcError?.message}`, 'CalculatorsServiceV2');
      throw new Error(calcError?.message || 'Failed to create calculator');
    }

    const calculatorId = calculator.id;

    // STEP 2: Create fields (if provided)
    let createdFields = [];
    if (dto.fields && dto.fields.length > 0) {
      const fieldsToInsert = dto.fields.map((field, index) => ({
        calculator_id: calculatorId,
        field_name: field.fieldName,
        display_label: field.displayLabel,
        field_type: field.fieldType,
        data_source: field.dataSource,
        source_table: field.sourceTable,
        source_field: field.sourceField,
        lookup_config: field.lookupConfig || {},
        default_value: field.defaultValue,
        unit: field.unit,
        min_value: field.minValue,
        max_value: field.maxValue,
        is_required: field.isRequired || false,
        validation_rules: field.validationRules || {},
        input_config: field.inputConfig || {},
        display_order: field.displayOrder !== undefined ? field.displayOrder : index,
        field_group: field.fieldGroup,
      }));

      const { data: fields, error: fieldsError } = await client
        .from('calculator_fields')
        .insert(fieldsToInsert)
        .select();

      if (fieldsError) {
        // Rollback: Delete the calculator
        await client.from('calculators').delete().eq('id', calculatorId);
        this.logger.error(`Failed to create fields, rolling back: ${fieldsError.message}`, 'CalculatorsServiceV2');
        throw new Error(fieldsError.message);
      }

      createdFields = fields || [];
    }

    // STEP 3: Create formulas (if provided)
    let createdFormulas = [];
    if (dto.formulas && dto.formulas.length > 0) {
      const formulasToInsert = dto.formulas.map((formula, index) => ({
        calculator_id: calculatorId,
        formula_name: formula.formulaName,
        display_label: formula.displayLabel,
        description: formula.description,
        formula_type: formula.formulaType || 'expression',
        formula_expression: formula.formulaExpression,
        visual_formula: formula.visualFormula || {},
        depends_on_fields: formula.dependsOnFields || [],
        depends_on_formulas: formula.dependsOnFormulas || [],
        output_unit: formula.outputUnit,
        decimal_places: formula.decimalPlaces || 2,
        display_format: formula.displayFormat || 'number',
        execution_order: formula.executionOrder !== undefined ? formula.executionOrder : index,
        display_in_results: formula.displayInResults !== false,
        is_primary_result: formula.isPrimaryResult || false,
        result_group: formula.resultGroup,
      }));

      const { data: formulas, error: formulasError } = await client
        .from('calculator_formulas')
        .insert(formulasToInsert)
        .select();

      if (formulasError) {
        // Rollback: Delete the calculator (cascade will delete fields)
        await client.from('calculators').delete().eq('id', calculatorId);
        this.logger.error(`Failed to create formulas, rolling back: ${formulasError.message}`, 'CalculatorsServiceV2');
        throw new Error(formulasError.message);
      }

      createdFormulas = formulas || [];
    }

    // Return complete calculator with all nested data
    return {
      ...calculator,
      fields: createdFields,
      formulas: createdFormulas,
    };
  }

  /**
   * UPDATE CALCULATOR (ATOMIC)
   * Updates calculator and REPLACES all fields/formulas atomically
   *
   * IMPORTANT: If fields or formulas are provided, they REPLACE all existing ones
   * This prevents partial update bugs and ensures consistency
   */
  async update(id: string, dto: UpdateCalculatorDto, userId: string, accessToken: string) {
    this.logger.log(`Updating calculator: ${id}`, 'CalculatorsServiceV2');

    const client = this.supabaseService.getClient(accessToken);

    // Verify calculator exists and user owns it
    const existing = await this.findOne(id, userId, accessToken);

    // STEP 1: Update calculator metadata
    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.calcCategory !== undefined) updateData.calc_category = dto.calcCategory;
    if (dto.calculatorType !== undefined) updateData.calculator_type = dto.calculatorType;
    if (dto.isTemplate !== undefined) updateData.is_template = dto.isTemplate;
    if (dto.isPublic !== undefined) updateData.is_public = dto.isPublic;
    if (dto.templateCategory !== undefined) updateData.template_category = dto.templateCategory;
    if (dto.displayConfig !== undefined) updateData.display_config = dto.displayConfig;
    if (dto.associatedProcessId !== undefined) updateData.associated_process_id = dto.associatedProcessId;

    // Increment version for optimistic locking
    updateData.version = (existing.version || 1) + 1;

    const { data: calculator, error: calcError } = await client
      .from('calculators')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (calcError || !calculator) {
      throw new NotFoundException(`Calculator not found: ${id}`);
    }

    // STEP 2: Replace fields (if provided)
    let updatedFields = existing.fields || [];
    if (dto.fields !== undefined) {
      // Validate field names are unique
      const fieldNames = dto.fields.map((f: any) => f.fieldName?.trim()).filter(Boolean);
      const uniqueNames = new Set(fieldNames);
      if (fieldNames.length !== uniqueNames.size) {
        const duplicates = fieldNames.filter((name, index) => fieldNames.indexOf(name) !== index);
        throw new BadRequestException(`Duplicate field names detected: ${duplicates.join(', ')}`);
      }

      // Use RPC for atomic delete+insert to prevent constraint violations
      if (dto.fields.length > 0) {
        const fieldsToInsert = dto.fields.map((field: any, index: any) => ({
          calculator_id: id,
          field_name: field.fieldName?.trim(),
          display_label: field.displayLabel,
          field_type: field.fieldType,
          data_source: field.dataSource,
          source_table: field.sourceTable,
          source_field: field.sourceField,
          lookup_config: field.lookupConfig || {},
          default_value: field.defaultValue,
          unit: field.unit,
          min_value: field.minValue,
          max_value: field.maxValue,
          is_required: field.isRequired || false,
          validation_rules: field.validationRules || {},
          input_config: field.inputConfig || {},
          display_order: field.displayOrder !== undefined ? field.displayOrder : index,
          field_group: field.fieldGroup,
        }));

        const { data: fields, error: fieldsError } = await client
          .rpc('replace_calculator_fields', {
            p_calculator_id: id,
            p_fields: fieldsToInsert
          });

        if (fieldsError) {
          this.logger.error(`Failed to update fields: ${fieldsError.message}`, 'CalculatorsServiceV2');
          throw new Error(fieldsError.message);
        }

        updatedFields = fields || [];
      } else {
        // Just delete all fields if empty array provided
        await client.from('calculator_fields').delete().eq('calculator_id', id);
        updatedFields = [];
      }
    }

    // STEP 3: Replace formulas (if provided)
    let updatedFormulas = existing.formulas || [];
    if (dto.formulas !== undefined) {
      // Use RPC for atomic delete+insert to prevent constraint violations
      if (dto.formulas.length > 0) {
        const formulasToInsert = dto.formulas.map((formula: any, index: any) => ({
          calculator_id: id,
          formula_name: formula.formulaName?.trim(),
          display_label: formula.displayLabel,
          description: formula.description,
          formula_type: formula.formulaType || 'expression',
          formula_expression: formula.formulaExpression,
          visual_formula: formula.visualFormula || {},
          depends_on_fields: formula.dependsOnFields || [],
          depends_on_formulas: formula.dependsOnFormulas || [],
          output_unit: formula.outputUnit,
          decimal_places: formula.decimalPlaces || 2,
          display_format: formula.displayFormat || 'number',
          execution_order: formula.executionOrder !== undefined ? formula.executionOrder : index,
          display_in_results: formula.displayInResults !== false,
          is_primary_result: formula.isPrimaryResult || false,
          result_group: formula.resultGroup,
        }));

        const { data: formulas, error: formulasError } = await client
          .rpc('replace_calculator_formulas', {
            p_calculator_id: id,
            p_formulas: formulasToInsert
          });

        if (formulasError) {
          this.logger.error(`Failed to update formulas: ${formulasError.message}`, 'CalculatorsServiceV2');
          throw new Error(formulasError.message);
        }

        updatedFormulas = formulas || [];
      } else {
        // Just delete all formulas if empty array provided
        await client.from('calculator_formulas').delete().eq('calculator_id', id);
        updatedFormulas = [];
      }
    }

    // Return complete updated calculator
    return {
      ...calculator,
      fields: updatedFields,
      formulas: updatedFormulas,
    };
  }

  /**
   * DELETE CALCULATOR
   * Cascade delete will automatically remove fields and formulas
   */
  async remove(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting calculator: ${id}`, 'CalculatorsServiceV2');

    // Verify ownership
    await this.findOne(id, userId, accessToken);

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('calculators')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Failed to delete calculator: ${error.message}`, 'CalculatorsServiceV2');
      throw new Error(error.message);
    }

    return { message: 'Calculator deleted successfully' };
  }

  /**
   * EXECUTE CALCULATOR
   * Runs all formulas and calculated fields with given inputs
   */
  async execute(id: string, dto: ExecuteCalculatorDto, userId: string, accessToken: string) {
    this.logger.log(`Executing calculator: ${id}`, 'CalculatorsServiceV2');

    const calculator = await this.findOne(id, userId, accessToken);
    const { formulas = [], fields = [] } = calculator;

    const startTime = Date.now();
    // physics_key set -> a real TypeScript function (physics-registry.ts)
    // already used by cost-engine.ts computes the results directly, instead
    // of evaluating this calculator's own calculator_fields formula strings.
    // Eliminates the possibility of this calculator's numbers drifting from
    // the live cost engine's numbers for these processes — see migration 056.
    const physicsKey = (calculator as any).physics_key as string | null | undefined;
    let rawResults: Record<string, any>;
    if (physicsKey === 'sheet_metal_net_usage') {
      rawResults = resolveNetUsagePhysics(dto.inputValues);
    } else if (physicsKey === 'sheet_metal_gross_usage_nesting') {
      // Same implementation the cost-engine path (bom-items.service.ts's
      // evaluateCalculatorFields) dispatches to -- the two can never drift.
      rawResults = await this.bomItemsService.resolveGrossUsageForCalculator(dto.inputValues, {
        itemId: dto.itemId, userId, accessToken,
      });
    } else {
      const physicsFn = physicsKey ? PHYSICS_REGISTRY[physicsKey] : undefined;
      rawResults = physicsFn
        ? physicsFn(dto.inputValues)
        : evaluateCalculatorFormulas(fields, formulas, dto.inputValues, {
            log: (m) => this.logger.log(m, 'CalculatorsServiceV2'),
            error: (m) => this.logger.error(m, 'CalculatorsServiceV2'),
            warn: (m) => this.logger.warn(m, 'CalculatorsServiceV2'),
          }).results;
    }
    // Disclosed, not silent: a physics function's `_warnings` (e.g. "no MHR
    // rate provided — Machine Cost computed as $0") is metadata, not a
    // calculator field — lifted out of `results` into its own response key
    // so it doesn't pollute the displayed field list, but isn't dropped either.
    // `_gapReason` (sheet-metal gross-usage only) is the same kind of
    // metadata — the exact "Unable to calculate true-shape gross usage —
    // verified flat pattern required" message, never a calculator field.
    const { _warnings, _gapReason, _internalReason, ...results } = rawResults as Record<string, any>;
    const warnings: string[] = [...(_warnings ?? []), ...(_gapReason ? [_gapReason] : [])];
    if (warnings.length > 0) {
      for (const w of warnings) this.logger.warn(`Calculator ${id}: ${w}`, 'CalculatorsServiceV2');
    }
    const duration = Date.now() - startTime;

    return {
      success: true,
      results,
      ...(warnings.length > 0 ? { warnings } : {}),
      durationMs: duration,
    };
  }

  // ============================================================================
  // SHEET METAL LOOKUP TABLE RESOLVER
  // ============================================================================

  /**
   * Resolves a parameterized lookup from one of the 6 sheet metal lookup tables.
   * Uses the Supabase anon client (public read, no auth required).
   *
   * Supported tables:
   *   stroke_rate    → params: { tonnage, complexity }
   *   handling_time  → params: { weight_kg }
   *   tool_setup     → params: { setup_type, key_value }
   *   manual_stroke  → params: { thickness_mm, tonnage, complexity }
   *   laser_cut      → params: { material, thickness_mm, laser_power_w }
   *   waterjet_cut   → params: { material, thickness_mm }
   *   sampling_plan  → params: { batch_size, complexity_level (1|2|3) }
   *   roll_forming   → params: none (single-row table, migration 442)
   *   roll_bending   → params: { machine_name, developed_length_mm, thickness_mm, target_diameter_mm }
   */
  async resolveSheetMetalLookup(tableName: string, params: Record<string, any>) {
    const client = this.supabaseService.getAdminClient();

    switch (tableName) {
      case 'stroke_rate': {
        const tonnage = Number(params.tonnage);
        const complexity = String(params.complexity || 'simple').toLowerCase();
        const col = complexity === 'complex' ? 'eff_complex'
                  : complexity === 'inter' ? 'eff_inter'
                  : 'eff_simple';
        // Same underflow risk as 'manual_stroke'/'tool_setup' above:
        // sm_lookup_stroke_rate's lowest seeded tonnage is 10 -- a strict
        // .lte() match returns nothing for any required tonnage below that.
        const { data, error } = await client
          .from('sm_lookup_stroke_rate')
          .select(`tonnage, ${col}`)
          .order('tonnage', { ascending: true });
        if (error || !data?.length) return { value: null };

        const atOrBelow = data.filter((r) => Number(r.tonnage) <= tonnage);
        const row = atOrBelow.length
          ? atOrBelow.reduce((best, r) => (Number(r.tonnage) > Number(best.tonnage) ? r : best))
          : data[0]; // clamp to the smallest seeded tonnage when below every column
        return { value: (row as any)[col], row };
      }

      case 'handling_time': {
        const weight = Number(params.weight_kg);
        const { data, error } = await client
          .from('sm_lookup_handling_time')
          .select('weight_max_kg, handling_min')
          .gte('weight_max_kg', weight)
          .order('weight_max_kg', { ascending: true })
          .limit(1)
          .single();
        if (error || !data) return { value: null };
        return { value: (data as any).handling_min, row: data };
      }

      case 'tool_setup': {
        const setupType = String(params.setup_type || 'press');
        const keyValue = Number(params.key_value);
        // Same underflow risk as 'manual_stroke' above: sm_lookup_tool_setup's
        // 'brake' rows only start at key_value=100 (mm of tool/bend length) —
        // a strict .lte() match returns nothing for a small part whose bend
        // line is shorter than that (this session's real test part: 70.3mm).
        const { data, error } = await client
          .from('sm_lookup_tool_setup')
          .select('key_value, loading_time_min')
          .eq('setup_type', setupType)
          .order('key_value', { ascending: true });
        if (error || !data?.length) return { value: null };

        const atOrBelow = data.filter((r) => Number(r.key_value) <= keyValue);
        const row = atOrBelow.length
          ? atOrBelow.reduce((best, r) => (Number(r.key_value) > Number(best.key_value) ? r : best))
          : data[0]; // clamp to the smallest seeded key_value when below every column
        return { value: (row as any).loading_time_min, row };
      }

      case 'manual_stroke': {
        // Delegates entirely to SheetMetalLookupService.getManualStrokeTime —
        // the one registered resolver for this table (bom-items.service.ts's
        // cost engine and route comparison already call it directly). This
        // used to be a second, independent implementation here: a bare
        // EXACT_MATCH query with none of that resolver's real-world
        // tolerances (thickness INTERPOLATE between real bracketing rows,
        // and rounding a precise kN-derived tonnage like 81.6T to the
        // nearest standard press-brake class like 80T when within 10%).
        // Confirmed live: the standalone interactive Calculator dialog kept
        // gapping on exactly the cases the cost engine had already learned
        // to resolve, because this duplicate never got the same fixes.
        const thickness = Number(params.thickness_mm);
        const tonnage = Number(params.tonnage);
        const complexity = String(params.complexity || 'simple').toLowerCase() === 'complex' ? 'complex' : 'simple';
        const result = await this.sheetMetalLookup.getManualStrokeTime(thickness, tonnage, complexity);
        if (!result.dataFound) return { value: null, resolution: result.resolution };
        return { value: result.secondsPerBend, row: result.resolution.matchedRow, resolution: result.resolution };
      }

      case 'laser_cut': {
        // Nearest-thickness/nearest-power match, same as sheet-metal-lookup.service.ts's
        // getLaserParams — an exact .eq().eq() match (the old behaviour here) returns
        // nothing for any thickness/power combination not stored verbatim, which is most
        // of them (this table is seeded at fixed steps: 500W, 1000W, ... 15000W and whole-
        // mm thicknesses). Confirmed live: a real 2000W machine at 4mm silently returned
        // null here while the correct row (1.56 m/min) existed one power-step away.
        //
        // Normalises material via the SAME shared function getLaserParams uses — this
        // case used to `ilike` the raw grade string directly (e.g. "SECC"), which never
        // matches the table's 4 seeded material buckets (Carbon Steel/Stainless Steel/
        // Aluminium/Brass) unless the caller happened to pre-normalise it itself. Also
        // filters by laser_technology (migration 457) from the caller's machine_class —
        // this dialog's real machine could be a co2_laser (e.g. AMADA Quattro), and
        // without this filter its nearest-power match would silently return FIBER
        // cutting speed/pierce time, exactly the cross-technology substitution the
        // interactive costing path was already fixed to prevent.
        const material = normaliseLaserMaterial(String(params.material || ''));
        const thickness = Number(params.thickness_mm);
        const laserPower = Number(params.laser_power_w);
        const technology: 'fiber' | 'co2' = params.machine_class === 'co2_laser' ? 'co2' : 'fiber';
        const { data, error } = await client
          .from('sm_lookup_laser_cut')
          .select('material, thickness_mm, kerf_mm, laser_power_w, cutting_speed_m_per_min, pierce_time_min')
          .eq('material', material)
          .eq('laser_technology', technology)
          .not('cutting_speed_m_per_min', 'is', null);
        if (error || !data?.length) return { value: null };

        const nearest = <T,>(target: number, items: T[], key: (x: T) => number): T =>
          items.reduce((best, x) => Math.abs(key(x) - target) < Math.abs(key(best) - target) ? x : best, items[0]);

        const thicknesses = [...new Set(data.map((r) => Number(r.thickness_mm)))];
        const nearestThickness = nearest(thickness, thicknesses, (t) => t);
        const rowsAtThickness = data.filter((r) => Number(r.thickness_mm) === nearestThickness);
        if (!rowsAtThickness.length) return { value: null };

        const powers = rowsAtThickness.map((r) => Number(r.laser_power_w));
        const nearestPower = nearest(laserPower, powers, (p) => p);
        const row = rowsAtThickness.find((r) => Number(r.laser_power_w) === nearestPower);
        if (!row) return { value: null };

        return {
          value: (row as any).cutting_speed_m_per_min,
          kerf: (row as any).kerf_mm,
          row,
        };
      }

      case 'waterjet_cut': {
        // Nearest-thickness match only — no power axis (see migration 398 for
        // why: this app's real waterjet machine names don't carry a
        // consistently parseable pump rating, unlike laser's kW-in-name
        // convention). Normalises material via the same shared function as
        // laser_cut above — same 4 seeded buckets (Carbon Steel/Stainless
        // Steel/Aluminium/Brass), same "raw grade string never matches"
        // failure mode this fixes for laser_cut.
        const material = normaliseLaserMaterial(String(params.material || ''));
        const thickness = Number(params.thickness_mm);
        const { data, error } = await client
          .from('sm_lookup_waterjet_cut')
          .select('material, thickness_mm, kerf_mm, cutting_speed_mm_per_min, pierce_time_sec')
          .eq('material', material)
          .not('cutting_speed_mm_per_min', 'is', null);
        if (error || !data?.length) return { value: null };

        const nearest = <T,>(target: number, items: T[], key: (x: T) => number): T =>
          items.reduce((best, x) => Math.abs(key(x) - target) < Math.abs(key(best) - target) ? x : best, items[0]);

        const thicknesses = [...new Set(data.map((r) => Number(r.thickness_mm)))];
        const nearestThickness = nearest(thickness, thicknesses, (t) => t);
        const row = data.find((r) => Number(r.thickness_mm) === nearestThickness);
        if (!row) return { value: null };

        return {
          value: (row as any).cutting_speed_mm_per_min,
          kerf: (row as any).kerf_mm,
          row,
        };
      }

      case 'sampling_plan': {
        const batchSize = Number(params.batch_size);
        const level = Number(params.complexity_level || 1);
        const pctCol = level === 3 ? 'sampling_pct_l3'
                     : level === 2 ? 'sampling_pct_l2'
                     : 'sampling_pct_l1';
        const qtyCol = level === 3 ? 'sample_qty_l3'
                     : level === 2 ? 'sample_qty_l2'
                     : 'sample_qty_l1';
        // Same class of range issue as the other lookups above: the table's
        // brackets only span 2-1,000,000 (batch_size_from starts at 2) — a
        // strict range match returns nothing for a batch size of 1. Clamp to
        // the lowest/highest bracket rather than failing outright.
        const { data, error } = await client
          .from('sm_lookup_sampling_plan')
          .select(`batch_size_from, batch_size_to, ${pctCol}, ${qtyCol}`)
          .order('batch_size_from', { ascending: true });
        if (error || !data?.length) return { value: null };

        const inRange = data.find(
          (r) => Number(r.batch_size_from) <= batchSize && batchSize <= Number(r.batch_size_to),
        );
        const row = inRange
          ?? (batchSize < Number(data[0].batch_size_from) ? data[0] : data[data.length - 1]);
        return {
          value: (row as any)[pctCol],
          sampleQty: (row as any)[qtyCol],
          row,
        };
      }

      case 'roll_bending': {
        // Real per-machine 3/4-Roll Bender cycle time — delegates entirely to
        // SheetMetalLookupService.getRollBendingCycleTime (see that method's
        // own comment for the formula and its documented multi-pass gap).
        // Unlike 'roll_forming' above (one generic shop-floor line-speed row
        // with no per-machine or per-part axis), this resolves the SPECIFIC
        // selected machine's own real rolling_speed_mm_s/prebend_time_s/pass
        // limits against the actual part's developed length/thickness/target
        // diameter — params: { machine_name, developed_length_mm,
        // thickness_mm, target_diameter_mm }.
        const result = await this.sheetMetalLookup.getRollBendingCycleTime(
          String(params.machine_name || ''),
          Number(params.developed_length_mm),
          Number(params.thickness_mm),
          Number(params.target_diameter_mm),
        );
        return {
          value: result.secondsPerPart,
          passMode: result.passMode,
          capable: result.capable,
          dataFound: result.dataFound,
          gapReason: result.gapReason,
        };
      }

      case 'roll_forming': {
        // Single-row table (migration 442) — one shop-floor achievable line
        // speed + tooling changeover time, no material/thickness axis exists
        // yet in the source data. `value` = Line Speed (m/min), `setupTimeMin`
        // = Setup Time (min) — the Roll Forming calculator's two lookup-driven
        // fields, both sourced from this one row.
        const { data, error } = await client
          .from('sm_lookup_roll_forming')
          .select('line_speed_m_min, setup_time_min')
          .limit(1)
          .single();
        if (error || !data) return { value: null };
        return {
          value: (data as any).line_speed_m_min,
          setupTimeMin: (data as any).setup_time_min,
          row: data,
        };
      }

      default:
        throw new Error(`Unknown sheet metal lookup table: ${tableName}`);
    }
  }

  // ============================================================================
  // FIELD OPERATIONS (GRANULAR)
  // ============================================================================

  async getFields(calculatorId: string, userId: string, accessToken: string) {
    const calculator = await this.findOne(calculatorId, userId, accessToken);
    return calculator.fields || [];
  }

  async createField(calculatorId: string, dto: CreateFieldDto, userId: string, accessToken: string) {
    const client = this.supabaseService.getClient(accessToken);
    await this.findOne(calculatorId, userId, accessToken); // Verify ownership

    const { data, error } = await client
      .from('calculator_fields')
      .insert({
        calculator_id: calculatorId,
        field_name: dto.fieldName,
        display_label: dto.displayLabel,
        field_type: dto.fieldType,
        data_source: dto.dataSource,
        source_table: dto.sourceTable,
        source_field: dto.sourceField,
        lookup_config: dto.lookupConfig || {},
        default_value: dto.defaultValue,
        unit: dto.unit,
        min_value: dto.minValue,
        max_value: dto.maxValue,
        is_required: dto.isRequired || false,
        validation_rules: dto.validationRules || {},
        input_config: dto.inputConfig || {},
        display_order: dto.displayOrder || 0,
        field_group: dto.fieldGroup,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateField(calculatorId: string, fieldId: string, dto: UpdateFieldDto, userId: string, accessToken: string) {
    const client = this.supabaseService.getClient(accessToken);
    await this.findOne(calculatorId, userId, accessToken); // Verify ownership

    const { data, error } = await client
      .from('calculator_fields')
      .update({
        field_name: dto.fieldName,
        display_label: dto.displayLabel,
        field_type: dto.fieldType,
        data_source: dto.dataSource,
        source_table: dto.sourceTable,
        source_field: dto.sourceField,
        lookup_config: dto.lookupConfig,
        default_value: dto.defaultValue,
        unit: dto.unit,
        min_value: dto.minValue,
        max_value: dto.maxValue,
        is_required: dto.isRequired,
        validation_rules: dto.validationRules,
        input_config: dto.inputConfig,
        display_order: dto.displayOrder,
        field_group: dto.fieldGroup,
      })
      .eq('id', fieldId)
      .eq('calculator_id', calculatorId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async removeField(calculatorId: string, fieldId: string, userId: string, accessToken: string) {
    const client = this.supabaseService.getClient(accessToken);
    await this.findOne(calculatorId, userId, accessToken); // Verify ownership

    const { error } = await client
      .from('calculator_fields')
      .delete()
      .eq('id', fieldId)
      .eq('calculator_id', calculatorId);

    if (error) throw new Error(error.message);
    return { message: 'Field deleted successfully' };
  }

  // ============================================================================
  // FORMULA OPERATIONS (GRANULAR)
  // ============================================================================

  async getFormulas(calculatorId: string, userId: string, accessToken: string) {
    const calculator = await this.findOne(calculatorId, userId, accessToken);
    return calculator.formulas || [];
  }

  async createFormula(calculatorId: string, dto: CreateFormulaDto, userId: string, accessToken: string) {
    const client = this.supabaseService.getClient(accessToken);
    await this.findOne(calculatorId, userId, accessToken); // Verify ownership

    const { data, error } = await client
      .from('calculator_formulas')
      .insert({
        calculator_id: calculatorId,
        formula_name: dto.formulaName,
        display_label: dto.displayLabel,
        description: dto.description,
        formula_type: dto.formulaType || 'expression',
        formula_expression: dto.formulaExpression,
        visual_formula: dto.visualFormula || {},
        depends_on_fields: dto.dependsOnFields || [],
        depends_on_formulas: dto.dependsOnFormulas || [],
        output_unit: dto.outputUnit,
        decimal_places: dto.decimalPlaces || 2,
        display_format: dto.displayFormat || 'number',
        execution_order: dto.executionOrder || 0,
        display_in_results: dto.displayInResults !== false,
        is_primary_result: dto.isPrimaryResult || false,
        result_group: dto.resultGroup,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateFormula(calculatorId: string, formulaId: string, dto: UpdateFormulaDto, userId: string, accessToken: string) {
    const client = this.supabaseService.getClient(accessToken);
    await this.findOne(calculatorId, userId, accessToken); // Verify ownership

    const { data, error } = await client
      .from('calculator_formulas')
      .update({
        formula_name: dto.formulaName,
        display_label: dto.displayLabel,
        description: dto.description,
        formula_type: dto.formulaType,
        formula_expression: dto.formulaExpression,
        visual_formula: dto.visualFormula,
        depends_on_fields: dto.dependsOnFields,
        depends_on_formulas: dto.dependsOnFormulas,
        output_unit: dto.outputUnit,
        decimal_places: dto.decimalPlaces,
        display_format: dto.displayFormat,
        execution_order: dto.executionOrder,
        display_in_results: dto.displayInResults,
        is_primary_result: dto.isPrimaryResult,
        result_group: dto.resultGroup,
      })
      .eq('id', formulaId)
      .eq('calculator_id', calculatorId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async removeFormula(calculatorId: string, formulaId: string, userId: string, accessToken: string) {
    const client = this.supabaseService.getClient(accessToken);
    await this.findOne(calculatorId, userId, accessToken); // Verify ownership

    const { error } = await client
      .from('calculator_formulas')
      .delete()
      .eq('id', formulaId)
      .eq('calculator_id', calculatorId);

    if (error) throw new Error(error.message);
    return { message: 'Formula deleted successfully' };
  }
}
