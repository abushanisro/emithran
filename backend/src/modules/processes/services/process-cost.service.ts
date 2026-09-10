/**
 * Process Cost Service
 *
 * Business logic layer for process cost calculations
 * Integrates the calculation engine with database operations
 *
 * @author Manufacturing Cost Engineering Team
 * @version 1.0.0
 */

import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Logger } from '../../../common/logger/logger.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';
import { getCurrencyForLocation } from '../../mhr/constants/mhr-calculation.constants';
import { PERSISTED_PROCESS_COST_COLUMNS, PersistedProcessCostRow, resolvePersistedProcessCost, sumPersistedProcessCost } from '../../bom-items/costing/shared/core/persisted-process-cost';
import {
  CreateProcessCostDto,
  UpdateProcessCostDto,
  QueryProcessCostsDto,
  ProcessCostResponseDto,
  ProcessCostListResponseDto,
} from '../dto/process-cost.dto';
import {
  ProcessCostCalculationEngine,
  ProcessCostInput,
} from '../engines/process-cost-calculation.engine';

@Injectable()
export class ProcessCostService {
  private readonly calculationEngine: ProcessCostCalculationEngine;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
    private readonly exchangeRateService: ExchangeRateService,
  ) {
    this.calculationEngine = new ProcessCostCalculationEngine();
  }

  /**
   * Get all process cost records with pagination and filtering
   */
  async findAll(
    query: QueryProcessCostsDto,
    userId?: string,
    accessToken?: string,
  ): Promise<ProcessCostListResponseDto> {
    this.logger.log('Fetching all process costs', 'ProcessCostService');

    const page = query.page || 1;
    const limit = Math.min(query.limit || 10, 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('process_cost_records')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    // Apply filters
    if (query.isActive !== undefined) {
      queryBuilder = queryBuilder.eq('is_active', query.isActive);
    }

    // Search removed - description field no longer exists

    if (query.processId) {
      queryBuilder = queryBuilder.eq('process_id', query.processId);
    }

    if (query.bomItemId) {
      queryBuilder = queryBuilder.eq('bom_item_id', query.bomItemId);
    }

    // Handle multiple BOM item IDs
    if (query.bomItemIds && query.bomItemIds.length > 0) {
      queryBuilder = queryBuilder.in('bom_item_id', query.bomItemIds);
    }

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching process costs: ${error.message}`, 'ProcessCostService');

      if (error.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access these process cost records.');
      }
      if (error.message.includes('invalid input syntax for type uuid')) {
        throw new BadRequestException('One or more filter values have invalid format. Please check your process ID, BOM item ID filters.');
      }
      throw new InternalServerErrorException('Unable to retrieve process cost records. Please try again later.');
    }

    // Back-fill process hierarchy for old AI-applied records that stored only process_id
    const rows = data || [];
    const missingIds = [...new Set(
      rows.filter(r => (!r.process_group || !r.operation) && r.process_id).map(r => String(r.process_id))
    )];
    const processMap = new Map<string, { process_name: string; process_category: string }>();
    if (missingIds.length > 0) {
      // Note: machine_type column is optional — only select guaranteed columns
      const { data: procs } = await this.supabaseService
        .getClient(accessToken)
        .from('processes')
        .select('id, process_name, process_category')
        .in('id', missingIds);
      (procs || []).forEach(p => processMap.set(String(p.id), p));
    }
    const enriched = rows.map(r => {
      if ((!r.process_group || !r.operation) && r.process_id) {
        const p = processMap.get(String(r.process_id));
        if (p) return {
          ...r,
          process_group: r.process_group || p.process_category,
          operation: r.operation || p.process_name,
        };
      }
      return r;
    });

    const records = enriched.map((row) => ProcessCostResponseDto.fromDatabase(row));
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
   * Get a single process cost record by ID
   * Recalculates on fetch to ensure accuracy
   */
  async findOne(id: string, userId: string, accessToken: string): Promise<ProcessCostResponseDto> {
    this.logger.log(`Fetching process cost: ${id}`, 'ProcessCostService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_cost_records')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      this.logger.error(`Error fetching process cost ${id}: ${error.message}`, 'ProcessCostService');
      
      if (error.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access this process cost record.');
      }
      
      if (error.message.includes('invalid input syntax for type uuid')) {
        throw new BadRequestException('Invalid process cost ID format provided.');
      }
      
      throw new InternalServerErrorException('Unable to retrieve process cost record. Please try again later.');
    }
    
    if (!data) {
      this.logger.error(`Process cost not found: ${id}`, 'ProcessCostService');
      throw new NotFoundException(`Process cost record with ID ${id} was not found or you do not have access to it.`);
    }

    // Back-fill process hierarchy from master if missing
    let row = data;
    if ((!row.process_group || !row.operation) && row.process_id) {
      const { data: proc } = await this.supabaseService
        .getClient(accessToken)
        .from('processes')
        .select('process_name, process_category')
        .eq('id', String(row.process_id))
        .single();
      if (proc) row = {
        ...row,
        process_group: row.process_group || proc.process_category,
        operation: row.operation || proc.process_name,
      };
    }

    // Recalculate to ensure fresh values
    const recalculatedData = this.recalculateRecord(row);

    return ProcessCostResponseDto.fromDatabase(recalculatedData);
  }

  /**
   * Resolve machine_name/machine_class for a process cost record. Single source
   * of truth for these two denormalized columns — create() and update() both
   * funnel through here so the values can never drift from whatever machine was
   * actually selected.
   *
   * Two valid sources, checked in order:
   *   1. mhrId → a real mhr_records row (the common case).
   *   2. benchmarkMhrId → a mhr_benchmark_rates row. Benchmark rates are shown in
   *      the dialog (marked ★) whenever the user has no custom MHR data for a
   *      machine class; their id is a bigint, never a UUID, so it can never be
   *      sent as mhrId (that column FKs to mhr_records). Without this fallback,
   *      picking a benchmark machine would silently store machine_name = null —
   *      the record would look "not linked to a machine" even though a specific,
   *      real (benchmark) machine was chosen.
   *
   * Neither given → both null (a genuine flat manual-rate entry, not an error).
   */
  private async deriveMachineFields(
    mhrId: string | null | undefined,
    benchmarkMhrId: string | number | null | undefined,
    accessToken: string,
  ): Promise<{ machine_name: string | null; machine_class: string | null }> {
    if (mhrId) {
      const { data, error } = await this.supabaseService
        .getClient(accessToken)
        .from('mhr_records')
        .select('machine_name, machine_class')
        .eq('id', mhrId)
        .maybeSingle();

      if (error || !data) {
        if (error) {
          this.logger.error(
            `Error resolving MHR ${mhrId} for machine_name/machine_class derivation: ${error.message}`,
            'ProcessCostService',
          );
        }
        throw new BadRequestException('The specified MHR record does not exist or is not accessible.');
      }

      return {
        machine_name: data.machine_name ?? null,
        machine_class: data.machine_class ?? null,
      };
    }

    if (benchmarkMhrId) {
      // mhr.service.ts#getBenchmarkRates() (the endpoint that populates the
      // dialog's dropdown) prefixes every benchmark row's raw bigint id with
      // 'bm-mhr-' before it ever reaches the frontend, so a selected benchmark
      // machine's id always looks like 'bm-mhr-42', never the bare '42' that
      // mhr_benchmark_rates.id (BIGSERIAL) actually stores. Strip the prefix
      // before querying — matching against the raw string would never find a
      // row, for any id, regardless of RLS or anything else.
      const rawId = String(benchmarkMhrId).replace(/^bm-mhr-/, '');

      // This table is explicitly documented as global/shared with no user_id
      // column (see migration 345) — getBenchmarkRates() itself reads it via
      // the admin client for that reason. Use the same client here so a
      // benchmark lookup can't fail due to RLS having no policy for a table
      // that was never meant to be user-scoped in the first place.
      const { data, error } = await this.supabaseService
        .getAdminClient()
        .from('mhr_benchmark_rates')
        .select('machine_name, machine_class')
        .eq('id', rawId)
        .maybeSingle();

      if (error || !data) {
        if (error) {
          this.logger.error(
            `Error resolving benchmark MHR ${benchmarkMhrId} (raw id ${rawId}) for machine_name/machine_class derivation: ${error.message}`,
            'ProcessCostService',
          );
        }
        throw new BadRequestException('The specified benchmark machine rate does not exist or is not accessible.');
      }

      return {
        machine_name: data.machine_name ?? null,
        machine_class: data.machine_class ?? null,
      };
    }

    return { machine_name: null, machine_class: null };
  }

  /**
   * Resolve labor_type for a process cost record — the labour-side counterpart
   * of deriveMachineFields(), same reasoning: single source of truth, derived
   * server-side from whichever labour record was actually selected, never
   * trusted from the client and never left to silently stay null.
   *
   * Two valid sources, checked in order:
   *   1. lhrId → a real lhr_records row.
   *   2. benchmarkLhrId → a lhr_benchmark_rates row (★ in the dialog, shown when
   *      the user has no custom LHR data for a process group). Its id is a
   *      bigint prefixed 'bm-lhr-' by lhr.service.ts#getBenchmarkRates() before
   *      it reaches the frontend — strip the prefix before querying, same as
   *      the MHR benchmark case.
   *
   *   3. mhrId → the selected machine's OWN labour classification. Edit
   *      Process Cost no longer offers an independent labour picker: a
   *      machine's labour rate is mhr_records.usd_lhr_total on its own row,
   *      and resolveMHRRates() already treats that specific rate as
   *      authoritative over a generic (location, process_group) wage-grade
   *      lookup. Without this source every line saved that way would report
   *      no labour identity at all, even though the rate charged is a real,
   *      attributable value — so the identity is read from the same row the
   *      rate came from: its wage_grade, which is the labour classification
   *      HR Rates itself assigns the machine.
   *
   * None given → null (a genuine flat manual-rate entry, not an error).
   */
  private async deriveLaborFields(
    lhrId: string | null | undefined,
    benchmarkLhrId: string | number | null | undefined,
    accessToken: string,
    mhrId?: string | null | undefined,
  ): Promise<{ labor_type: string | null }> {
    if (lhrId) {
      const { data, error } = await this.supabaseService
        .getClient(accessToken)
        .from('lhr_records')
        .select('labour_type')
        .eq('id', lhrId)
        .maybeSingle();

      if (error || !data) {
        if (error) {
          this.logger.error(
            `Error resolving LHR ${lhrId} for labor_type derivation: ${error.message}`,
            'ProcessCostService',
          );
        }
        throw new BadRequestException('The specified LHR record does not exist or is not accessible.');
      }

      return { labor_type: data.labour_type ?? null };
    }

    if (benchmarkLhrId) {
      const rawId = String(benchmarkLhrId).replace(/^bm-lhr-/, '');

      // lhr_benchmark_rates is global/shared with no user_id column (migration
      // 361) — getBenchmarkRates() reads it via the admin client for that
      // reason; do the same here so this lookup can't fail due to RLS having
      // no policy for a table that was never meant to be user-scoped.
      const { data, error } = await this.supabaseService
        .getAdminClient()
        .from('lhr_benchmark_rates')
        .select('labour_type')
        .eq('id', rawId)
        .maybeSingle();

      if (error || !data) {
        if (error) {
          this.logger.error(
            `Error resolving benchmark LHR ${benchmarkLhrId} (raw id ${rawId}) for labor_type derivation: ${error.message}`,
            'ProcessCostService',
          );
        }
        throw new BadRequestException('The specified benchmark LHR rate does not exist or is not accessible.');
      }

      return { labor_type: data.labour_type ?? null };
    }

    if (mhrId) {
      const { data, error } = await this.supabaseService
        .getClient(accessToken)
        .from('mhr_records')
        .select('wage_grade, machine_name, usd_lhr_total')
        .eq('id', mhrId)
        .maybeSingle();

      // Deliberately NOT a BadRequestException like the two branches above.
      // Those are explicit user selections, so an unresolvable id is a real
      // error; this is a derivation from a machine that deriveMachineFields
      // has already validated, and the labour IDENTITY is a label, not the
      // rate. Failing the whole save over a missing label would be worse than
      // recording the rate with no name attached.
      if (error) {
        this.logger.error(
          `Error resolving MHR ${mhrId} for labor_type derivation: ${error.message}`,
          'ProcessCostService',
        );
        return { labor_type: null };
      }
      if (!data) return { labor_type: null };

      // Only claim a machine-derived labour identity when that machine really
      // has a labour rate of its own; otherwise the rate on this line came from
      // a manual entry and naming the machine would misattribute it.
      if (!(Number(data.usd_lhr_total) > 0)) return { labor_type: null };

      return {
        labor_type: data.wage_grade
          ? `${data.wage_grade} (${data.machine_name ?? 'machine rate'})`
          : `Machine rate (${data.machine_name ?? mhrId})`,
      };
    }

    return { labor_type: null };
  }

  /**
   * Create a new process cost record with calculation
   */
  async create(
    createDto: CreateProcessCostDto,
    userId: string,
    accessToken: string,
    organizationId?: string,
  ): Promise<ProcessCostResponseDto> {
    this.logger.log('Creating process cost record', 'ProcessCostService');

    // Every rate/value field here arrives in createDto.location's local currency
    // (the frontend edits/displays in local currency) but process_cost_records
    // always stores USD — convert once, here, via the real exchange_rates table,
    // instead of trusting the caller's `currency` label with no actual
    // conversion (previously: any non-USA location silently stored wrong-
    // magnitude numbers mislabeled 'USD'). No location on the DTO defaults to
    // 'USD' (a no-op conversion), matching this service's existing currency default.
    const rates = await this.exchangeRateService.getSnapshot(accessToken);
    const { currency: createLocalCurrency } = getCurrencyForLocation(createDto.location ?? '');
    const toUsdCreate = (v: number | undefined): number | undefined => v != null ? rates.toUsd(v, createLocalCurrency) : v;

    // Prepare input for calculation engine
    const calculationInput: ProcessCostInput = {
      opNbr: createDto.opNbr,
      directRate: toUsdCreate(createDto.directRate)!,
      indirectRate: toUsdCreate(createDto.indirectRate),
      fringeRate: toUsdCreate(createDto.fringeRate),
      machineRate: toUsdCreate(createDto.machineRate),
      machineValue: toUsdCreate(createDto.machineValue),
      currency: 'USD',
      shiftPatternHoursPerDay: createDto.shiftPatternHoursPerDay,
      setupManning: createDto.setupManning,
      setupTime: createDto.setupTime,
      batchSize: createDto.batchSize,
      heads: createDto.heads,
      cycleTime: createDto.cycleTime,
      partsPerCycle: createDto.partsPerCycle,
      scrap: createDto.scrap,
      facilityId: createDto.facilityId,
      facilityRateId: createDto.facilityRateId,
      shiftPatternId: createDto.shiftPatternId,
    };

    // Calculate costs
    let calculationResult: ReturnType<typeof this.calculationEngine.calculate>;
    try {
      calculationResult = this.calculationEngine.calculate(calculationInput);
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Invalid process cost input');
    }

    const machineFields = await this.deriveMachineFields(createDto.mhrId, createDto.benchmarkMhrId, accessToken);
    const laborFields = await this.deriveLaborFields(
      createDto.lhrId,
      createDto.benchmarkLhrId,
      accessToken,
      createDto.mhrId,
    );

    // Prepare database record
    const recordData = {
      // Input parameters
      op_nbr: createDto.opNbr || 0,
      process_group: createDto.processGroup,
      process_route: createDto.processRoute,
      operation: createDto.operation,
      // Real HR Rates machine category (migration 719). NULL on engine-generated
      // lines, which identify themselves through `operation` instead.
      category: createDto.category ?? null,
      location: createDto.location ?? null,
      mhr_id: createDto.mhrId,
      benchmark_mhr_id: createDto.benchmarkMhrId ?? null,
      machine_name: machineFields.machine_name,
      machine_class: machineFields.machine_class,
      lhr_id: createDto.lhrId,
      benchmark_lhr_id: createDto.benchmarkLhrId ?? null,
      labor_type: laborFields.labor_type,
      facility_category_id: createDto.facilityCategoryId,
      facility_type_id: createDto.facilityTypeId,
      supplier_id: createDto.supplierId,
      supplier_location_id: createDto.supplierLocationId,
      facility_id: createDto.facilityId,
      facility_rate_id: createDto.facilityRateId,
      direct_rate: toUsdCreate(createDto.directRate) ?? 0,
      indirect_rate: toUsdCreate(createDto.indirectRate) || 0,
      fringe_rate: toUsdCreate(createDto.fringeRate) || 0,
      machine_rate: toUsdCreate(createDto.machineRate) || 0,
      machine_value: toUsdCreate(createDto.machineValue) || 0,
      labor_rate: toUsdCreate(createDto.laborRate) || 0,
      currency: 'USD',
      shift_pattern_id: createDto.shiftPatternId,
      shift_pattern_hours_per_day: createDto.shiftPatternHoursPerDay,
      setup_manning: createDto.setupManning,
      setup_time: createDto.setupTime,
      batch_size: createDto.batchSize,
      heads: createDto.heads,
      cycle_time: createDto.cycleTime,
      parts_per_cycle: createDto.partsPerCycle,
      scrap: createDto.scrap,

      // Calculated results
      total_cost_per_part: calculationResult.totalCostPerPart,
      setup_cost_per_part: calculationResult.setupCostPerPart,
      total_cycle_cost_per_part: calculationResult.totalCycleCostPerPart,
      total_cost_before_scrap: calculationResult.totalCostBeforeScrap,
      scrap_adjustment: calculationResult.scrapAdjustment,
      total_batch_cost: calculationResult.totalBatchCost,
      calculation_breakdown: calculationResult,

      // Metadata
      is_active: createDto.isActive !== false,
      notes: createDto.notes,
      user_id: userId,
      organization_id: organizationId ?? null,

      // Links
      process_id: createDto.processId,
      process_route_id: createDto.processRouteId,
      bom_item_id: createDto.bomItemId,
    };

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_cost_records')
      .insert(recordData)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Error creating process cost: ${error?.message}`, 'ProcessCostService');
      
      if (error) {
        // Handle duplicate constraint
        if (error.message.includes('duplicate key')) {
          throw new ConflictException(
            'A process cost record with this configuration already exists. Please modify your input or update the existing record.'
          );
        }
        
        // Handle foreign key constraints
        if (error.message.includes('violates foreign key constraint')) {
          if (error.message.includes('process_id')) {
            throw new BadRequestException('The specified process does not exist or you do not have access to it.');
          }
          if (error.message.includes('bom_item_id')) {
            throw new BadRequestException('The specified BOM item does not exist or has been deleted.');
          }
          if (error.message.includes('mhr_id')) {
            throw new BadRequestException('The specified MHR record does not exist or is not accessible.');
          }
          if (error.message.includes('user_id')) {
            throw new BadRequestException('User account is not valid. Please log in again.');
          }
        }
        
        // Handle validation constraints
        if (error.message.includes('violates check constraint')) {
          if (error.message.includes('positive_rates')) {
            throw new BadRequestException('All rate values must be positive numbers.');
          }
          if (error.message.includes('positive_values')) {
            throw new BadRequestException('Time, quantity, and cost values must be positive numbers.');
          }
          if (error.message.includes('cycle_time_positive')) {
            throw new BadRequestException('Cycle time must be greater than zero.');
          }
          if (error.message.includes('batch_size_positive')) {
            throw new BadRequestException('Batch size must be greater than zero.');
          }
        }
      }
      
      throw new InternalServerErrorException(`Failed to create process cost record: ${error?.message || 'Unknown database error'}`);
    }

    return ProcessCostResponseDto.fromDatabase(data);
  }

  /**
   * Update an existing process cost record
   * Recalculates automatically when relevant fields change
   */
  async update(
    id: string,
    updateDto: UpdateProcessCostDto,
    userId: string,
    accessToken: string,
  ): Promise<ProcessCostResponseDto> {
    this.logger.log(`Updating process cost: ${id}`, 'ProcessCostService');

    // Get existing record
    const { data: existing, error: fetchError } = await this.supabaseService
      .getClient(accessToken)
      .from('process_cost_records')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) {
      this.logger.error(`Error fetching process cost for update ${id}: ${fetchError.message}`, 'ProcessCostService');
      
      if (fetchError.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to update this process cost record.');
      }
      
      if (fetchError.message.includes('invalid input syntax for type uuid')) {
        throw new BadRequestException('Invalid process cost ID format provided.');
      }
      
      throw new InternalServerErrorException('Unable to retrieve process cost record for update.');
    }
    
    if (!existing) {
      this.logger.error(`Process cost not found: ${id}`, 'ProcessCostService');
      throw new NotFoundException(`Process cost record with ID ${id} was not found or you do not have access to it.`);
    }

    // Only re-derive machine_name/machine_class when mhrId or benchmarkMhrId is
    // actually part of this update payload (new id, same id re-sent, or explicit
    // null to clear it). If the caller didn't touch either at all, leave the
    // existing denormalized values alone — no extra DB round trip for edits that
    // don't involve the machine link.
    let machineFields: { machine_name: string | null; machine_class: string | null } | undefined;
    if (updateDto.mhrId !== undefined || updateDto.benchmarkMhrId !== undefined) {
      machineFields = await this.deriveMachineFields(updateDto.mhrId, updateDto.benchmarkMhrId, accessToken);
    }

    // Same gating for labor_type — only re-derive when lhrId/benchmarkLhrId is
    // actually part of this update payload.
    let laborFields: { labor_type: string | null } | undefined;
    // mhrId is now a labour source too, so a patch that only changes the
    // machine must re-derive the labour identity as well — otherwise a line
    // re-pointed at a different machine keeps the previous machine's label
    // beside the new machine's rate.
    if (
      updateDto.lhrId !== undefined
      || updateDto.benchmarkLhrId !== undefined
      || updateDto.mhrId !== undefined
    ) {
      laborFields = await this.deriveLaborFields(
        updateDto.lhrId,
        updateDto.benchmarkLhrId,
        accessToken,
        updateDto.mhrId ?? existing.mhr_id,
      );
    }

    // A rate field present in THIS patch arrives in the local currency for
    // updateDto.location (or the record's existing location) — convert once,
    // here — but `existing.*` fallbacks are already USD (create() above and
    // the applyRoute/applyCustomRoute write path both store USD), so only the
    // newly-supplied value gets converted, never the already-USD fallback.
    const rates = await this.exchangeRateService.getSnapshot(accessToken);
    const { currency: updateLocalCurrency } = getCurrencyForLocation(updateDto.location ?? existing.location ?? '');
    const toUsdIfProvided = (v: number | undefined): number | undefined =>
      v !== undefined ? rates.toUsd(v, updateLocalCurrency) : undefined;
    const directRateUsd   = toUsdIfProvided(updateDto.directRate)   ?? existing.direct_rate;
    const indirectRateUsd = toUsdIfProvided(updateDto.indirectRate) ?? existing.indirect_rate;
    const fringeRateUsd   = toUsdIfProvided(updateDto.fringeRate)   ?? existing.fringe_rate;
    const machineRateUsd  = toUsdIfProvided(updateDto.machineRate)  ?? existing.machine_rate;
    const machineValueUsd = toUsdIfProvided(updateDto.machineValue) ?? existing.machine_value;
    const laborRateUsd    = toUsdIfProvided(updateDto.laborRate)    ?? existing.labor_rate;

    // Merge with update values — already-USD (see toUsdIfProvided above)
    const merged = {
      opNbr: updateDto.opNbr ?? existing.op_nbr,
      directRate: directRateUsd,
      indirectRate: indirectRateUsd,
      fringeRate: fringeRateUsd,
      machineRate: machineRateUsd,
      machineValue: machineValueUsd,
      currency: 'USD',
      shiftPatternHoursPerDay: updateDto.shiftPatternHoursPerDay ?? existing.shift_pattern_hours_per_day,
      setupManning: updateDto.setupManning ?? existing.setup_manning,
      setupTime: updateDto.setupTime ?? existing.setup_time,
      batchSize: updateDto.batchSize ?? existing.batch_size,
      heads: updateDto.heads ?? existing.heads,
      cycleTime: updateDto.cycleTime ?? existing.cycle_time,
      partsPerCycle: updateDto.partsPerCycle ?? existing.parts_per_cycle,
      scrap: updateDto.scrap ?? existing.scrap,
      facilityId: updateDto.facilityId ?? existing.facility_id,
      facilityRateId: updateDto.facilityRateId ?? existing.facility_rate_id,
      shiftPatternId: updateDto.shiftPatternId ?? existing.shift_pattern_id,
    };

    // Recalculate
    const calculationResult = this.calculationEngine.calculate(merged);

    // Prepare update data
    const updateData: any = {};

    // Update input fields if provided
    if (updateDto.opNbr !== undefined) updateData.op_nbr = updateDto.opNbr;
    if (updateDto.processGroup !== undefined) updateData.process_group = updateDto.processGroup;
    if (updateDto.processRoute !== undefined) updateData.process_route = updateDto.processRoute;
    if (updateDto.operation !== undefined) updateData.operation = updateDto.operation;
    if (updateDto.category !== undefined) updateData.category = updateDto.category;
    if (updateDto.location !== undefined) updateData.location = updateDto.location;
    if (updateDto.mhrId !== undefined) updateData.mhr_id = updateDto.mhrId;
    if (updateDto.benchmarkMhrId !== undefined) updateData.benchmark_mhr_id = updateDto.benchmarkMhrId;
    if (machineFields) {
      updateData.machine_name = machineFields.machine_name;
      updateData.machine_class = machineFields.machine_class;
    }
    if (updateDto.lhrId !== undefined) updateData.lhr_id = updateDto.lhrId;
    if (updateDto.benchmarkLhrId !== undefined) updateData.benchmark_lhr_id = updateDto.benchmarkLhrId;
    if (laborFields) {
      updateData.labor_type = laborFields.labor_type;
    }
    if (updateDto.facilityCategoryId !== undefined) updateData.facility_category_id = updateDto.facilityCategoryId;
    if (updateDto.facilityTypeId !== undefined) updateData.facility_type_id = updateDto.facilityTypeId;
    if (updateDto.supplierId !== undefined) updateData.supplier_id = updateDto.supplierId;
    if (updateDto.supplierLocationId !== undefined) updateData.supplier_location_id = updateDto.supplierLocationId;
    if (updateDto.facilityId !== undefined) updateData.facility_id = updateDto.facilityId;
    if (updateDto.facilityRateId !== undefined) updateData.facility_rate_id = updateDto.facilityRateId;
    if (updateDto.directRate !== undefined) updateData.direct_rate = directRateUsd;
    if (updateDto.indirectRate !== undefined) updateData.indirect_rate = indirectRateUsd;
    if (updateDto.fringeRate !== undefined) updateData.fringe_rate = fringeRateUsd;
    if (updateDto.machineRate !== undefined) updateData.machine_rate = machineRateUsd;
    if (updateDto.machineValue !== undefined) updateData.machine_value = machineValueUsd;
    if (updateDto.laborRate !== undefined) updateData.labor_rate = laborRateUsd;
    if (updateDto.currency !== undefined) updateData.currency = 'USD';
    if (updateDto.shiftPatternId !== undefined) updateData.shift_pattern_id = updateDto.shiftPatternId;
    if (updateDto.shiftPatternHoursPerDay !== undefined) updateData.shift_pattern_hours_per_day = updateDto.shiftPatternHoursPerDay;
    if (updateDto.setupManning !== undefined) updateData.setup_manning = updateDto.setupManning;
    if (updateDto.setupTime !== undefined) updateData.setup_time = updateDto.setupTime;
    if (updateDto.batchSize !== undefined) updateData.batch_size = updateDto.batchSize;
    if (updateDto.heads !== undefined) updateData.heads = updateDto.heads;
    if (updateDto.cycleTime !== undefined) updateData.cycle_time = updateDto.cycleTime;
    if (updateDto.partsPerCycle !== undefined) updateData.parts_per_cycle = updateDto.partsPerCycle;
    if (updateDto.scrap !== undefined) updateData.scrap = updateDto.scrap;
    if (updateDto.isActive !== undefined) updateData.is_active = updateDto.isActive;
    if (updateDto.notes !== undefined) updateData.notes = updateDto.notes;
    if (updateDto.processId !== undefined) updateData.process_id = updateDto.processId;
    if (updateDto.processRouteId !== undefined) updateData.process_route_id = updateDto.processRouteId;
    if (updateDto.bomItemId !== undefined) updateData.bom_item_id = updateDto.bomItemId;

    // Always update calculated fields
    updateData.total_cost_per_part = calculationResult.totalCostPerPart;
    updateData.setup_cost_per_part = calculationResult.setupCostPerPart;
    updateData.total_cycle_cost_per_part = calculationResult.totalCycleCostPerPart;
    updateData.total_cost_before_scrap = calculationResult.totalCostBeforeScrap;
    updateData.scrap_adjustment = calculationResult.scrapAdjustment;
    updateData.total_batch_cost = calculationResult.totalBatchCost;
    updateData.calculation_breakdown = calculationResult;

    // Any manual update via the dialog marks the row as engineer-overridden
    updateData.is_override = true;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_cost_records')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Error updating process cost: ${error?.message}`, 'ProcessCostService');
      
      if (error) {
        // Handle concurrent update conflicts
        if (error.message.includes('row was updated by another user')) {
          throw new ConflictException(
            'This process cost record has been modified by another user. Please refresh and try again.'
          );
        }
        
        // Handle validation constraints
        if (error.message.includes('violates check constraint')) {
          if (error.message.includes('positive_rates')) {
            throw new BadRequestException('All rate values must be positive numbers.');
          }
          if (error.message.includes('positive_values')) {
            throw new BadRequestException('Time, quantity, and cost values must be positive numbers.');
          }
        }
        
        // Handle foreign key constraints
        if (error.message.includes('violates foreign key constraint')) {
          if (error.message.includes('process_id')) {
            throw new BadRequestException('The specified process does not exist or you do not have access to it.');
          }
          if (error.message.includes('bom_item_id')) {
            throw new BadRequestException('The specified BOM item does not exist or has been deleted.');
          }
        }
      }
      
      throw new InternalServerErrorException('Failed to update process cost record. Please verify your input and try again.');
    }

    return ProcessCostResponseDto.fromDatabase(data);
  }

  /**
   * Delete a process cost record
   */
  async remove(id: string, userId: string, accessToken: string): Promise<{ message: string }> {
    this.logger.log(`Deleting process cost: ${id}`, 'ProcessCostService');

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_cost_records')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting process cost: ${error.message}`, 'ProcessCostService');
      
      // Handle foreign key constraint violations (process cost referenced elsewhere)
      if (error.message.includes('violates foreign key constraint')) {
        throw new ConflictException(
          'This process cost record cannot be deleted as it is being referenced by other calculations or processes. Please remove those references first.'
        );
      }
      
      throw new InternalServerErrorException('Failed to delete process cost record. Please try again later.');
    }

    return { message: 'Process cost deleted successfully' };
  }

  /**
   * Calculate process cost without saving to database
   * Useful for preview/what-if analysis
   */
  async calculateOnly(input: ProcessCostInput): Promise<any> {
    this.logger.log('Calculating process cost (no save)', 'ProcessCostService');

    try {
      // Validate input before calculation
      if (!input || typeof input !== 'object') {
        throw new BadRequestException('Invalid calculation input provided.');
      }
      
      if (input.cycleTime <= 0) {
        throw new BadRequestException('Cycle time must be greater than zero for cost calculation.');
      }
      
      if (input.batchSize <= 0) {
        throw new BadRequestException('Batch size must be greater than zero for cost calculation.');
      }
      
      const result = this.calculationEngine.calculate(input);
      return result;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Calculation error: ${error.message}`, 'ProcessCostService');
      
      // Handle specific calculation errors
      if (error.message.includes('division by zero')) {
        throw new BadRequestException('Invalid calculation parameters detected. Please check that all time and quantity values are greater than zero.');
      }
      
      if (error.message.includes('invalid number')) {
        throw new BadRequestException('All numeric input values must be valid numbers.');
      }

      // The engine validates its own inputs and throws a plain Error naming the
      // exact field and bound. Those are 400-class input problems, not server
      // faults, and collapsing them into a generic 500 threw away the one piece
      // of information the caller needed: a real 0.6 s cycle time was being
      // rejected by a bad floor, and every client saw only "failed due to an
      // unexpected error" while the UI rendered a confident "$0.00".
      if (error.message.startsWith('Cycle Time must be')
        || error.message.startsWith('Batch Size must be')
        || error.message.startsWith('Parts Per Cycle must be')
        || error.message.startsWith('Setup Time must be')
        || error.message.startsWith('Heads must be')
        || error.message.startsWith('Scrap must be')
        || error.message.includes('must be between')) {
        throw new BadRequestException(error.message);
      }

      throw new InternalServerErrorException('Process cost calculation failed due to an unexpected error. Please verify your input values.');
    }
  }

  /**
   * Recalculate an existing record
   * Used when fetching records to ensure fresh calculations
   */
  private recalculateRecord(record: any): any {
    const input: ProcessCostInput = {
      opNbr: record.op_nbr,
      directRate: parseFloat(record.direct_rate) || 0,
      indirectRate: parseFloat(record.indirect_rate) || 0,
      fringeRate: parseFloat(record.fringe_rate) || 0,
      machineRate: parseFloat(record.machine_rate) || 0,
      machineValue: parseFloat(record.machine_value) || 0,
      currency: record.currency,
      shiftPatternHoursPerDay: parseFloat(record.shift_pattern_hours_per_day),
      setupManning: parseFloat(record.setup_manning) || 0,
      setupTime: parseFloat(record.setup_time) || 0,
      batchSize: parseFloat(record.batch_size) || 1,
      heads: parseFloat(record.heads) || 0,
      cycleTime: parseFloat(record.cycle_time) || 0,
      partsPerCycle: parseFloat(record.parts_per_cycle) || 1,
      scrap: parseFloat(record.scrap) || 0,
      facilityId: record.facility_id,
      facilityRateId: record.facility_rate_id,
      shiftPatternId: record.shift_pattern_id,
    };

    const calculationResult = this.calculationEngine.calculate(input);

    // P1b-iv-b: a stored cost wins over a re-derivation.
    //
    // This method recomputed all three cost figures on EVERY read, which
    // silently replaced the engine cost with a rate-only re-derivation --
    // measured live, 51 of 55 rows that carry a stored value disagree with
    // that re-derivation by more than 1%, ratios 0.285x to 1.963x.
    //
    // Recomputing here is not needed to reflect edits: create (line ~445) and
    // update (line ~668) both persist what the calculation engine produced, so
    // the stored value is always current for anything saved through this
    // service. The engine still runs, because the other fields it returns
    // (total_cost_before_scrap, scrap_adjustment) are not stored anywhere --
    // only the three costs now defer to what is on the row.
    const stored = resolvePersistedProcessCost(record);

    return {
      ...record,
      total_cost_per_part: stored.source === 'stored' ? stored.totalCostPerPart : calculationResult.totalCostPerPart,
      setup_cost_per_part: stored.source === 'stored' ? stored.setupCostPerPart : calculationResult.setupCostPerPart,
      total_cycle_cost_per_part: stored.source === 'stored' ? stored.cycleCostPerPart : calculationResult.totalCycleCostPerPart,
      total_cost_before_scrap: calculationResult.totalCostBeforeScrap,
      scrap_adjustment: calculationResult.scrapAdjustment,
      total_batch_cost: calculationResult.totalBatchCost,
      calculation_breakdown: calculationResult,
    };
  }

  /**
   * Get total process cost for a specific BOM item
   */
  async getTotalCostForBomItem(
    bomItemId: string,
    userId?: string,
    accessToken?: string,
  ): Promise<number> {
    this.logger.log(`Calculating total process cost for BOM item: ${bomItemId}`, 'ProcessCostService');

    const client = this.supabaseService.getClient(accessToken);

    // Prefer the stored total_cost_per_part — every creation path (manual create/update,
    // process-plan-generator apply) now computes and persists it via the shared
    // ProcessCostCalculationEngine at write time. Recompute from source fields only as a
    // fallback for rows saved before that engine existed, where the column is still null.
    const { data: costs, error } = await client
      .from('process_cost_records')
      .select(PERSISTED_PROCESS_COST_COLUMNS)
      .eq('bom_item_id', bomItemId)
      .eq('is_active', true);

    if (error) {
      this.logger.error('Error fetching process costs for BOM item', error.message, 'ProcessCostService');
      throw new InternalServerErrorException('Failed to fetch process costs');
    }

    // P1b-iv-b: this prefer-stored-then-derive logic was written out here and
    // again in the bulk path below, and a third and fourth time in
    // boms.service.ts and cost-aggregation.service.ts (those two without the
    // prefer-stored half). One implementation now.
    // Cast at the boundary: Supabase infers no row type from a select list that
    // is not a string literal, and PERSISTED_PROCESS_COST_COLUMNS is shared
    // deliberately so every caller selects exactly the columns the resolver
    // reads.
    const { total: totalCost } = sumPersistedProcessCost(
      (costs ?? []) as unknown as PersistedProcessCostRow[],
    );

    this.logger.log(`Total process cost for BOM item ${bomItemId}: ${totalCost}`, 'ProcessCostService');
    return totalCost;
  }

  async getBulkTotalCosts(
    bomItemIds: string[],
    accessToken?: string,
  ): Promise<Record<string, number>> {
    if (bomItemIds.length === 0) return {};

    // Same preference as getTotalCostForBomItem: use the stored total where the
    // shared engine already computed it, recompute from source fields only as a
    // fallback for older rows saved before that engine existed.
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('process_cost_records')
      .select(`bom_item_id, ${PERSISTED_PROCESS_COST_COLUMNS}`)
      .in('bom_item_id', bomItemIds)
      .eq('is_active', true);

    if (error) {
      this.logger.error(`Error fetching bulk process costs: ${error.message}`, 'ProcessCostService');
      throw new InternalServerErrorException(`Failed to fetch bulk process costs: ${error.message}`);
    }

    const totals: Record<string, number> = Object.fromEntries(bomItemIds.map(id => [id, 0]));
    for (const row of data ?? []) {
      const { totalCostPerPart } = resolvePersistedProcessCost(row);
      totals[row.bom_item_id] = (totals[row.bom_item_id] ?? 0) + totalCostPerPart;
    }
    return totals;
  }
}
