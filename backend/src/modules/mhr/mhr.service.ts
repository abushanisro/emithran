import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateMHRDto, UpdateMHRDto, QueryMHRDto } from './dto/mhr.dto';
import { MHRResponseDto, MHRListResponseDto, MHRCalculationResult, MHRReferenceDetailDto } from './dto/mhr-response.dto';
import { validate as isValidUUID } from 'uuid';
import { MHRCalculationEngine } from './engines/mhr-calculation.engine';
import { MHRInputValidator } from './validators/mhr-input.validator';
import { getCurrencyForLocation, MHR_CALCULATION_CONSTANTS } from './constants/mhr-calculation.constants';
import { invalidateMachinePools } from '../bom-items/costing/shared/capability/machine-selection/pool-cache';
import { resolveMachineEconomics } from '../bom-items/costing/shared/capability/machine-selection/economics-resolver';
import { ExchangeRateService, RateSnapshot } from '../../common/exchange-rate/exchange-rate.service';
import { LHRService } from '../lhr/lhr.service';
import * as ExcelJS from 'exceljs';

/**
 * MHR Service
 *
 * Implements manufacturing cost engineering business logic following industry best practices.
 * Provides CRUD operations with automatic MHR calculation and validation.
 *
 * Architecture:
 * - Separation of Concerns: Business logic separate from calculation logic
 * - Dependency Injection: Clean testable design
 * - Input Validation: Industry-standard validation rules
 * - Error Handling: Proper exception handling with logging
 * - Data Integrity: Recalculation on fetch ensures accuracy
 *
 * @version 2.0.0
 */
@Injectable()
export class MHRService {
  private readonly calculationEngine: MHRCalculationEngine;
  private readonly validator: MHRInputValidator;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly lhrService: LHRService,
  ) {
    this.calculationEngine = new MHRCalculationEngine();
    this.validator = new MHRInputValidator();
  }

  /**
   * Create a complete MHRCalculationResult for manual entries.
   * Hours derived from operational parameters when available.
   */
  private createManualEntryCalculation(
    manualMHRValue: number,
    row?: any,
  ): MHRCalculationResult {
    const { DEFAULTS } = MHR_CALCULATION_CONSTANTS;
    const workingDays   = parseFloat(row?.working_days_per_year ?? 0)            || DEFAULTS.WORKING_DAYS_PER_YEAR;
    const shiftsPerDay  = parseFloat(row?.shifts_per_day ?? 0)                   || DEFAULTS.SHIFTS_PER_DAY;
    const hoursPerShift = parseFloat(row?.hours_per_shift ?? 0)                  || DEFAULTS.HOURS_PER_SHIFT;
    const maintHrs      = parseFloat(row?.planned_maintenance_hours_per_year ?? 0) || 0;
    const utilPct       = parseFloat(row?.capacity_utilization_rate ?? 0)        || DEFAULTS.CAPACITY_UTILIZATION_RATE;
    // Disclosed, not silent: effectiveHoursPerYear/totalAnnualCost below are
    // DERIVED from these operational assumptions (the manually-entered rate
    // itself is unaffected) — a caller that omits real shift/hours/utilization
    // data gets a real warning in the logs, not a number that looks measured.
    const usedDefaults: string[] = [];
    if (!(parseFloat(row?.working_days_per_year ?? 0) > 0)) usedDefaults.push(`working days/yr=${DEFAULTS.WORKING_DAYS_PER_YEAR}`);
    if (!(parseFloat(row?.shifts_per_day ?? 0) > 0)) usedDefaults.push(`shifts/day=${DEFAULTS.SHIFTS_PER_DAY}`);
    if (!(parseFloat(row?.hours_per_shift ?? 0) > 0)) usedDefaults.push(`hours/shift=${DEFAULTS.HOURS_PER_SHIFT}`);
    if (!(parseFloat(row?.capacity_utilization_rate ?? 0) > 0)) usedDefaults.push(`utilization=${DEFAULTS.CAPACITY_UTILIZATION_RATE}%`);
    if (usedDefaults.length > 0) {
      this.logger.warn(
        `Manual MHR entry: no real operational data for ${usedDefaults.join(', ')} — effectiveHoursPerYear/totalAnnualCost use assumed defaults, not measured values.`,
        'MHRService',
      );
    }

    const workingHrs   = workingDays * shiftsPerDay * hoursPerShift;
    const availableHrs = Math.max(0, workingHrs - maintHrs);
    const effectiveHrs = availableHrs * (utilPct / 100);

    const storedFixed  = row?.total_fixed_cost_per_hour ? parseFloat(row.total_fixed_cost_per_hour) : manualMHRValue;
    // MRO/maintenance is a fixed cost — any non-zero stored variable cost is legacy MRO data
    // that was incorrectly classified; fold it back into the fixed bucket for display purposes.
    const storedVar    = row?.total_variable_cost_per_hour ? parseFloat(row.total_variable_cost_per_hour) : 0;
    const storedAnnual = row?.total_annual_cost ? parseFloat(row.total_annual_cost) : manualMHRValue * effectiveHrs;
    const maintenanceFromVar = storedVar > 0 && storedFixed < storedVar ? storedVar : 0;
    const trueFixed = storedFixed + maintenanceFromVar;
    const trueVar   = maintenanceFromVar > 0 ? 0 : storedVar;

    return {
      workingHoursPerYear:       workingHrs,
      availableHoursPerYear:     availableHrs,
      effectiveHoursPerYear:     effectiveHrs,
      depreciationPerHour:       0,
      interestPerHour:           0,
      insurancePerHour:          0,
      rentPerHour:               0,
      maintenancePerHour:        maintenanceFromVar,
      electricityPerHour:        trueVar,
      costOfOwnershipPerHour:    storedFixed,
      totalFixedCostPerHour:     trueFixed,
      totalVariableCostPerHour:  trueVar,
      totalOperatingCostPerHour: trueFixed + trueVar,
      adminOverheadPerHour:      0,
      profitMarginPerHour:       0,
      totalMachineHourRate:      manualMHRValue,
      depreciationPerAnnum:      0,
      interestPerAnnum:          0,
      insurancePerAnnum:         0,
      rentPerAnnum:              0,
      maintenancePerAnnum:       0,
      electricityPerAnnum:       0,
      totalFixedCostPerAnnum:    0,
      totalVariableCostPerAnnum: 0,
      totalAnnualCost:           storedAnnual,
      accessoriesCost:           0,
      installationCost:          0,
      totalCapitalInvestment:    0,
    };
  }

  /**
   * Derives currency from location and computes USD equivalents for MHR and fully-burdened rates.
   * For India (INR): uses lhrInrPerHr for the labor component.
   * For all other locations: uses usdLhrTotal as the labor USD rate directly.
   *
   * FX rate comes from the caller's RateSnapshot (one FX read per request —
   * see ExchangeRateService.getSnapshot), not a hardcoded constant — an admin
   * maintains the rate; this method never invents one, and never silently
   * treats local currency as USD when a rate is missing (throws instead).
   */
  private computeUsdAndBurdenedRates(
    totalMachineHourRate: number,
    location: string,
    rates: RateSnapshot,
    lhrInrPerHr?: number | null,
    usdLhrTotal?: number | null,
  ): {
    currency: string;
    currencySymbol: string;
    mhrUsdPerHour: number;
    fullyBurdenedLocalPerHr: number | null;
    fullyBurdenedUsdPerHr: number | null;
  } {
    const { currency, symbol } = getCurrencyForLocation(location);
    const usdPerLocal = rates.convertStrict(currency, 'USD');
    const mhrUsdPerHour = parseFloat((totalMachineHourRate * usdPerLocal).toFixed(4));

    let fullyBurdenedLocalPerHr: number | null = null;
    let fullyBurdenedUsdPerHr: number | null = null;

    if (currency === 'INR' && lhrInrPerHr && lhrInrPerHr > 0) {
      fullyBurdenedLocalPerHr = parseFloat((totalMachineHourRate + lhrInrPerHr).toFixed(2));
      fullyBurdenedUsdPerHr = parseFloat((fullyBurdenedLocalPerHr * usdPerLocal).toFixed(4));
    } else if (currency !== 'INR' && usdLhrTotal && usdLhrTotal > 0) {
      // Convert USD labor back to local for the local burdened rate
      const lhrInLocal = usdLhrTotal / usdPerLocal;
      fullyBurdenedLocalPerHr = parseFloat((totalMachineHourRate + lhrInLocal).toFixed(2));
      fullyBurdenedUsdPerHr = parseFloat((mhrUsdPerHour + usdLhrTotal).toFixed(4));
    }

    return { currency, currencySymbol: symbol, mhrUsdPerHour, fullyBurdenedLocalPerHr, fullyBurdenedUsdPerHr };
  }

  /**
   * Returns global MHR benchmark rates from mhr_benchmark_rates (no user_id — shared).
   * Used as a fallback when the user has no custom MHR records for the selected location.
   * Response shape mirrors the subset of MHRRecord that the Process Cost dialog needs.
   */
  async getBenchmarkRates(location?: string, processGroup?: string, machineClass?: string) {
    let query = this.supabaseService
      .getAdminClient()
      .from('mhr_benchmark_rates')
      .select('id, machine_name, process_group, machine_class, location, mhr_usd, machine_ref')
      .order('location', { ascending: true })
      .order('machine_class', { ascending: true })
      .order('machine_name', { ascending: true });

    if (location) query = query.ilike('location', location);
    if (machineClass) query = query.eq('machine_class', machineClass);
    else if (processGroup) query = query.eq('process_group', processGroup);

    const { data, error } = await query;

    if (error) {
      this.logger.error(`Error fetching MHR benchmark rates: ${error.message}`, 'MHRService');
      throw new InternalServerErrorException('Failed to fetch MHR benchmark rates');
    }

    return (data ?? []).map(row => ({
      id: `bm-mhr-${row.id}`,
      machineName:   row.machine_name,
      processGroup:  row.process_group,
      machineClass:  row.machine_class,
      location:      row.location,
      machineRef:    row.machine_ref,
      isBenchmark:   true,
      calculations:  { totalMachineHourRate: parseFloat(row.mhr_usd) || 0 },
    }));
  }

  /**
   * Calculate all MHR metrics based on input parameters
   * Uses the calculation engine for clean separation of concerns
   */
  calculateMHR(dto: CreateMHRDto | UpdateMHRDto, skipValidation = false): MHRCalculationResult {
    try {
      // Validate inputs according to industry standards (skip for recalculations from DB)
      if (!skipValidation) {
        this.validator.validateAndThrow(dto);
      }

      // Delegate calculation to the specialized engine
      const result = this.calculationEngine.calculate(dto);

      this.logger.debug('MHR calculation completed', 'MHRService');

      return result;
    } catch (error) {
      this.logger.error(`MHR calculation failed: ${error.message}`, 'MHRService');
      throw error;
    }
  }

  async findAll(query: QueryMHRDto, userId?: string, accessToken?: string): Promise<MHRListResponseDto> {
    this.logger.log('Fetching all MHR records', 'MHRService');

    const page = query.page || 1;
    const limit = Math.min(query.limit || 50, 10000);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (query.search) {
      queryBuilder = queryBuilder.or(`machine_name.ilike.%${query.search}%,machine_description.ilike.%${query.search}%`);
    }

    if (query.location) {
      queryBuilder = queryBuilder.eq('location', query.location);
    }

    if (query.currency) {
      queryBuilder = queryBuilder.eq('currency', query.currency);
    }

    if (query.commodityCode) {
      queryBuilder = queryBuilder.eq('commodity_code', query.commodityCode);
    }

    if (query.processGroup) {
      queryBuilder = queryBuilder.eq('process_group', query.processGroup);
    }

    if (query.machineClass) {
      queryBuilder = queryBuilder.eq('machine_class', query.machineClass);
    }

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching MHR records: ${error.message}`, 'MHRService');
      
      // Handle access permissions
      if (error.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access these MHR records.');
      }
      
      // Handle query parameter issues
      if (error.message.includes('invalid input syntax')) {
        throw new BadRequestException('Invalid search parameters provided. Please check your filters and try again.');
      }
      
      throw new InternalServerErrorException('Unable to retrieve MHR records. Please try again later.');
    }

    const records = (data || []).map(row => {
      // Prefer stored computed values on reads — the engine ran at write time (create/update/import)
      // and wrote total_machine_hour_rate / total_fixed_cost_per_hour / total_variable_cost_per_hour.
      // Re-running the engine per-row on every GET is redundant and O(N) CPU for list pages.
      // Only fall back to full engine for legacy rows that somehow have no stored total.
      let calculations: MHRCalculationResult;

      if (row.is_manual_entry && row.manual_mhr_value) {
        calculations = this.createManualEntryCalculation(parseFloat(row.manual_mhr_value), row);
      } else if (Number(row.total_machine_hour_rate ?? 0) > 0) {
        // Use stored total (covers both import/eMithran records and full-capex records).
        // createManualEntryCalculation picks up stored fixed/variable/annual from the row object.
        calculations = this.createManualEntryCalculation(Number(row.total_machine_hour_rate), row);
      } else {
        // Fallback: legacy record with no stored total — run engine once to populate it.
        calculations = this.calculateMHR(this.mapRowToDto(row), true);
      }

      return MHRResponseDto.fromDatabase({ ...row, calculations: JSON.stringify(calculations) });
    });

    return {
      records,
      total: count || 0,
      page,
      limit,
    };
  }

  async findOne(id: string, userId: string, accessToken: string): Promise<MHRResponseDto> {
    this.logger.log(`Fetching MHR record: ${id}`, 'MHRService');

    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format provided: ${id}`, 'MHRService');
      throw new BadRequestException('Invalid MHR record ID format');
    }

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      this.logger.error(`Error fetching MHR record ${id}: ${error.message}`, 'MHRService');
      
      if (error.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access this MHR record.');
      }
      
      throw new InternalServerErrorException('Unable to retrieve MHR record. Please try again later.');
    }
    
    if (!data) {
      this.logger.warn(`MHR record not found: ${id}`, 'MHRService');
      throw new NotFoundException(`MHR record with ID ${id} was not found or you do not have access to it.`);
    }

    let calculations: MHRCalculationResult;

    if (data.is_manual_entry && data.manual_mhr_value) {
      calculations = this.createManualEntryCalculation(parseFloat(data.manual_mhr_value), data);
    } else if (
      (data.landed_machine_cost == null || Number(data.landed_machine_cost) === 0) &&
      Number(data.total_machine_hour_rate ?? 0) > 0
    ) {
      // Import/eMithran record: use stored total directly (same logic as findAll).
      calculations = this.createManualEntryCalculation(Number(data.total_machine_hour_rate), data);
    } else {
      calculations = this.calculateMHR(this.mapRowToDto(data), true);
    }

    return MHRResponseDto.fromDatabase({ ...data, calculations: JSON.stringify(calculations) });
  }

  // ── Machine Economics provenance (Phase 1, see CLAUDE.md "Machine Economics") ──

  /**
   * Live, unambiguous exact-name lookup against sm_reference_data's staged
   * machine_library.json (category='machine') — the same matching discipline
   * migration 537's one-time bulk promotion uses, done live so a machine
   * created/renamed AFTER that migration still gets matched. Returns all-null
   * on no match OR an ambiguous match (>1 row with this name) — never guesses.
   */
  private async lookupMachineLibraryBenchmark(
    accessToken: string,
    machineName: string | undefined,
  ): Promise<{ direct: number | null; indirect: number | null; labor: number | null; sourceKey: string | null }> {
    const empty = { direct: null, indirect: null, labor: null, sourceKey: null };
    if (!machineName?.trim()) return empty;
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('sm_reference_data')
      .select('key, raw')
      .eq('category', 'machine');
    if (error || !data) return empty;

    const nameLower = machineName.trim().toLowerCase();
    const matches = data.filter((r: any) => String(r.raw?.name ?? '').trim().toLowerCase() === nameLower);
    if (matches.length !== 1) return empty;

    const raw = matches[0].raw ?? {};
    const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      direct: numOrNull(raw.direct_overhead_rate_usd_hr),
      indirect: numOrNull(raw.indirect_overhead_rate_usd_hr),
      labor: numOrNull(raw.labor_rate_usd_hr),
      sourceKey: matches[0].key ?? null,
    };
  }

  /**
   * Read-only full machine_library.json detail for one mhr_records row —
   * powers the HR Rates edit dialog's "Capability" tab read-only lookup
   * (replaces a free-text "paste raw JSON yourself" field with the real,
   * sourced data). Matches by benchmark_source_key first (exact, set at
   * import/create time — see resolveEconomicsForCreate); falls back to an
   * unambiguous machine-name match for older rows saved before that column
   * existed. Never guesses: an ambiguous or missing match returns found:false
   * rather than a wrong machine's specs.
   */
  async getReferenceDetail(id: string, accessToken: string): Promise<MHRReferenceDetailDto> {
    if (!this.isValidUUID(id)) {
      throw new BadRequestException('Invalid MHR record ID format provided.');
    }
    const { data: row, error: rowError } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .select('benchmark_source_key, machine_name')
      .eq('id', id)
      .maybeSingle();
    if (rowError || !row) {
      throw new NotFoundException(`MHR record with ID ${id} not found.`);
    }

    const empty: MHRReferenceDetailDto = { found: false, sourceKey: null, raw: null };
    const client = this.supabaseService.getClient(accessToken);

    if (row.benchmark_source_key) {
      const { data } = await client
        .from('sm_reference_data')
        .select('key, raw')
        .eq('category', 'machine')
        .eq('key', row.benchmark_source_key)
        .maybeSingle();
      if (data) return { found: true, sourceKey: data.key, raw: data.raw ?? null };
    }

    if (row.machine_name?.trim()) {
      const { data } = await client
        .from('sm_reference_data')
        .select('key, raw')
        .eq('category', 'machine');
      const nameLower = row.machine_name.trim().toLowerCase();
      const matches = (data ?? []).filter((r: any) => String(r.raw?.name ?? '').trim().toLowerCase() === nameLower);
      if (matches.length === 1) {
        return { found: true, sourceKey: matches[0].key, raw: matches[0].raw ?? null };
      }
    }

    return empty;
  }

  /**
   * Resolves direct/indirect overhead + labor rate for a CREATE, with
   * provenance — see economics-resolver.ts's doc comment. Only queries
   * sm_reference_data when at least one of the three fields was left blank
   * by the caller (an explicit value from the form is always 'shop_override'
   * and never needs a benchmark lookup).
   *
   * Labor rate specifically: completes migration 568's stated intent (never
   * actually wired — root-caused 2026-08-30). Before falling back to the
   * generic, non-location-aware per-machine-name catalog lookup, try the
   * real, (location, process_group)-aware LHRService.getEffectiveRate() —
   * the same shop-average/benchmark precedence bom-items.service.ts's
   * resolveLHRRates() already uses for real quote costing. This is what
   * keeps Machine Selection/Machine Economics from silently diverging from
   * Cost Summary's labor rate for the same machine/location/process.
   */
  private async resolveEconomicsForCreate(
    accessToken: string,
    machineName: string | undefined,
    location: string | undefined,
    processGroup: string | undefined,
    explicit: { directOverheadRate?: number | null; indirectOverheadRate?: number | null; usdLhrTotal?: number | null },
  ) {
    const needsBenchmark = explicit.directOverheadRate == null || explicit.indirectOverheadRate == null || explicit.usdLhrTotal == null;
    const benchmark = needsBenchmark
      ? await this.lookupMachineLibraryBenchmark(accessToken, machineName)
      : { direct: null, indirect: null, labor: null, sourceKey: null };

    let laborValue: number | null = explicit.usdLhrTotal ?? null;
    let laborSource: 'shop_override' | 'lhr_shop_avg' | 'lhr_benchmark' | null =
      explicit.usdLhrTotal != null ? 'shop_override' : null;
    if (laborValue == null && location && processGroup) {
      const lhrResult = await this.lhrService.getEffectiveRate(location, processGroup, accessToken);
      if (lhrResult.rateUsdPerHr != null) {
        laborValue = lhrResult.rateUsdPerHr;
        laborSource = lhrResult.source === 'shop_average' ? 'lhr_shop_avg' : 'lhr_benchmark';
      }
    }

    const resolved = resolveMachineEconomics({
      direct_overhead_rate: explicit.directOverheadRate ?? null,
      direct_overhead_source: explicit.directOverheadRate != null ? 'shop_override' : null,
      indirect_overhead_rate: explicit.indirectOverheadRate ?? null,
      indirect_overhead_source: explicit.indirectOverheadRate != null ? 'shop_override' : null,
      usd_lhr_total: laborValue,
      labor_rate_source: laborSource,
      benchmark_direct_overhead_rate_usd_hr: benchmark.direct,
      benchmark_indirect_overhead_rate_usd_hr: benchmark.indirect,
      benchmark_labor_rate_usd_hr: benchmark.labor,
    });

    return {
      direct_overhead_rate: resolved.directOverheadRate.value,
      direct_overhead_source: resolved.directOverheadRate.source,
      indirect_overhead_rate: resolved.indirectOverheadRate.value,
      indirect_overhead_source: resolved.indirectOverheadRate.source,
      usd_lhr_total: resolved.laborRateUsdHr.value,
      labor_rate_source: resolved.laborRateUsdHr.source,
      benchmark_direct_overhead_rate_usd_hr: benchmark.direct,
      benchmark_indirect_overhead_rate_usd_hr: benchmark.indirect,
      benchmark_labor_rate_usd_hr: benchmark.labor,
      benchmark_source_key: benchmark.sourceKey,
    };
  }

  async create(createMHRDto: CreateMHRDto, userId: string, accessToken: string): Promise<MHRResponseDto> {
    this.logger.log(`Creating MHR record for user: ${userId}`, 'MHRService');

    // Handle manual entry mode
    let calculations: MHRCalculationResult;
    if (createMHRDto.isManualEntry && createMHRDto.manualMHRValue) {
      this.logger.log(`Using manual MHR value: ${createMHRDto.manualMHRValue}`, 'MHRService');
      // Previously called with no row at all — any real shiftsPerDay/hoursPerShift/
      // workingDaysPerYear/capacityUtilizationRate the caller submitted alongside
      // the manual value was silently discarded in favor of DEFAULTS below.
      calculations = this.createManualEntryCalculation(createMHRDto.manualMHRValue, {
        working_days_per_year: createMHRDto.workingDaysPerYear,
        shifts_per_day: createMHRDto.shiftsPerDay,
        hours_per_shift: createMHRDto.hoursPerShift,
        planned_maintenance_hours_per_year: createMHRDto.plannedMaintenanceHoursPerYear,
        capacity_utilization_rate: createMHRDto.capacityUtilizationRate,
      });
    } else {
      calculations = this.calculateMHR(createMHRDto);
    }

    const economicsFields = await this.resolveEconomicsForCreate(
      accessToken,
      createMHRDto.machineName,
      createMHRDto.location,
      createMHRDto.processGroup,
      {
        directOverheadRate: createMHRDto.directOverheadRate,
        indirectOverheadRate: createMHRDto.indirectOverheadRate,
        usdLhrTotal: createMHRDto.usdLhrTotal,
      },
    );

    // No fabrication (2026-08-30): total_machine_hour_rate = Direct + Indirect
    // OH, and there is no existing row to preserve on a brand-new create() —
    // so if either component has no real value AND no benchmark data
    // (economics-resolver.ts's 'no_rate' tier, value: null), silently
    // treating it as 0 would persist a fabricated machine-hour rate. Refuse
    // instead, with an actionable message, rather than writing a false number.
    const resolvedDirectOverheadRate = economicsFields.direct_overhead_rate;
    const resolvedIndirectOverheadRate = economicsFields.indirect_overhead_rate;
    const missingOverhead: string[] = [];
    if (resolvedDirectOverheadRate == null) missingOverhead.push('Direct Overhead Rate');
    if (resolvedIndirectOverheadRate == null) missingOverhead.push('Indirect Overhead Rate');
    if (missingOverhead.length > 0 || resolvedDirectOverheadRate == null || resolvedIndirectOverheadRate == null) {
      throw new BadRequestException(
        `No real value or industry benchmark data exists for: ${missingOverhead.join(' and ')}. ` +
        `Enter the missing rate(s) manually, or use a machine name that matches real benchmark data — Machine Hour Rate cannot be created as a fabricated $0.`,
      );
    }

    const rates = await this.exchangeRateService.getSnapshot(accessToken);

    // Canonical MHR (2026-08-27 decision): Machine Hour Rate = Total Overhead
    // = Direct OH + Indirect OH, always. Direct/indirect are the sole
    // authoritative MHR inputs — this overrides whatever the manual-entry/
    // capex-engine branch above computed for totalMachineHourRate (their
    // other breakdown fields — depreciation, interest, etc. — are left
    // alone; only the headline total is canonical). Direct/indirect are
    // USD-denominated (economics-resolver.ts) while total_machine_hour_rate
    // is this record's LOCAL currency (computeUsdAndBurdenedRates multiplies
    // it by usdPerLocal below), so the sum must be FX-converted here — never
    // a raw same-number substitution, or a non-USD location's MHR would be
    // wrong by the FX factor.
    const { currency: createCurrency } = getCurrencyForLocation(createMHRDto.location);
    const createUsdPerLocal = rates.convertStrict(createCurrency, 'USD');
    // Both guaranteed non-null by the guard above — no `?? 0` fabrication.
    const createTotalOhUsd = resolvedDirectOverheadRate + resolvedIndirectOverheadRate;
    calculations.totalMachineHourRate = Math.round((createTotalOhUsd / createUsdPerLocal) * 100) / 100;

    const usdRates = this.computeUsdAndBurdenedRates(
      calculations.totalMachineHourRate,
      createMHRDto.location,
      rates,
      createMHRDto.lhrInrPerHr ?? null,
      economicsFields.usd_lhr_total,
    );

    // Machine capability — same shape/convention as importFromExcel()'s
    // `capability`/`hasCapability` (see that method's own comment): a human
    // explicitly entering a real limit via this dialog is exactly as real as
    // an imported one, so it gets the same 'imported' tag, never a guess.
    const capability = {
      max_x_mm: createMHRDto.maxXMm ?? null,
      max_y_mm: createMHRDto.maxYMm ?? null,
      max_z_mm: createMHRDto.maxZMm ?? null,
      max_diameter_mm: createMHRDto.maxDiameterMm ?? null,
      max_length_mm: createMHRDto.maxLengthMm ?? null,
      max_tonnage: createMHRDto.maxTonnage ?? null,
      max_thickness_mm: createMHRDto.maxThicknessMm ?? null,
      max_workpiece_weight_kg: createMHRDto.maxWorkpieceWeightKg ?? null,
      power_kw: createMHRDto.powerKw ?? null,
      max_thickness_ms_mm: createMHRDto.maxThicknessMsMm ?? null,
      max_thickness_ss_mm: createMHRDto.maxThicknessSsMm ?? null,
      max_thickness_al_mm: createMHRDto.maxThicknessAlMm ?? null,
      max_thickness_cu_mm: createMHRDto.maxThicknessCuMm ?? null,
      cuttable_materials: createMHRDto.cuttableMaterials?.length ? createMHRDto.cuttableMaterials : null,
    };
    const hasCapability = Object.values(capability).some((v) => v != null);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .insert({
        user_id: userId,
        location: createMHRDto.location,
        commodity_code: createMHRDto.commodityCode,
        machine_description: createMHRDto.machineDescription,
        manufacturer: createMHRDto.manufacturer,
        model: createMHRDto.model,
        machine_name: createMHRDto.machineName,
        specification: createMHRDto.specification,
        shifts_per_day: createMHRDto.shiftsPerDay,
        hours_per_shift: createMHRDto.hoursPerShift,
        working_days_per_year: createMHRDto.workingDaysPerYear,
        planned_maintenance_hours_per_year: createMHRDto.plannedMaintenanceHoursPerYear,
        capacity_utilization_rate: createMHRDto.capacityUtilizationRate,
        landed_machine_cost: createMHRDto.landedMachineCost,
        accessories_cost_percentage: createMHRDto.accessoriesCostPercentage,
        installation_cost_percentage: createMHRDto.installationCostPercentage,
        payback_period_years: createMHRDto.paybackPeriodYears,
        interest_rate_percentage: createMHRDto.interestRatePercentage,
        insurance_rate_percentage: createMHRDto.insuranceRatePercentage,
        machine_footprint_sqm: createMHRDto.machineFootprintSqm,
        rent_per_sqm_per_month: createMHRDto.rentPerSqmPerMonth,
        maintenance_cost_percentage: createMHRDto.maintenanceCostPercentage,
        power_kwh_per_hour: createMHRDto.powerKwhPerHour,
        electricity_cost_per_kwh: createMHRDto.electricityCostPerKwh,
        admin_overhead_percentage: createMHRDto.adminOverheadPercentage,
        profit_margin_percentage: createMHRDto.profitMarginPercentage,
        is_manual_entry: createMHRDto.isManualEntry || false,
        // Kept in lockstep with total_machine_hour_rate (canonical Direct+
        // Indirect OH) rather than whatever the caller submitted, so the two
        // legacy fallback columns pickRate() can read never diverge from
        // the authoritative figure.
        manual_mhr_value: calculations.totalMachineHourRate || null,
        // India 2026 extended fields
        process_group: createMHRDto.processGroup || null,
        process_route: createMHRDto.processRoute || null,
        operation: createMHRDto.operation || null,
        machine_class: createMHRDto.machineClass || null,
        automation_level: createMHRDto.automationLevel || null,
        operators: createMHRDto.operators || null,
        wage_grade: createMHRDto.wageGrade || null,
        machine_price_usd: createMHRDto.machinePriceUsd || null,
        manufacturer_country: createMHRDto.manufacturerCountry || null,
        setup_time_hr: createMHRDto.setupTimeHr || null,
        lhr_inr_per_hr: createMHRDto.lhrInrPerHr || null,
        usd_labor_rate_per_hr: createMHRDto.usdLaborRatePerHr || null,
        usd_lhr_base: createMHRDto.usdLhrBase || null,
        usd_lhr_burden: createMHRDto.usdLhrBurden || null,
        usd_lhr_total: economicsFields.usd_lhr_total,
        direct_overhead_rate: economicsFields.direct_overhead_rate,
        indirect_overhead_rate: economicsFields.indirect_overhead_rate,
        direct_overhead_source: economicsFields.direct_overhead_source,
        indirect_overhead_source: economicsFields.indirect_overhead_source,
        labor_rate_source: economicsFields.labor_rate_source,
        benchmark_direct_overhead_rate_usd_hr: economicsFields.benchmark_direct_overhead_rate_usd_hr,
        benchmark_indirect_overhead_rate_usd_hr: economicsFields.benchmark_indirect_overhead_rate_usd_hr,
        benchmark_labor_rate_usd_hr: economicsFields.benchmark_labor_rate_usd_hr,
        benchmark_source_key: economicsFields.benchmark_source_key,
        economics_version: 1,
        economics_updated_at: new Date().toISOString(),
        economics_updated_by: userId,
        specs: createMHRDto.specs && Object.keys(createMHRDto.specs).length ? createMHRDto.specs : null,
        ...capability,
        capability_source: hasCapability ? 'imported' : null,
        capability_version: hasCapability ? 1 : null,
        capability_updated_at: hasCapability ? new Date().toISOString() : null,
        capability_updated_by: hasCapability ? userId : null,
        // Derived currency and USD rates from location
        currency:                    usdRates.currency,
        currency_symbol:             usdRates.currencySymbol,
        mhr_usd_per_hour:            usdRates.mhrUsdPerHour,
        fully_burdened_local_per_hr: usdRates.fullyBurdenedLocalPerHr,
        fully_burdened_usd_per_hr:   usdRates.fullyBurdenedUsdPerHr,
        total_machine_hour_rate: calculations.totalMachineHourRate,
        total_fixed_cost_per_hour: calculations.totalFixedCostPerHour,
        total_variable_cost_per_hour: calculations.totalVariableCostPerHour,
        total_annual_cost: calculations.totalAnnualCost,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating MHR record: ${error.message}`, 'MHRService');
      
      // Handle duplicate machine name constraint
      if (error.message.includes('duplicate key') && error.message.includes('machine_name')) {
        throw new ConflictException(
          'A machine with this name already exists in your workspace. Please choose a different machine name.'
        );
      }
      
      // Handle foreign key constraints
      if (error.message.includes('violates foreign key constraint')) {
        if (error.message.includes('user_id')) {
          throw new BadRequestException('User account is not valid. Please log in again.');
        }
      }
      
      // Handle validation constraints
      if (error.message.includes('violates check constraint')) {
        if (error.message.includes('positive_values')) {
          throw new BadRequestException('All cost and rate values must be positive numbers.');
        }
        if (error.message.includes('percentage_values')) {
          throw new BadRequestException('Percentage values must be between 0 and 100.');
        }
        if (error.message.includes('shifts_per_day_range')) {
          throw new BadRequestException('Shifts per day must be between 1 and 4.');
        }
        if (error.message.includes('hours_per_shift_range')) {
          throw new BadRequestException('Hours per shift must be between 1 and 24.');
        }
      }
      
      throw new InternalServerErrorException('Failed to create MHR record. Please check your input and try again.');
    }

    invalidateMachinePools(data.location);
    return MHRResponseDto.fromDatabase({ ...data, calculations: JSON.stringify(calculations) });
  }

  async update(id: string, updateMHRDto: UpdateMHRDto, userId: string, accessToken: string): Promise<MHRResponseDto> {
    this.logger.log(`Updating MHR record: ${id}`, 'MHRService');

    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format for update: ${id}`, 'MHRService');
      throw new BadRequestException('Invalid MHR record ID format provided. Please check the ID and try again.');
    }

    // Verify record exists
    const existing = await this.findOne(id, userId, accessToken);

    // Merge existing data with updates for calculation
    const mergedData = { ...this.mapRowToDto(existing), ...updateMHRDto };
    
    // Handle manual entry mode
    let calculations: MHRCalculationResult;
    if (updateMHRDto.isManualEntry && updateMHRDto.manualMHRValue) {
      this.logger.log(`Using manual MHR value for update: ${updateMHRDto.manualMHRValue}`, 'MHRService');
      // Previously called with no row at all — any real operational data already
      // stored on the existing record (or newly submitted in this update) was
      // silently discarded in favor of DEFAULTS. mergedData already combines
      // existing + this update's changes (see its own construction above).
      calculations = this.createManualEntryCalculation(updateMHRDto.manualMHRValue, {
        working_days_per_year: mergedData.workingDaysPerYear,
        shifts_per_day: mergedData.shiftsPerDay,
        hours_per_shift: mergedData.hoursPerShift,
        planned_maintenance_hours_per_year: mergedData.plannedMaintenanceHoursPerYear,
        capacity_utilization_rate: mergedData.capacityUtilizationRate,
      });
    } else {
      // Calculate all metrics using the engine
      calculations = this.calculateMHR(mergedData);
    }

    const updateData: any = {};
    if (updateMHRDto.location !== undefined) updateData.location = updateMHRDto.location;
    if (updateMHRDto.commodityCode !== undefined) updateData.commodity_code = updateMHRDto.commodityCode;
    if (updateMHRDto.machineDescription !== undefined) updateData.machine_description = updateMHRDto.machineDescription;
    if (updateMHRDto.manufacturer !== undefined) updateData.manufacturer = updateMHRDto.manufacturer;
    if (updateMHRDto.model !== undefined) updateData.model = updateMHRDto.model;
    if (updateMHRDto.machineName !== undefined) updateData.machine_name = updateMHRDto.machineName;
    if (updateMHRDto.specification !== undefined) updateData.specification = updateMHRDto.specification;
    if (updateMHRDto.shiftsPerDay !== undefined) updateData.shifts_per_day = updateMHRDto.shiftsPerDay;
    if (updateMHRDto.hoursPerShift !== undefined) updateData.hours_per_shift = updateMHRDto.hoursPerShift;
    if (updateMHRDto.workingDaysPerYear !== undefined) updateData.working_days_per_year = updateMHRDto.workingDaysPerYear;
    if (updateMHRDto.plannedMaintenanceHoursPerYear !== undefined) updateData.planned_maintenance_hours_per_year = updateMHRDto.plannedMaintenanceHoursPerYear;
    if (updateMHRDto.capacityUtilizationRate !== undefined) updateData.capacity_utilization_rate = updateMHRDto.capacityUtilizationRate;
    if (updateMHRDto.landedMachineCost !== undefined) updateData.landed_machine_cost = updateMHRDto.landedMachineCost;
    if (updateMHRDto.accessoriesCostPercentage !== undefined) updateData.accessories_cost_percentage = updateMHRDto.accessoriesCostPercentage;
    if (updateMHRDto.installationCostPercentage !== undefined) updateData.installation_cost_percentage = updateMHRDto.installationCostPercentage;
    if (updateMHRDto.paybackPeriodYears !== undefined) updateData.payback_period_years = updateMHRDto.paybackPeriodYears;
    if (updateMHRDto.interestRatePercentage !== undefined) updateData.interest_rate_percentage = updateMHRDto.interestRatePercentage;
    if (updateMHRDto.insuranceRatePercentage !== undefined) updateData.insurance_rate_percentage = updateMHRDto.insuranceRatePercentage;
    if (updateMHRDto.machineFootprintSqm !== undefined) updateData.machine_footprint_sqm = updateMHRDto.machineFootprintSqm;
    if (updateMHRDto.rentPerSqmPerMonth !== undefined) updateData.rent_per_sqm_per_month = updateMHRDto.rentPerSqmPerMonth;
    if (updateMHRDto.maintenanceCostPercentage !== undefined) updateData.maintenance_cost_percentage = updateMHRDto.maintenanceCostPercentage;
    if (updateMHRDto.powerKwhPerHour !== undefined) updateData.power_kwh_per_hour = updateMHRDto.powerKwhPerHour;
    if (updateMHRDto.electricityCostPerKwh !== undefined) updateData.electricity_cost_per_kwh = updateMHRDto.electricityCostPerKwh;
    if (updateMHRDto.adminOverheadPercentage !== undefined) updateData.admin_overhead_percentage = updateMHRDto.adminOverheadPercentage;
    if (updateMHRDto.profitMarginPercentage !== undefined) updateData.profit_margin_percentage = updateMHRDto.profitMarginPercentage;
    if (updateMHRDto.isManualEntry !== undefined) updateData.is_manual_entry = updateMHRDto.isManualEntry;
    // manual_mhr_value is set later, unconditionally, from the canonical
    // Direct+Indirect total — never taken directly from the DTO (see below).
    // India 2026 extended fields
    if (updateMHRDto.processGroup !== undefined) updateData.process_group = updateMHRDto.processGroup;
    if (updateMHRDto.processRoute !== undefined) updateData.process_route = updateMHRDto.processRoute;
    if (updateMHRDto.operation !== undefined) updateData.operation = updateMHRDto.operation;
    if (updateMHRDto.machineClass !== undefined) updateData.machine_class = updateMHRDto.machineClass;
    if (updateMHRDto.automationLevel !== undefined) updateData.automation_level = updateMHRDto.automationLevel;
    if (updateMHRDto.operators !== undefined) updateData.operators = updateMHRDto.operators;
    if (updateMHRDto.wageGrade !== undefined) updateData.wage_grade = updateMHRDto.wageGrade;
    if (updateMHRDto.machinePriceUsd !== undefined) updateData.machine_price_usd = updateMHRDto.machinePriceUsd;
    if (updateMHRDto.manufacturerCountry !== undefined) updateData.manufacturer_country = updateMHRDto.manufacturerCountry;
    if (updateMHRDto.setupTimeHr !== undefined) updateData.setup_time_hr = updateMHRDto.setupTimeHr;
    if (updateMHRDto.lhrInrPerHr !== undefined) updateData.lhr_inr_per_hr = updateMHRDto.lhrInrPerHr;
    if (updateMHRDto.usdLaborRatePerHr !== undefined) updateData.usd_labor_rate_per_hr = updateMHRDto.usdLaborRatePerHr;
    if (updateMHRDto.usdLhrBase !== undefined) updateData.usd_lhr_base = updateMHRDto.usdLhrBase;
    if (updateMHRDto.usdLhrBurden !== undefined) updateData.usd_lhr_burden = updateMHRDto.usdLhrBurden;
    // Economics provenance: a value explicitly present in this PATCH is a
    // human confirming it right now, so it's always 'shop_override' — never
    // a benchmark lookup on update (that only applies to a brand-new record
    // via resolveEconomicsForCreate). An explicit null clears both the value
    // and its source, rather than mislabeling "cleared" as "shop-confirmed".
    let economicsTouched = false;
    if (updateMHRDto.usdLhrTotal !== undefined) {
      updateData.usd_lhr_total = updateMHRDto.usdLhrTotal;
      updateData.labor_rate_source = updateMHRDto.usdLhrTotal != null ? 'shop_override' : null;
      economicsTouched = true;
    }
    if (updateMHRDto.directOverheadRate !== undefined) {
      updateData.direct_overhead_rate = updateMHRDto.directOverheadRate;
      updateData.direct_overhead_source = updateMHRDto.directOverheadRate != null ? 'shop_override' : null;
      economicsTouched = true;
    }
    if (updateMHRDto.indirectOverheadRate !== undefined) {
      updateData.indirect_overhead_rate = updateMHRDto.indirectOverheadRate;
      updateData.indirect_overhead_source = updateMHRDto.indirectOverheadRate != null ? 'shop_override' : null;
      economicsTouched = true;
    }
    if (economicsTouched) {
      updateData.economics_version = ((existing as any).economicsVersion ?? 0) + 1;
      updateData.economics_updated_at = new Date().toISOString();
      updateData.economics_updated_by = userId;
    }

    if (updateMHRDto.specs !== undefined) {
      updateData.specs = updateMHRDto.specs && Object.keys(updateMHRDto.specs).length ? updateMHRDto.specs : null;
    }

    // Machine capability — a value explicitly present in this PATCH is a
    // human confirming it right now, tagged 'imported' (same convention as
    // create(), matching the Excel-import path's own capability tagging —
    // real is real regardless of which of the three write paths it came
    // through). Bumps capability_version, mirroring economics_version above.
    let capabilityTouched = false;
    const capabilityFieldMap: Array<[keyof UpdateMHRDto, string]> = [
      ['maxXMm', 'max_x_mm'], ['maxYMm', 'max_y_mm'], ['maxZMm', 'max_z_mm'],
      ['maxDiameterMm', 'max_diameter_mm'], ['maxLengthMm', 'max_length_mm'],
      ['maxTonnage', 'max_tonnage'], ['maxThicknessMm', 'max_thickness_mm'],
      ['maxWorkpieceWeightKg', 'max_workpiece_weight_kg'], ['powerKw', 'power_kw'],
      ['maxThicknessMsMm', 'max_thickness_ms_mm'], ['maxThicknessSsMm', 'max_thickness_ss_mm'],
      ['maxThicknessAlMm', 'max_thickness_al_mm'], ['maxThicknessCuMm', 'max_thickness_cu_mm'],
    ];
    for (const [dtoKey, column] of capabilityFieldMap) {
      if (updateMHRDto[dtoKey] !== undefined) {
        (updateData as any)[column] = updateMHRDto[dtoKey];
        capabilityTouched = true;
      }
    }
    if (updateMHRDto.cuttableMaterials !== undefined) {
      updateData.cuttable_materials = updateMHRDto.cuttableMaterials?.length ? updateMHRDto.cuttableMaterials : null;
      capabilityTouched = true;
    }
    if (capabilityTouched) {
      updateData.capability_source = 'imported';
      updateData.capability_version = ((existing as any).capabilityVersion ?? 0) + 1;
      updateData.capability_updated_at = new Date().toISOString();
      updateData.capability_updated_by = userId;
    }

    // Recompute currency and USD rates based on (possibly updated) location
    const effectiveLocation = updateMHRDto.location ?? existing.location;
    const effectiveLhrInr   = updateMHRDto.lhrInrPerHr ?? (existing as any).lhrInrPerHr ?? null;
    const effectiveUsdLhr   = updateMHRDto.usdLhrTotal ?? (existing as any).usdLhrTotal ?? null;
    const rates = await this.exchangeRateService.getSnapshot(accessToken);

    // Canonical MHR (2026-08-27 decision): Machine Hour Rate = Total Overhead
    // = Direct OH + Indirect OH, always — mirrors create()'s override above.
    // `existing.directOverheadRate`/`indirectOverheadRate` are already
    // resolved (real value OR benchmark), collapsing to `undefined` only for
    // a true 'no_rate' (economics-resolver.ts) — so distinguishing
    // "real/benchmark data on file" from "nothing on file at all" requires
    // the *source* tag, not just the value. When this PATCH doesn't touch a
    // field, the effective raw input for resolveMachineEconomics must be the
    // ORIGINAL raw column (only equal to existing.directOverheadRate when
    // its source was genuinely 'shop_override'/'imported' — a 'benchmark'-
    // sourced existing value is a resolved number, not a raw one, and must
    // be re-derived from benchmarkDirectOverheadRateUsdHr instead).
    const isDirectRealExisting = existing.directOverheadSource === 'shop_override' || existing.directOverheadSource === 'imported';
    const isIndirectRealExisting = existing.indirectOverheadSource === 'shop_override' || existing.indirectOverheadSource === 'imported';
    const effectiveDirectRaw = updateMHRDto.directOverheadRate !== undefined
      ? updateMHRDto.directOverheadRate ?? null
      : (isDirectRealExisting ? existing.directOverheadRate ?? null : null);
    const effectiveDirectSource = updateMHRDto.directOverheadRate !== undefined
      ? (updateMHRDto.directOverheadRate != null ? 'shop_override' : null)
      : (isDirectRealExisting ? existing.directOverheadSource : null);
    const effectiveIndirectRaw = updateMHRDto.indirectOverheadRate !== undefined
      ? updateMHRDto.indirectOverheadRate ?? null
      : (isIndirectRealExisting ? existing.indirectOverheadRate ?? null : null);
    const effectiveIndirectSource = updateMHRDto.indirectOverheadRate !== undefined
      ? (updateMHRDto.indirectOverheadRate != null ? 'shop_override' : null)
      : (isIndirectRealExisting ? existing.indirectOverheadSource : null);

    const resolvedForTotal = resolveMachineEconomics({
      direct_overhead_rate: effectiveDirectRaw,
      direct_overhead_source: effectiveDirectSource,
      indirect_overhead_rate: effectiveIndirectRaw,
      indirect_overhead_source: effectiveIndirectSource,
      usd_lhr_total: null,
      labor_rate_source: null,
      benchmark_direct_overhead_rate_usd_hr: (existing as any).benchmarkDirectOverheadRateUsdHr ?? null,
      benchmark_indirect_overhead_rate_usd_hr: (existing as any).benchmarkIndirectOverheadRateUsdHr ?? null,
      benchmark_labor_rate_usd_hr: null,
    });

    const existingTotalLocal = Number((existing as any).calculations?.totalMachineHourRate ?? 0);
    // No fabrication (2026-08-30): EITHER component missing (economics-
    // resolver.ts's 'no_rate' tier, value: null) means the total can't be
    // truthfully computed — a partial zero-fill (real direct + fabricated-
    // zero indirect) is exactly as dishonest as fabricating both.
    const noRealOverheadDataAnywhere =
      resolvedForTotal.directOverheadRate.value == null ||
      resolvedForTotal.indirectOverheadRate.value == null;

    if (noRealOverheadDataAnywhere && existingTotalLocal > 0) {
      // Documented gap (e.g. the pre-2026-08-27 seed rows with a real,
      // deliberately-entered MHR but no Direct/Indirect breakdown ever
      // captured) — preserve the existing total rather than fabricating a
      // breakdown or silently zeroing a real, currently-quoted rate. Real
      // quote costing for this row is unaffected by this update.
      calculations.totalMachineHourRate = existingTotalLocal;
      this.logger.warn(
        `MHR update ${id}: no Direct/Indirect overhead on file — preserving existing total_machine_hour_rate=${existingTotalLocal} instead of deriving $0`,
        'MHRService',
      );
    } else if (noRealOverheadDataAnywhere) {
      // No existing positive total to fall back on either — refuse rather
      // than persist a fabricated $0 (this row's frontend already blocks
      // this in the common case; this closes the gap for any other caller).
      const missingOverhead: string[] = [];
      if (resolvedForTotal.directOverheadRate.value == null) missingOverhead.push('Direct Overhead Rate');
      if (resolvedForTotal.indirectOverheadRate.value == null) missingOverhead.push('Indirect Overhead Rate');
      throw new BadRequestException(
        `No real value or industry benchmark data exists for: ${missingOverhead.join(' and ')}. ` +
        `Enter the missing rate(s) manually before saving — Machine Hour Rate cannot be updated to a fabricated $0.`,
      );
    } else {
      const { currency: updCurrency } = getCurrencyForLocation(effectiveLocation);
      const updUsdPerLocal = rates.convertStrict(updCurrency, 'USD');
      // Both guaranteed non-null here (noRealOverheadDataAnywhere is false).
      const totalOhUsd = resolvedForTotal.directOverheadRate.value! + resolvedForTotal.indirectOverheadRate.value!;
      calculations.totalMachineHourRate = Math.round((totalOhUsd / updUsdPerLocal) * 100) / 100;
    }

    const usdRates = this.computeUsdAndBurdenedRates(
      calculations.totalMachineHourRate,
      effectiveLocation,
      rates,
      effectiveLhrInr,
      effectiveUsdLhr,
    );
    updateData.currency                    = usdRates.currency;
    updateData.currency_symbol             = usdRates.currencySymbol;
    updateData.mhr_usd_per_hour            = usdRates.mhrUsdPerHour;
    updateData.fully_burdened_local_per_hr = usdRates.fullyBurdenedLocalPerHr;
    updateData.fully_burdened_usd_per_hr   = usdRates.fullyBurdenedUsdPerHr;

    // Update calculated values
    updateData.total_machine_hour_rate = calculations.totalMachineHourRate;
    // Kept in lockstep with total_machine_hour_rate — see create()'s
    // identical rationale.
    updateData.manual_mhr_value = calculations.totalMachineHourRate || null;
    updateData.total_fixed_cost_per_hour = calculations.totalFixedCostPerHour;
    updateData.total_variable_cost_per_hour = calculations.totalVariableCostPerHour;
    updateData.total_annual_cost = calculations.totalAnnualCost;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating MHR record: ${error.message}`, 'MHRService');
      
      // Handle concurrent update conflicts
      if (error.message.includes('row was updated by another user')) {
        throw new ConflictException(
          'This MHR record has been modified by another user. Please refresh and try again.'
        );
      }
      
      // Handle duplicate machine name constraint
      if (error.message.includes('duplicate key') && error.message.includes('machine_name')) {
        throw new ConflictException(
          'A machine with this name already exists in your workspace. Please choose a different machine name.'
        );
      }
      
      // Handle validation constraints
      if (error.message.includes('violates check constraint')) {
        if (error.message.includes('positive_values')) {
          throw new BadRequestException('All cost and rate values must be positive numbers.');
        }
        if (error.message.includes('percentage_values')) {
          throw new BadRequestException('Percentage values must be between 0 and 100.');
        }
      }
      
      throw new InternalServerErrorException('Failed to update MHR record. Please verify your input and try again.');
    }

    invalidateMachinePools(data.location);
    return MHRResponseDto.fromDatabase({ ...data, calculations: JSON.stringify(calculations) });
  }

  async remove(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting MHR record: ${id}`, 'MHRService');

    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format for delete: ${id}`, 'MHRService');
      throw new BadRequestException('Invalid MHR record ID format provided. Please check the ID and try again.');
    }

    await this.findOne(id, userId, accessToken);

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting MHR record: ${error.message}`, 'MHRService');
      
      // Handle foreign key constraint violations (MHR record referenced elsewhere)
      if (error.message.includes('violates foreign key constraint')) {
        throw new ConflictException(
          'This MHR record cannot be deleted as it is being used in other calculations or processes. Please remove those references first.'
        );
      }
      
      throw new InternalServerErrorException('Failed to delete MHR record. Please try again later.');
    }

    invalidateMachinePools();
    return { message: 'MHR record deleted successfully' };
  }

  async importFromExcel(
    fileBuffer: Buffer,
    userId: string,
    accessToken: string,
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    this.logger.log(`Importing MHR records from Excel for user ${userId}`, 'MHRService');

    // Loaded once for the whole import — every row's USD→local conversion below
    // reads from this live DB-backed rate map, never a hardcoded FX table.
    const importRates = await this.exchangeRateService.getSnapshot(accessToken);
    const missingRateCurrencies = new Set<string>();
    // Populated per-sheet below (shiftsCol etc. are scoped inside the sheet
    // loop) — aggregated here so one disclosure covers every sheet processed.
    const missingOperationalColsSet = new Set<string>();

    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength,
    ) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);

    // Sheet name → commodity code for the multi-sheet eMithran format
    const SHEET_COMMODITY: Record<string, string> = {
      '01_machining': 'CNC Machining', '02_sheet_metal': 'Sheet Metal',
      '03_die_casting': 'Die Casting', '04_invest_cast': 'Investment Casting',
      '05_sand_casting': 'Sand Casting', '06_forging': 'Forging',
      '07_additive': 'Additive Manufacturing', '08_plastic_mold': 'Plastic Molding',
      '09_heat_treat': 'Heat Treatment', '10_pcb': 'PCB Manufacturing',
      '11_composites': 'Composites', '12_surface_treat': 'Surface Treatment',
      '13_powder_metal': 'Powder Metallurgy', '14_assembly': 'Assembly',
      '15_bar_tube': 'Bar & Tube Fabrication', '16_roto_blow': 'Roto & Blow Molding',
      '17_sheet_plastic': 'Sheet Plastic', '18_rapid_proto': 'Rapid Prototyping',
    };

    // Collect candidate sheets: explicit "MHR" names first, then numbered process sheets
    const namedSheet = workbook.worksheets.find(ws =>
      ['mhr', 'machine hour rate', 'machine hour rates'].includes(ws.name.toLowerCase().trim())
    );
    const processSheets = workbook.worksheets.filter(ws =>
      /^\d{2}_/.test(ws.name.trim()) && ws.name.toLowerCase().trim() !== '00_index'
    );
    // Fallback: if no named or process sheets found, try all sheets (Combined format)
    const sheetsToProcess = namedSheet ? [namedSheet]
      : processSheets.length > 0 ? processSheets
      : workbook.worksheets;

    if (sheetsToProcess.length === 0) {
      this.logger.log('No MHR sheet found in Excel file — skipping MHR import', 'MHRService');
      return { imported: 0, skipped: 0, errors: [] };
    }

    const toNum = (v: ExcelJS.CellValue, fallback: number): number => {
      if (v == null) return fallback;
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      return isNaN(n) ? fallback : n;
    };
    const toStr = (v: ExcelJS.CellValue, fallback = ''): string =>
      v != null ? String(v).trim() : fallback;

    const rows: any[] = [];

    for (const sheet of sheetsToProcess) {
      const sheetKey = sheet.name.toLowerCase().trim();
      const commodityFromSheet = SHEET_COMMODITY[sheetKey] ?? sheetKey;

      // Build header → column-number map from row 1
      const colMap: Record<string, number> = {};
      sheet.getRow(1).eachCell((cell, colNum) => {
        const h = toStr(cell.value).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (h) colMap[h] = colNum;
      });

      const getCol = (...keys: string[]): number | null => {
        for (const k of keys) if (colMap[k] !== undefined) return colMap[k];
        return null;
      };

      // Support both standard format ("Machine Name") and eMithran multi-sheet format ("Primary ID")
      const machineNameCol      = getCol('machine name', 'primary id', 'name');
      if (!machineNameCol) continue;

      // Detect Combined_All_Countries format by presence of overhead breakdown columns
      const isCombinedFormat = colMap['direct overhead rate'] !== undefined && colMap['indirect overhead rate'] !== undefined;

      const locationCol         = getCol('location', 'manufacturer information', 'machine manufacturer location', 's');
      const commodityCodeCol    = getCol('commodity code');
      const machineDescCol      = getCol('machine description', 'other id', 'description');
      const manufacturerCol     = getCol('manufacturer');
      const modelCol            = getCol('model');
      const specCol             = getCol('specification');
      const shiftsCol           = getCol('shifts day', 'shifts per day', 'shifts_per_day');
      const hoursCol            = getCol('hours shift', 'hours per shift', 'hours_per_shift');
      const daysCol             = getCol('working days year', 'working days per year', 'working_days_per_year');
      const maintHoursCol       = getCol('planned maint hours year', 'planned maintenance hours year', 'maintenance_hours_per_year', 'maintenance hours year');
      const utilCol             = getCol('capacity utilization', 'capacity utilization rate', 'avg utilization', 'yields', 'capacity_utilization_pct');
      const landedCostCol       = getCol('landed machine cost local', 'landed machine cost', 'landed cost', 'bottom up over', 'landed_machine_cost_inr');
      const accessoriesCol      = getCol('accessories cost 6 local', 'accessories cost', 'accessories_pct');
      const installationCol     = getCol('installation cost 20 local', 'installation cost', 'installation_pct');
      const paybackCol          = getCol('payback period yrs', 'payback period years', 'payback period', 'payback_years');
      const interestCol         = getCol('interest rate', 'interest_rate_pct');
      const insuranceCol        = getCol('insurance rate', 'insurance_rate_pct');
      const footprintCol        = getCol('machine footprint m', 'machine footprint sqm', 'machine footprint', 'machine_footprint_m2');
      const rentCol             = getCol('rent per m per month local', 'rent sqm month', 'rent per sqm per month', 'rent_per_m2_per_month_inr');
      const maintenanceCol      = getCol('maintenance cost', 'maintenance_cost_pct');
      // Disclosed, not silent — see missingOperationalColsSet's declaration above.
      if (!shiftsCol) missingOperationalColsSet.add('shifts/day');
      if (!hoursCol) missingOperationalColsSet.add('hours/shift');
      if (!daysCol) missingOperationalColsSet.add('working days/yr');
      if (!accessoriesCol) missingOperationalColsSet.add('accessories cost %');
      if (!installationCol) missingOperationalColsSet.add('installation cost %');
      if (!paybackCol) missingOperationalColsSet.add('payback period (yrs)');
      if (!interestCol) missingOperationalColsSet.add('interest rate %');
      if (!insuranceCol) missingOperationalColsSet.add('insurance rate %');
      if (!maintenanceCol) missingOperationalColsSet.add('maintenance cost %');
      const powerCol            = getCol('power kwh per hour', 'power kwh hr', 'spindle power kw', 'powers', 'power_kwh_per_hour');
      const electricityCol      = getCol('electricity cost per kwh local', 'electricity cost kwh', 'electricity cost per kwh', 'electricity_cost_per_kwh_inr');
      const adminCol            = getCol('admin overhead', 'admin_overhead_pct');
      const profitCol           = getCol('profit margin', 'profit_margin_pct');
      const mhrValueCol         = getCol('mhr local hour', 'mhr local hr', 'mhr hour', 'mhr', 'mhr value', 'mhr_inr_per_hour', 'accounting', 'labour rate', 'total overhead rate');
      // Combined format overhead breakdown columns
      const directOverheadCol   = getCol('direct overhead rate');
      const indirectOverheadCol = getCol('indirect overhead rate');
      // India 2026 extended columns
      const processGroupCol     = getCol('process group', 'process_group', 'process goup');
      const processCategoryCol  = getCol('process category', 'process_category');
      const machineClassCol     = getCol('machine class', 'machine_class', 'process sequence');
      const automationLevelCol  = getCol('automation level', 'automation_level');
      const operatorsCol        = getCol('operators');
      const wageGradeCol        = getCol('wage grade', 'wage_grade');
      const machinePriceUsdCol  = getCol('machine price usd', 'machine_price_usd', 'machine price');
      const mfrCountryCol       = getCol('manufacturer country', 'manufacturer_country');
      const setupTimeCol        = getCol('setup time hr', 'setup_time_hr');
      const lhrInrCol           = getCol('lhr local hr', 'lhr hr india', 'lhr inr hr', 'lhr_inr_per_hr_india', 'lhr_inr_per_hour');
      // USD LHR columns embedded in the MHR sheet
      const usdLaborRateCol     = getCol('labor rate usd hr', 'labor rate usd hr person', 'usd labor rate', 'labor_rate_usd_per_hr');
      const usdLhrBaseCol       = getCol('lhr base usd hr', 'usd lhr base', 'lhr_base_usd_per_hr');
      const usdLhrBurdenCol     = getCol('lhr burden 38 usd hr', 'usd lhr burden', 'lhr_burden_38pct_usd_per_hr');
      const usdLhrTotalCol      = getCol('lhr total usd hr', 'usd lhr total', 'lhr_total_usd_per_hr', 'skill based labor rate');
      // Multi-currency and fully-burdened rate columns (new combined format)
      const currencyCol              = getCol('currency');
      const currencySymbolCol        = getCol('currency symbol');
      const lhrUsdEffectiveCol       = getCol('lhr usd hr', 'lhr usd hour');
      const mhrUsdCol                = getCol('mhr usd hour', 'mhr usd hr');
      const fullyBurdenedLocalCol    = getCol('fully burdened rate incl labor local hr');
      const fullyBurdenedUsdCol      = getCol('fully burdened rate incl labor usd hr');
      // Per-hour breakdown columns for calculations JSONB
      const depPerHrCol          = getCol('depreciation local hr');
      const intPerHrCol          = getCol('interest local hr');
      const insPerHrCol          = getCol('insurance local hr');
      const rentPerHrCol2        = getCol('rent local hr');
      const costOfOwnPerHrCol    = getCol('cost of ownership local hr');
      const mroPerHrCol          = getCol('mro local hr');
      const elecPerHrCol         = getCol('electricity local hr');
      const totalOpCostPerHrCol  = getCol('total operating cost local hr');
      // Per-annum breakdown columns
      const depPaCol             = getCol('depreciation p a local');
      const intPaCol             = getCol('interest on capital p a local');
      const insPaCol             = getCol('insurance p a local');
      const rentPaCol            = getCol('rent p a local');
      const mroPaCol             = getCol('mro consumables p a local');
      const elecPaCol            = getCol('electricity cost p a local');
      const totalHrsYrCol        = getCol('total hours year', 'total hrs year');
      const availHrsYrCol        = getCol('available hours year');
      const effectiveHrsCol      = getCol('effective hours cycle time', 'effective hours');
      const accsCostLocCol       = getCol('accessories cost 6 local');
      const instCostLocCol       = getCol('installation cost 20 local');
      const totalCapInvCol       = getCol('total capital investment local');
      const capacityUnitCol      = getCol('capacity unit');
      const floorAreaCol         = getCol('floor area sqft');
      // Machine capability columns (optional — physics-based machine selection)
      const maxXCol             = getCol('max x mm', 'max x', 'bed length mm');
      const maxYCol             = getCol('max y mm', 'max y', 'bed width mm');
      const maxZCol             = getCol('max z mm', 'max z', 'bed height mm');
      const maxDiaCol           = getCol('max diameter mm', 'max diameter', 'swing mm');
      const maxLenCol           = getCol('max length mm', 'max length', 'bend length mm');
      const maxTonnageCol       = getCol('max tonnage', 'tonnage');
      const maxThicknessCol     = getCol('max thickness mm', 'max thickness');
      const maxWeightCol        = getCol('max workpiece weight kg', 'max workpiece weight', 'table load kg');
      const powerKwCol          = getCol('power kw', 'laser power kw', 'spindle power kw');
      const thkMsCol            = getCol('max thickness ms mm', 'max thickness ms');
      const thkSsCol            = getCol('max thickness ss mm', 'max thickness ss');
      const thkAlCol            = getCol('max thickness al mm', 'max thickness al');
      const thkCuCol            = getCol('max thickness cu mm', 'max thickness cu');
      const cuttableMatsCol     = getCol('cuttable materials', 'material grades');
      // Availability columns (optional)
      const availStatusCol      = getCol('availability status', 'availability');
      const nextAvailCol        = getCol('next available at', 'next available');
      const schedLoadCol        = getCol('scheduled load', 'scheduled load pct');
      const maintStartCol       = getCol('maintenance window start');
      const maintEndCol         = getCol('maintenance window end');
      // specs sub-columns (optional)
      const maxCapacityCol      = getCol('max capacity', 'max_capacity');
      const toleranceCol        = getCol('tolerance mm', 'tolerance_mm');
      const raCol               = getCol('surface finish ra um', 'surface_finish_ra_um');
      const materialsCol        = getCol('material compatibility', 'material_compatibility');
      const applicationsCol     = getCol('typical applications', 'typical_applications');
      const processNotesCol     = getCol('process notes', 'process_notes');
      // Generic catch-all: any machine-category-specific field that doesn't have
      // its own dedicated column (press_force_kn, roll_working_length_mm, bed
      // dimensions, etc. — see memory/sheetmetal/machine/machine_library.json)
      // rides through as one JSON blob per row, merged into specs below. This is
      // the durable, re-importable counterpart to one-off SQL backfills: any
      // future re-export of machine_library.json that includes this column
      // carries its full category-specific data through import automatically.
      const specsJsonCol        = getCol('specs json', 'specs_json', 'machine specs json');

      let isHeaderRow = true;
      sheet.eachRow(row => {
        if (isHeaderRow) { isHeaderRow = false; return; }

        const machineName = toStr(row.getCell(machineNameCol).value);
        if (!machineName) return;

        const mhrRaw = mhrValueCol ? row.getCell(mhrValueCol).value : null;
        const mhrNum = mhrRaw != null ? parseFloat(String(mhrRaw).replace(/[^0-9.-]/g, '')) : NaN;

        // Skip sub-header rows (row 2 in eMithran sheets has labels like "Name", "Labor Rate (USD/hr)")
        // Detected by: mhrValueCol exists but cell is a non-numeric string
        if (mhrValueCol && typeof mhrRaw === 'string' && isNaN(mhrNum)) return;

        const isManual = mhrValueCol !== null && !isNaN(mhrNum) && mhrNum > 0;
        const rawLandedCost = landedCostCol ? toNum(row.getCell(landedCostCol).value, 0) : 0;
        const rawMachinePriceUsd = machinePriceUsdCol ? toNum(row.getCell(machinePriceUsdCol).value, 0) : 0;

        // Derive utilization: eMithran stores it as 0-1 fraction, convert to percentage
        let utilRaw = utilCol ? toNum(row.getCell(utilCol).value, 0.85) : 0.85;
        if (utilRaw > 0 && utilRaw <= 1) utilRaw = utilRaw * 100; // 0.5 → 50%

        const processGroupVal = processGroupCol ? toStr(row.getCell(processGroupCol).value) || commodityFromSheet : commodityFromSheet;
        const specsObj: Record<string, any> = {};
        if (maxCapacityCol)   { const v = toStr(row.getCell(maxCapacityCol).value);   if (v) specsObj.max_capacity = v; }
        if (toleranceCol)     { const v = toNum(row.getCell(toleranceCol).value, 0);  if (v) specsObj.tolerance_mm = v; }
        if (raCol)            { const v = toNum(row.getCell(raCol).value, 0);          if (v) specsObj.surface_finish_ra_um = v; }
        if (materialsCol)     { const v = toStr(row.getCell(materialsCol).value);      if (v) specsObj.material_compatibility = v; }
        if (applicationsCol)  { const v = toStr(row.getCell(applicationsCol).value);   if (v) specsObj.typical_applications = v; }
        if (processNotesCol)  { const v = toStr(row.getCell(processNotesCol).value);   if (v) specsObj.process_notes = v; }
        if (specsJsonCol) {
          const raw = toStr(row.getCell(specsJsonCol).value);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(specsObj, parsed);
            } catch {
              this.logger.warn(
                `${machineName}: Specs JSON column contains invalid JSON — ignored: ${raw.slice(0, 80)}`,
                'MHRService.importFromExcel',
              );
            }
          }
        }

        const preCalcValues = (depPerHrCol || intPerHrCol || mhrUsdCol) ? {
          depPerHr:       depPerHrCol ? toNum(row.getCell(depPerHrCol).value, 0) : 0,
          intPerHr:       intPerHrCol ? toNum(row.getCell(intPerHrCol).value, 0) : 0,
          insPerHr:       insPerHrCol ? toNum(row.getCell(insPerHrCol).value, 0) : 0,
          rentPerHr:      rentPerHrCol2 ? toNum(row.getCell(rentPerHrCol2).value, 0) : 0,
          costOfOwnPerHr: costOfOwnPerHrCol ? toNum(row.getCell(costOfOwnPerHrCol).value, 0) : 0,
          mroPerHr:       mroPerHrCol ? toNum(row.getCell(mroPerHrCol).value, 0) : 0,
          elecPerHr:      elecPerHrCol ? toNum(row.getCell(elecPerHrCol).value, 0) : 0,
          totalOpCostPerHr: totalOpCostPerHrCol ? toNum(row.getCell(totalOpCostPerHrCol).value, 0) : 0,
          depPa:          depPaCol ? toNum(row.getCell(depPaCol).value, 0) : 0,
          intPa:          intPaCol ? toNum(row.getCell(intPaCol).value, 0) : 0,
          insPa:          insPaCol ? toNum(row.getCell(insPaCol).value, 0) : 0,
          rentPa:         rentPaCol ? toNum(row.getCell(rentPaCol).value, 0) : 0,
          mroPa:          mroPaCol ? toNum(row.getCell(mroPaCol).value, 0) : 0,
          elecPa:         elecPaCol ? toNum(row.getCell(elecPaCol).value, 0) : 0,
          totalHrsPerYear:  totalHrsYrCol ? toNum(row.getCell(totalHrsYrCol).value, 0) : 0,
          availHrsPerYear:  availHrsYrCol ? toNum(row.getCell(availHrsYrCol).value, 0) : 0,
          effectiveHrs:     effectiveHrsCol ? toNum(row.getCell(effectiveHrsCol).value, 0) : 0,
          accsCost:       accsCostLocCol ? toNum(row.getCell(accsCostLocCol).value, 0) : 0,
          instCost:       instCostLocCol ? toNum(row.getCell(instCostLocCol).value, 0) : 0,
          totalCapInv:    totalCapInvCol ? toNum(row.getCell(totalCapInvCol).value, 0) : 0,
          mhrUsd:         mhrUsdCol ? toNum(row.getCell(mhrUsdCol).value, 0) : 0,
          fullyBurdenedLocal: fullyBurdenedLocalCol ? toNum(row.getCell(fullyBurdenedLocalCol).value, 0) : 0,
          fullyBurdenedUsd: fullyBurdenedUsdCol ? toNum(row.getCell(fullyBurdenedUsdCol).value, 0) : 0,
        } : null;

        if (capacityUnitCol) { const v = toStr(row.getCell(capacityUnitCol).value); if (v) specsObj.capacity_unit = v; }
        if (floorAreaCol)    { const v = toNum(row.getCell(floorAreaCol).value, 0);  if (v) specsObj.floor_area_sqft = v; }

        // Capability columns — nullable; any populated value marks the row 'imported'
        const capNum = (col: number | null): number | null => {
          if (!col) return null;
          const v = toNum(row.getCell(col).value, 0);
          return v > 0 ? v : null;
        };
        const capability = {
          max_x_mm:                capNum(maxXCol),
          max_y_mm:                capNum(maxYCol),
          max_z_mm:                capNum(maxZCol),
          max_diameter_mm:         capNum(maxDiaCol),
          max_length_mm:           capNum(maxLenCol),
          max_tonnage:             capNum(maxTonnageCol),
          max_thickness_mm:        capNum(maxThicknessCol),
          max_workpiece_weight_kg: capNum(maxWeightCol),
          power_kw:                capNum(powerKwCol),
          max_thickness_ms_mm:     capNum(thkMsCol),
          max_thickness_ss_mm:     capNum(thkSsCol),
          max_thickness_al_mm:     capNum(thkAlCol),
          max_thickness_cu_mm:     capNum(thkCuCol),
          cuttable_materials:      cuttableMatsCol
            ? (toStr(row.getCell(cuttableMatsCol).value).split(',').map(s => s.trim()).filter(Boolean) as string[])
            : null,
        };
        if (capability.cuttable_materials?.length === 0) capability.cuttable_materials = null;
        const hasCapability = Object.values(capability).some(v => v != null);

        const availabilityStatusRaw = availStatusCol ? toStr(row.getCell(availStatusCol).value).toLowerCase() : '';
        const VALID_AVAILABILITY = ['available', 'maintenance', 'down', 'retired', 'commissioning'];
        const toIso = (col: number | null): string | null => {
          if (!col) return null;
          const v = row.getCell(col).value;
          if (v instanceof Date) return v.toISOString();
          const d = v != null ? new Date(String(v)) : null;
          return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
        };

        const locationVal = locationCol ? toStr(row.getCell(locationCol).value, 'India') || 'India' : 'India';
        const currencyVal = currencyCol ? toStr(row.getCell(currencyCol).value) || null : null;
        // If Excel has no local landed cost column, derive from USD machine price × location FX
        // rate — read live from exchange_rates (loaded once above), never a hardcoded table.
        const { currency: locCurrency, symbol: locSymbol } = getCurrencyForLocation(locationVal);
        const localPerUsd = importRates.convertOptional('USD', locCurrency);
        if (localPerUsd == null) missingRateCurrencies.add(locCurrency);
        const landedCost = rawLandedCost > 0
          ? rawLandedCost
          : (rawMachinePriceUsd > 0 && localPerUsd != null ? Math.round(rawMachinePriceUsd * localPerUsd) : 0);

        // Reconcile USD LHR: prefer computed base+burden sum over the raw column value
        const rawUsdLhrBase   = usdLhrBaseCol   ? toNum(row.getCell(usdLhrBaseCol).value,   0) || null : null;
        const rawUsdLhrBurden = usdLhrBurdenCol ? toNum(row.getCell(usdLhrBurdenCol).value, 0) || null : null;
        const rawUsdLhrTotal  = usdLhrTotalCol  ? toNum(row.getCell(usdLhrTotalCol).value,  0) || null : null;
        const computedLhrTotal = (rawUsdLhrBase && rawUsdLhrBurden) ? rawUsdLhrBase + rawUsdLhrBurden : null;
        const reconciledLhrTotal = computedLhrTotal ?? rawUsdLhrTotal;

        const rawLhrUsdEffective = lhrUsdEffectiveCol ? toNum(row.getCell(lhrUsdEffectiveCol).value, 0) || null : null;
        // If "lhr usd hr" and the computed base+burden total differ by >15%, log a warning
        if (rawLhrUsdEffective && reconciledLhrTotal && Math.abs(rawLhrUsdEffective - reconciledLhrTotal) / reconciledLhrTotal > 0.15) {
          this.logger.warn(
            `${machineName} (${locationVal}): lhr_usd_effective=${rawLhrUsdEffective} vs base+burden=${reconciledLhrTotal.toFixed(2)} — using base+burden as authoritative total`,
            'MHRService.importFromExcel',
          );
        }
        // Use reconciledLhrTotal as lhr_usd_effective when the raw column is absent or contradicts the breakdown
        const finalLhrUsdEffective = reconciledLhrTotal ?? rawLhrUsdEffective;

        // Warn on currency/location mismatch (e.g., CNY assigned to USA/UK/EU locations)
        const nonCnyLocations = ['usa', 'united states', 'uk', 'united kingdom', 'germany', 'france', 'europe',
          'mexico', 'japan', 'taiwan', 'korea', 'australia', 'canada', 'spain', 'italy', 'sweden'];
        if (currencyVal === 'CNY' && nonCnyLocations.some(l => locationVal.toLowerCase().includes(l))) {
          this.logger.warn(
            `${machineName}: currency=CNY but location="${locationVal}" — verify currency is correct for this cost centre`,
            'MHRService.importFromExcel',
          );
        }

        // Combined format: force manual entry, compute total OH from breakdown columns.
        // The Combined_All_Countries benchmark sheet is USD-denominated regardless of
        // the row's location — direct/indirect overhead rate columns are USD/hr. Every
        // other code path (pickRate, cost engine, MHR list UI) treats manual_mhr_value /
        // fully_burdened_local_per_hr / total_machine_hour_rate as the row's LOCAL
        // currency, so the raw USD figure must be FX-converted before being stored in
        // those fields — storing it unconverted understates cost by the FX factor
        // (e.g. ~84x for India) everywhere the rate is used, including live BOM costing.
        let effectiveMhrNum = mhrNum;
        let effectiveIsManual = isManual;
        let directOHVal: number | null = null;
        let indirectOHVal: number | null = null;
        let combinedUsdMhr: number | null = null;
        if (isCombinedFormat) {
          directOHVal = directOverheadCol ? toNum(row.getCell(directOverheadCol).value, 0) || null : null;
          indirectOHVal = indirectOverheadCol ? toNum(row.getCell(indirectOverheadCol).value, 0) || null : null;
          const computedTotal = directOHVal && indirectOHVal ? directOHVal + indirectOHVal : null;
          // Use Total OH column if present and nonzero, otherwise sum the breakdown
          const usdMhr = (isNaN(mhrNum) || mhrNum === 0) && computedTotal != null ? computedTotal : (isNaN(mhrNum) ? 0 : mhrNum);
          combinedUsdMhr = usdMhr;
          // No rate on file for this location's currency — leave the figure in USD
          // rather than guessing a conversion; missingRateCurrencies flags it in the
          // returned errors[] so the caller knows exactly which rows need attention.
          effectiveMhrNum = localPerUsd != null ? Math.round(usdMhr * localPerUsd * 100) / 100 : usdMhr;
          effectiveIsManual = true;
        }

        rows.push({
          user_id:                            userId,
          machine_name:                       machineName,
          location:                           locationVal,
          commodity_code:                     commodityCodeCol ? toStr(row.getCell(commodityCodeCol).value, processGroupVal) || processGroupVal : processGroupVal,
          machine_description:                machineDescCol ? toStr(row.getCell(machineDescCol).value) || null : null,
          manufacturer:                       manufacturerCol ? toStr(row.getCell(manufacturerCol).value) || null : null,
          model:                              modelCol ? toStr(row.getCell(modelCol).value) || null : null,
          specification:                      specCol ? toStr(row.getCell(specCol).value) || null : null,
          shifts_per_day:                     shiftsCol ? toNum(row.getCell(shiftsCol).value, 3) : 3,
          hours_per_shift:                    hoursCol ? toNum(row.getCell(hoursCol).value, 8) : 8,
          working_days_per_year:              daysCol ? toNum(row.getCell(daysCol).value, 260) : 260,
          planned_maintenance_hours_per_year: maintHoursCol ? toNum(row.getCell(maintHoursCol).value, 0) : 0,
          capacity_utilization_rate:          Math.min(Math.max(utilRaw, 1), 100),
          landed_machine_cost:                Math.max(landedCost, 1),
          accessories_cost_percentage:        accessoriesCol ? toNum(row.getCell(accessoriesCol).value, MHR_CALCULATION_CONSTANTS.DEFAULTS.ACCESSORIES_COST_PERCENTAGE) : MHR_CALCULATION_CONSTANTS.DEFAULTS.ACCESSORIES_COST_PERCENTAGE,
          installation_cost_percentage:       installationCol ? toNum(row.getCell(installationCol).value, MHR_CALCULATION_CONSTANTS.DEFAULTS.INSTALLATION_COST_PERCENTAGE) : MHR_CALCULATION_CONSTANTS.DEFAULTS.INSTALLATION_COST_PERCENTAGE,
          payback_period_years:               paybackCol ? toNum(row.getCell(paybackCol).value, MHR_CALCULATION_CONSTANTS.DEFAULTS.PAYBACK_PERIOD_YEARS) : MHR_CALCULATION_CONSTANTS.DEFAULTS.PAYBACK_PERIOD_YEARS,
          interest_rate_percentage:           interestCol ? toNum(row.getCell(interestCol).value, MHR_CALCULATION_CONSTANTS.DEFAULTS.INTEREST_RATE) : MHR_CALCULATION_CONSTANTS.DEFAULTS.INTEREST_RATE,
          insurance_rate_percentage:          insuranceCol ? toNum(row.getCell(insuranceCol).value, MHR_CALCULATION_CONSTANTS.DEFAULTS.INSURANCE_RATE) : MHR_CALCULATION_CONSTANTS.DEFAULTS.INSURANCE_RATE,
          machine_footprint_sqm:              footprintCol ? toNum(row.getCell(footprintCol).value, 0) : 0,
          rent_per_sqm_per_month:             rentCol ? toNum(row.getCell(rentCol).value, 0) : 0,
          maintenance_cost_percentage:        maintenanceCol ? toNum(row.getCell(maintenanceCol).value, MHR_CALCULATION_CONSTANTS.DEFAULTS.MAINTENANCE_COST_PERCENTAGE) : MHR_CALCULATION_CONSTANTS.DEFAULTS.MAINTENANCE_COST_PERCENTAGE,
          power_kwh_per_hour:                 powerCol ? toNum(row.getCell(powerCol).value, 0) : 0,
          electricity_cost_per_kwh:           electricityCol ? toNum(row.getCell(electricityCol).value, 0) : 0,
          admin_overhead_percentage:          adminCol ? toNum(row.getCell(adminCol).value, 0) : 0,
          profit_margin_percentage:           profitCol ? toNum(row.getCell(profitCol).value, 0) : 0,
          is_manual_entry:                    effectiveIsManual,
          manual_mhr_value:                   effectiveIsManual ? effectiveMhrNum : null,
          total_machine_hour_rate:            null as number | null,
          total_fixed_cost_per_hour:          null as number | null,
          total_variable_cost_per_hour:       null as number | null,
          total_annual_cost:                  null as number | null,
          // India 2026 extended fields
          process_group:        processGroupVal || null,
          process_category:     processCategoryCol ? toStr(row.getCell(processCategoryCol).value) || null : null,
          machine_class:        machineClassCol ? toStr(row.getCell(machineClassCol).value) || null : null,
          automation_level:     automationLevelCol ? toStr(row.getCell(automationLevelCol).value) || null : null,
          operators:            operatorsCol ? Math.max(1, toNum(row.getCell(operatorsCol).value, 1)) : 1,
          wage_grade:           wageGradeCol ? toStr(row.getCell(wageGradeCol).value) || null : null,
          machine_price_usd:    rawMachinePriceUsd || null,
          manufacturer_country: mfrCountryCol ? toStr(row.getCell(mfrCountryCol).value) || null : null,
          setup_time_hr:        setupTimeCol ? toNum(row.getCell(setupTimeCol).value, 0) || null : null,
          lhr_inr_per_hr:       lhrInrCol ? toNum(row.getCell(lhrInrCol).value, 0) || null : null,
          usd_labor_rate_per_hr: usdLaborRateCol ? toNum(row.getCell(usdLaborRateCol).value, 0) || null : null,
          usd_lhr_base:          rawUsdLhrBase,
          usd_lhr_burden:        rawUsdLhrBurden,
          usd_lhr_total:         reconciledLhrTotal,
          // Multi-currency and fully-burdened fields
          currency:                    isCombinedFormat ? locCurrency : currencyVal,
          currency_symbol:             isCombinedFormat ? locSymbol : (currencySymbolCol ? toStr(row.getCell(currencySymbolCol).value) || null : null),
          lhr_usd_effective:           finalLhrUsdEffective,
          mhr_usd_per_hour:            isCombinedFormat ? combinedUsdMhr : (preCalcValues?.mhrUsd || null),
          fully_burdened_local_per_hr: isCombinedFormat ? effectiveMhrNum : (preCalcValues?.fullyBurdenedLocal || null),
          fully_burdened_usd_per_hr:   isCombinedFormat ? combinedUsdMhr : (preCalcValues?.fullyBurdenedUsd || null),
          specs:                Object.keys(specsObj).length ? specsObj : null,
          _pre_calc:            preCalcValues,
          // Combined format overhead breakdown
          direct_overhead_rate:   directOHVal,
          indirect_overhead_rate: indirectOHVal,
          // Machine capability (physics-based selection) — insertChunk strips these
          // automatically if migration 324 hasn't been applied yet
          ...capability,
          capability_source:      hasCapability ? 'imported' : null,
          capability_updated_at:  hasCapability ? new Date().toISOString() : null,
          capability_updated_by:  hasCapability ? userId : null,
          availability_status:    VALID_AVAILABILITY.includes(availabilityStatusRaw) ? availabilityStatusRaw : 'available',
          next_available_at:      toIso(nextAvailCol),
          scheduled_load_pct:     capNum(schedLoadCol),
          maintenance_window_start: toIso(maintStartCol),
          maintenance_window_end:   toIso(maintEndCol),
        });
      });
    }

    if (rows.length === 0) {
      this.logger.log('No valid machine rows found across all MHR sheets', 'MHRService');
      return { imported: 0, skipped: 0, errors: [] };
    }

    // Compute stored calculated fields and serialize calculations JSONB
    for (const record of rows) {
      const pc = record._pre_calc as Record<string, number> | null;
      delete record._pre_calc;
      try {
        let calcResult: any;
        if (pc) {
          // Pre-calculated import: build rich calculations object from Excel values.
          // Sanity guard: if mroPerHr is >20× depreciation, the Excel formula was USD-based
          // without FX conversion — recompute from standard engine formula using corrected landed cost.
          const D = MHR_CALCULATION_CONSTANTS.DEFAULTS;
          const mroPerHrRaw = pc.mroPerHr || 0;
          const depPerHr = pc.depPerHr || 0;
          let mroPerHr = mroPerHrRaw;
          if (depPerHr > 0 && mroPerHrRaw > depPerHr * 20) {
            const lmc = record.landed_machine_cost || 0;
            const effHrs = pc.effectiveHrs > 0 ? pc.effectiveHrs
              : (record.shifts_per_day * record.hours_per_shift * record.working_days_per_year * (record.capacity_utilization_rate / 100));
            const accsPct = record.accessories_cost_percentage || D.ACCESSORIES_COST_PERCENTAGE;
            const instPct = record.installation_cost_percentage || D.INSTALLATION_COST_PERCENTAGE;
            const maintPct = record.maintenance_cost_percentage || D.MAINTENANCE_COST_PERCENTAGE;
            const totalCapInvEngine = lmc * (1 + accsPct / 100) * (1 + instPct / 100);
            mroPerHr = effHrs > 0 && totalCapInvEngine > 0
              ? parseFloat((totalCapInvEngine * maintPct / 100 / effHrs).toFixed(2))
              : 0;
            this.logger.warn(
              `${record.machine_name}: mroPerHr=${mroPerHrRaw.toFixed(2)} reset to engine-computed ${mroPerHr} (>20× depPerHr — USD→INR conversion error in source Excel)`,
              'MHRService.importFromExcel',
            );
          }
          // MRO/maintenance is a FIXED cost (matches engine); only electricity is variable
          const fixedPerHr = (pc.costOfOwnPerHr || 0) + mroPerHr;
          const varPerHr   = (pc.elecPerHr || 0);
          const annualCost = (pc.depPa || 0) + (pc.intPa || 0) + (pc.insPa || 0) +
                             (pc.rentPa || 0) + (pc.mroPa || 0) + (pc.elecPa || 0);
          // Recompute total operating cost if MRO was corrected
          const totalOpCostPerHr = mroPerHr !== mroPerHrRaw
            ? (pc.costOfOwnPerHr || 0) + mroPerHr + varPerHr
            : (pc.totalOpCostPerHr || 0);
          const totalMhr = mroPerHr !== mroPerHrRaw
            ? totalOpCostPerHr  // no admin/profit on these pre-calc records
            : (record.manual_mhr_value || 0);
          calcResult = {
            workingHoursPerYear:       pc.totalHrsPerYear || 0,
            availableHoursPerYear:     pc.availHrsPerYear || 0,
            effectiveHoursPerYear:     pc.effectiveHrs || 0,
            depreciationPerHour:       depPerHr,
            interestPerHour:           pc.intPerHr || 0,
            insurancePerHour:          pc.insPerHr || 0,
            rentPerHour:               pc.rentPerHr || 0,
            maintenancePerHour:        mroPerHr,
            electricityPerHour:        pc.elecPerHr || 0,
            costOfOwnershipPerHour:    pc.costOfOwnPerHr || 0,
            totalFixedCostPerHour:     fixedPerHr,
            totalVariableCostPerHour:  varPerHr,
            totalOperatingCostPerHour: totalOpCostPerHr,
            adminOverheadPerHour:      0,
            profitMarginPerHour:       0,
            totalMachineHourRate:      totalMhr,
            depreciationPerAnnum:      pc.depPa || 0,
            interestPerAnnum:          pc.intPa || 0,
            insurancePerAnnum:         pc.insPa || 0,
            rentPerAnnum:              pc.rentPa || 0,
            maintenancePerAnnum:       pc.mroPa || 0,
            electricityPerAnnum:       pc.elecPa || 0,
            totalFixedCostPerAnnum:    (pc.depPa || 0) + (pc.intPa || 0) + (pc.insPa || 0) + (pc.rentPa || 0),
            totalVariableCostPerAnnum: (pc.mroPa || 0) + (pc.elecPa || 0),
            totalAnnualCost:           annualCost,
            accessoriesCost:           pc.accsCost || 0,
            installationCost:          pc.instCost || 0,
            totalCapitalInvestment:    pc.totalCapInv || 0,
          };
          record.total_machine_hour_rate      = totalMhr;
          record.total_fixed_cost_per_hour    = fixedPerHr;
          record.total_variable_cost_per_hour = varPerHr;
          record.total_annual_cost            = annualCost;
          // When MRO was corrected, the original Excel MHR is also wrong — update it
          if (mroPerHr !== mroPerHrRaw) record.manual_mhr_value = parseFloat(totalMhr.toFixed(2));
        } else if (record.is_manual_entry) {
          calcResult = this.createManualEntryCalculation(record.manual_mhr_value);
          record.total_machine_hour_rate      = calcResult.totalMachineHourRate;
          record.total_fixed_cost_per_hour    = calcResult.totalFixedCostPerHour;
          record.total_variable_cost_per_hour = calcResult.totalVariableCostPerHour;
          record.total_annual_cost            = calcResult.totalAnnualCost;
        } else {
          calcResult = this.calculateMHR(this.mapRowToDto(record), true);
          record.total_machine_hour_rate      = calcResult.totalMachineHourRate;
          record.total_fixed_cost_per_hour    = calcResult.totalFixedCostPerHour;
          record.total_variable_cost_per_hour = calcResult.totalVariableCostPerHour;
          record.total_annual_cost            = calcResult.totalAnnualCost;
        }
        // calculations is never stored in DB — it is recomputed on every read by findAll/findOne
      } catch {
        record.total_machine_hour_rate      = 0;
        record.total_fixed_cost_per_hour    = 0;
        record.total_variable_cost_per_hour = 0;
        record.total_annual_cost            = 0;
      }
    }

    // Dedup by composite (machine_name, location, machine_class)
    // machine_class is needed for Combined format where same machine name exists at same location across process sequences
    const client = this.supabaseService.getAdminClient();
    const { data: existing } = await client
      .from('mhr_records')
      .select('machine_name, location, machine_class')
      .eq('user_id', userId)
      .limit(20000);
    const dedupKey = (r: any) =>
      `${String(r.machine_name ?? '').toLowerCase()}::${String(r.location ?? '').toLowerCase()}::${String(r.machine_class ?? '').toLowerCase()}`;
    const existingKeys = new Set((existing ?? []).map(dedupKey));

    const newRows = rows.filter(r => !existingKeys.has(dedupKey(r)));
    const skipped = rows.length - newRows.length;

    if (newRows.length === 0) return { imported: 0, skipped, errors: [] };

    const CHUNK_SIZE = 500;
    const chunks: any[][] = [];
    for (let offset = 0; offset < newRows.length; offset += CHUNK_SIZE) {
      chunks.push(newRows.slice(offset, offset + CHUNK_SIZE));
    }

    // Insert one chunk, auto-retrying after stripping any column that doesn't exist yet
    // (handles cases where migration 322/323 haven't been applied to the DB yet).
    const insertChunk = async (
      chunk: any[],
      chunkIdx: number,
      excluded: Set<string> = new Set(),
    ): Promise<{ data: any[] | null; error: any }> => {
      const rows = excluded.size > 0
        ? chunk.map(row => {
            const out: any = {};
            for (const [k, v] of Object.entries(row)) {
              if (!excluded.has(k)) out[k] = v;
            }
            return out;
          })
        : chunk;

      const { data, error } = await client.from('mhr_records').insert(rows).select('id');
      if (!error) return { data, error };

      // Handle both PostgreSQL native and PostgREST schema-cache error formats:
      //   PostgreSQL: column "xyz" of relation "mhr_records" does not exist
      //   PostgREST:  Could not find the 'xyz' column of 'mhr_records' in the schema cache
      const miss = error.message.match(
        /column "([^"]+)" of relation "mhr_records" does not exist|Could not find the '([^']+)' column of 'mhr_records' in the schema cache/,
      );
      const missingCol = miss?.[1] ?? miss?.[2];
      if (missingCol) {
        this.logger.warn(
          `MHR import chunk ${chunkIdx}: column '${missingCol}' missing (pending migration) — retrying without it`,
          'MHRService',
        );
        excluded.add(missingCol);
        return insertChunk(chunk, chunkIdx, excluded);
      }

      return { data, error };
    };

    // Parallel insert — all chunks fire simultaneously to stay within HTTP timeout
    const results = await Promise.all(chunks.map((chunk, i) => insertChunk(chunk, i)));

    let imported = 0;
    const errors: string[] = [];
    results.forEach(({ data, error }, i) => {
      if (error) {
        this.logger.error(`MHR import chunk ${i} error: ${error.message}`, 'MHRService');
        errors.push(`Batch ${i} failed: ${error.message}`);
      } else {
        imported += (data ?? []).length;
      }
    });

    if (missingRateCurrencies.size > 0) {
      const list = [...missingRateCurrencies].join(', ');
      this.logger.warn(`MHR import: no exchange rate on file for ${list} — affected rows kept raw USD figures`, 'MHRService');
      errors.push(
        `No exchange rate on file for: ${list}. Add these to the exchange_rates table, then re-import — ` +
        `affected rows were saved with unconverted USD figures and will under-price by the FX factor until fixed.`,
      );
    }

    // Disclosed, not silent: columns entirely absent from the workbook (not
    // just a blank cell in a present column) fall back to
    // MHR_CALCULATION_CONSTANTS.DEFAULTS with no prior disclosure anywhere —
    // every affected row's totalAnnualCost/depreciation/etc. is derived from
    // an assumed operational parameter, not the shop's real one.
    if (missingOperationalColsSet.size > 0) {
      const list = [...missingOperationalColsSet].join(', ');
      this.logger.warn(`MHR import: workbook has no column for ${list} — all rows used assumed defaults for these fields`, 'MHRService');
      errors.push(
        `Workbook has no column for: ${list}. All imported rows used assumed default values for these fields ` +
        `(not the shop's real operational data) — add these columns and re-import for accurate rates.`,
      );
    }

    this.logger.log(`MHR import complete: ${imported} imported, ${skipped} skipped`, 'MHRService');
    if (imported > 0) invalidateMachinePools();
    return { imported, skipped, errors };
  }

  async removeAll(userId: string, accessToken: string): Promise<{ deleted: number }> {
    this.logger.log(`Deleting all MHR records for user ${userId}`, 'MHRService');

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('mhr_records')
      .delete()
      .eq('user_id', userId)
      .select('id');

    if (error) {
      this.logger.error(`Error deleting all MHR records: ${error.message}`, 'MHRService');
      throw new InternalServerErrorException('Failed to delete all MHR records.');
    }

    invalidateMachinePools();
    return { deleted: (data ?? []).length };
  }

  private isValidUUID(id: string): boolean {
    try {
      return isValidUUID(id);
    } catch {
      return false;
    }
  }

  private mapRowToDto(row: any): CreateMHRDto {
    return {
      location: row.location,
      commodityCode: row.commodityCode || row.commodity_code,
      machineDescription: row.machineDescription || row.machine_description,
      manufacturer: row.manufacturer,
      model: row.model,
      machineName: row.machineName || row.machine_name,
      specification: row.specification,
      shiftsPerDay: parseFloat(row.shiftsPerDay || row.shifts_per_day || 3),
      hoursPerShift: parseFloat(row.hoursPerShift || row.hours_per_shift || 8),
      workingDaysPerYear: parseFloat(row.workingDaysPerYear || row.working_days_per_year || 260),
      plannedMaintenanceHoursPerYear: parseFloat(row.plannedMaintenanceHoursPerYear || row.planned_maintenance_hours_per_year || 0),
      capacityUtilizationRate: parseFloat(row.capacityUtilizationRate || row.capacity_utilization_rate || 95),
      landedMachineCost: parseFloat(row.landedMachineCost || row.landed_machine_cost || 0),
      accessoriesCostPercentage: parseFloat(row.accessoriesCostPercentage || row.accessories_cost_percentage || MHR_CALCULATION_CONSTANTS.DEFAULTS.ACCESSORIES_COST_PERCENTAGE),
      installationCostPercentage: parseFloat(row.installationCostPercentage || row.installation_cost_percentage || MHR_CALCULATION_CONSTANTS.DEFAULTS.INSTALLATION_COST_PERCENTAGE),
      paybackPeriodYears: parseFloat(row.paybackPeriodYears || row.payback_period_years || MHR_CALCULATION_CONSTANTS.DEFAULTS.PAYBACK_PERIOD_YEARS),
      interestRatePercentage: parseFloat(row.interestRatePercentage || row.interest_rate_percentage || MHR_CALCULATION_CONSTANTS.DEFAULTS.INTEREST_RATE),
      insuranceRatePercentage: parseFloat(row.insuranceRatePercentage || row.insurance_rate_percentage || MHR_CALCULATION_CONSTANTS.DEFAULTS.INSURANCE_RATE),
      machineFootprintSqm: parseFloat(row.machineFootprintSqm || row.machine_footprint_sqm || 0),
      rentPerSqmPerMonth: parseFloat(row.rentPerSqmPerMonth || row.rent_per_sqm_per_month || 0),
      maintenanceCostPercentage: parseFloat(row.maintenanceCostPercentage || row.maintenance_cost_percentage || MHR_CALCULATION_CONSTANTS.DEFAULTS.MAINTENANCE_COST_PERCENTAGE),
      powerKwhPerHour: parseFloat(row.powerKwhPerHour || row.power_kwh_per_hour || 0),
      electricityCostPerKwh: parseFloat(row.electricityCostPerKwh || row.electricity_cost_per_kwh || 0),
      adminOverheadPercentage: parseFloat(row.adminOverheadPercentage || row.admin_overhead_percentage || 0),
      profitMarginPercentage: parseFloat(row.profitMarginPercentage || row.profit_margin_percentage || 0),
      isManualEntry: row.isManualEntry || row.is_manual_entry || false,
      manualMHRValue: row.manualMHRValue || (row.manual_mhr_value ? parseFloat(row.manual_mhr_value) : 0),
    };
  }

  /**
   * Real machine_class values that unambiguously belong to one real Sheet
   * Metal category, verified against each row's own machine_description
   * (live-DB check, 2026-08-27) — not a generic rule for every possible use
   * of that class. machine_class is a many-categories-to-one-class
   * cost-engine grouping (migration 569 maps BOTH "3D Laser Cutting Machine"
   * and "Fiber Laser Cutting Machine" to fiber_laser; BOTH "Bend Press Brake"
   * and "Progressive Die Press" to press_brake), so resolving it to a single
   * category is only safe once a specific row's real machine has been read
   * and confirmed. The 13 legacy rows with no benchmark_source_key are: two
   * "Fiber Laser {2,6}kW" (flatbed sheet cutters, not 3D/robotic — verified
   * "Fiber Laser Cutting Machine"), one "Press Brake 160T" (bending, not
   * progressive-die stamping — verified "Bend Press Brake"), and ten others
   * (deburring, cmm, cnc_lathe, cnc_3ax_vmc, cnc_5ax_mc, injection_molding)
   * from manufacturing domains this app hasn't built yet (CLAUDE.md's
   * domain-by-domain roadmap) or a genuinely distinct process (a general
   * deburring bench isn't the same thing as "Deslag Machine") — kept as
   * their own real category via mhrCategoryOf, not merged into a Sheet Metal
   * one; this mirrors the frontend's lib/utils/mhrCategoryOf.ts exactly so
   * the suggestions list and every record's own display agree.
   */
  private static readonly VERIFIED_CLASS_CATEGORY: Record<string, string> = {
    fiber_laser: 'Fiber Laser Cutting Machine',
    press_brake: 'Bend Press Brake',
  };

  // Real process group each machine_class fallback belongs to — verified
  // against the actual process_calculator_mappings taxonomy (2026-08-27):
  // fiber_laser/press_brake are Sheet Metal (same domain as their verified
  // category above); cnc_lathe/cnc_3ax_vmc/cnc_5ax_mc are Machining;
  // injection_molding is Plastic & Rubber; cmm and deburring are Post
  // Processing (real "Inspection"/"Deburring" routes under that group).
  // benchmark_source_key rows need no entry here — 100% of
  // machine_library.json is Sheet Metal (CLAUDE.md's domain-by-domain
  // roadmap), so any row with a benchmark match is always that group.
  private static readonly MACHINE_CLASS_PROCESS_GROUP: Record<string, string> = {
    fiber_laser: 'Sheet Metal',
    press_brake: 'Sheet Metal',
    cnc_lathe: 'Machining',
    cnc_3ax_vmc: 'Machining',
    cnc_5ax_mc: 'Machining',
    injection_molding: 'Plastic & Rubber',
    cmm: 'Post Processing',
    deburring: 'Post Processing',
  };

  private static humanizeMachineClass(machineClass: string): string {
    return machineClass
      .split('_')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  /**
   * Real, computed machine categories — not a raw column. Mirrors the HR
   * Rates table's own mhrCategoryOf(): benchmark_source_key's category
   * (before ':') when a benchmark match exists, otherwise the row's
   * machine_class resolved through the same verified mapping / humanizer as
   * mhrCategoryOf.ts, instead of the raw internal slug (e.g. "fiber_laser")
   * — which both reads badly and looks like a near-duplicate of the real
   * category name it's a coarser version of. Not scoped to userId — most
   * real category variety lives in the global/benchmark rows every user
   * shares.
   *
   * `processGroup`, when given, scopes the result to that real process group
   * (via MACHINE_CLASS_PROCESS_GROUP for machine_class fallback rows, or
   * "Sheet Metal" for any benchmark_source_key row) — without this, every
   * category from every domain was returned regardless of which Process the
   * form's Process field had selected, so picking "Machining" still listed
   * Sheet Metal categories (281 of ~294 rows are Sheet Metal, drowning out
   * the rest).
   */
  async getDistinctCategories(accessToken: string, processGroup?: string): Promise<string[]> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .select('benchmark_source_key, machine_class')
      .limit(20000);

    if (error) {
      this.logger.error(`Error fetching distinct categories: ${error.message}`, 'MHRService');
      return [];
    }

    const categories = (data ?? []).map((r: any) => {
      const fromKey = r.benchmark_source_key?.split(':')[0]?.trim();
      const rowGroup = fromKey ? 'Sheet Metal' : (r.machine_class ? MHRService.MACHINE_CLASS_PROCESS_GROUP[r.machine_class] : undefined);
      if (processGroup && rowGroup !== processGroup) return null;
      if (fromKey) return fromKey;
      if (!r.machine_class) return null;
      return MHRService.VERIFIED_CLASS_CATEGORY[r.machine_class] ?? MHRService.humanizeMachineClass(r.machine_class);
    }).filter(Boolean) as string[];

    return [...new Set(categories)].sort();
  }

  async getDistinctManufacturerCountries(accessToken: string): Promise<string[]> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .select('manufacturer_country')
      .not('manufacturer_country', 'is', null)
      .limit(20000);

    if (error) {
      this.logger.error(`Error fetching distinct manufacturer countries: ${error.message}`, 'MHRService');
      return [];
    }

    return [...new Set(data?.map((r: any) => r.manufacturer_country).filter(Boolean) as string[])].sort();
  }

  // Deliberately NOT scoped by user_id (matches getDistinctManufacturerCountries,
  // and findAll's own unfiltered read) — most real mhr_records rows are global
  // benchmark data (machine_library import) owned by a shared system identity,
  // not the logged-in user. Scoping this to `user_id = userId` (the previous
  // behavior) silently excluded every global location/currency from the filter
  // dropdown, even though findAll's own table happily returns those same rows.
  async getDistinctCurrencies(accessToken: string): Promise<string[]> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .select('currency')
      .not('currency', 'is', null)
      .limit(20000);

    if (error) {
      this.logger.error(`Error fetching distinct currencies: ${error.message}`, 'MHRService');
      return [];
    }

    return [...new Set(data?.map((r: any) => r.currency).filter(Boolean) as string[])].sort();
  }

  async getDistinctLocations(accessToken: string): Promise<string[]> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .select('location')
      .not('location', 'is', null)
      .limit(20000);

    if (error) {
      this.logger.error(`Error fetching distinct locations: ${error.message}`, 'MHRService');
      return [];
    }

    return [...new Set(data?.map((r: any) => r.location).filter(Boolean) as string[])].sort();
  }
}
