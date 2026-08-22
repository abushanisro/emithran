import { ApiProperty } from '@nestjs/swagger';
import { resolveMachineEconomics } from '../../bom-items/costing/machine-selection/economics-resolver';

export class MHRCalculationResult {
  // Working Hours Calculations
  @ApiProperty()
  workingHoursPerYear: number;

  @ApiProperty()
  availableHoursPerYear: number;

  @ApiProperty()
  effectiveHoursPerYear: number;

  // Cost Components - Per Hour
  @ApiProperty()
  depreciationPerHour: number;

  @ApiProperty()
  interestPerHour: number;

  @ApiProperty()
  insurancePerHour: number;

  @ApiProperty()
  rentPerHour: number;

  @ApiProperty()
  maintenancePerHour: number;

  @ApiProperty()
  electricityPerHour: number;

  // Totals - Per Hour
  @ApiProperty()
  costOfOwnershipPerHour: number;

  @ApiProperty()
  totalFixedCostPerHour: number;

  @ApiProperty()
  totalVariableCostPerHour: number;

  @ApiProperty()
  totalOperatingCostPerHour: number;

  @ApiProperty()
  adminOverheadPerHour: number;

  @ApiProperty()
  profitMarginPerHour: number;

  @ApiProperty()
  totalMachineHourRate: number;

  // Annual Costs
  @ApiProperty()
  depreciationPerAnnum: number;

  @ApiProperty()
  interestPerAnnum: number;

  @ApiProperty()
  insurancePerAnnum: number;

  @ApiProperty()
  rentPerAnnum: number;

  @ApiProperty()
  maintenancePerAnnum: number;

  @ApiProperty()
  electricityPerAnnum: number;

  @ApiProperty()
  totalFixedCostPerAnnum: number;

  @ApiProperty()
  totalVariableCostPerAnnum: number;

  @ApiProperty()
  totalAnnualCost: number;

  // Capital Investment Breakdown
  @ApiProperty()
  accessoriesCost: number;

  @ApiProperty()
  installationCost: number;

  @ApiProperty()
  totalCapitalInvestment: number;
}

export class MHRResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  location: string;

  @ApiProperty()
  commodityCode: string;

  @ApiProperty({ nullable: true })
  machineDescription?: string;

  @ApiProperty({ nullable: true })
  manufacturer?: string;

  @ApiProperty({ nullable: true })
  model?: string;

  @ApiProperty()
  machineName: string;

  @ApiProperty({ nullable: true })
  specification?: string;

  // Machine Operating Hours
  @ApiProperty()
  shiftsPerDay: number;

  @ApiProperty()
  hoursPerShift: number;

  @ApiProperty()
  workingDaysPerYear: number;

  @ApiProperty()
  plannedMaintenanceHoursPerYear: number;

  @ApiProperty()
  capacityUtilizationRate: number;

  // Costs
  @ApiProperty()
  landedMachineCost: number;

  @ApiProperty()
  accessoriesCostPercentage: number;

  @ApiProperty()
  installationCostPercentage: number;

  @ApiProperty()
  paybackPeriodYears: number;

  @ApiProperty()
  interestRatePercentage: number;

  @ApiProperty()
  insuranceRatePercentage: number;

  @ApiProperty()
  machineFootprintSqm: number;

  @ApiProperty()
  rentPerSqmPerMonth: number;

  @ApiProperty()
  maintenanceCostPercentage: number;

  @ApiProperty()
  powerKwhPerHour: number;

  @ApiProperty()
  electricityCostPerKwh: number;

  @ApiProperty()
  adminOverheadPercentage: number;

  @ApiProperty()
  profitMarginPercentage: number;

  // Manual Entry Fields
  @ApiProperty()
  isManualEntry: boolean;

  @ApiProperty({ nullable: true })
  manualMHRValue?: number;

  // India 2026 extended fields
  @ApiProperty({ nullable: true }) processGroup?: string;
  @ApiProperty({ nullable: true }) processRoute?: string;
  @ApiProperty({ nullable: true }) operation?: string;
  @ApiProperty({ nullable: true }) processCategory?: string;
  @ApiProperty({ nullable: true }) machineClass?: string;
  @ApiProperty({ nullable: true }) automationLevel?: string;
  @ApiProperty({ nullable: true }) operators?: number;
  @ApiProperty({ nullable: true }) wageGrade?: string;
  @ApiProperty({ nullable: true }) machinePriceUsd?: number;
  @ApiProperty({ nullable: true }) manufacturerCountry?: string;
  @ApiProperty({ nullable: true }) setupTimeHr?: number;
  @ApiProperty({ nullable: true }) lhrInrPerHr?: number;
  @ApiProperty({ nullable: true }) usdLaborRatePerHr?: number;
  @ApiProperty({ nullable: true }) usdLhrBase?: number;
  @ApiProperty({ nullable: true }) usdLhrBurden?: number;
  @ApiProperty({ nullable: true }) usdLhrTotal?: number;
  // Multi-currency fields
  @ApiProperty({ nullable: true }) currency?: string;
  @ApiProperty({ nullable: true }) currencySymbol?: string;
  @ApiProperty({ nullable: true }) mhrUsdPerHour?: number;
  @ApiProperty({ nullable: true }) fullyBurdenedLocalPerHr?: number;
  @ApiProperty({ nullable: true }) fullyBurdenedUsdPerHr?: number;
  @ApiProperty({ nullable: true }) lhrUsdEffective?: number;
  @ApiProperty({ nullable: true }) specs?: Record<string, any>;
  @ApiProperty({ nullable: true }) directOverheadRate?: number;
  @ApiProperty({ nullable: true }) indirectOverheadRate?: number;
  // Economics provenance (Phase 1, "Machine Economics" initiative) — mirrors
  // capabilitySource below, one tier per rate field: 'shop_override'
  // (human-entered) | 'imported' (Excel bulk import) | 'benchmark'
  // (machine_library.json reference data) | 'generic_fallback' (no data on
  // file). Lets the UI show a provenance badge instead of presenting a
  // reference-benchmark number as if it were this shop's real rate.
  @ApiProperty({ nullable: true }) directOverheadSource?: string;
  @ApiProperty({ nullable: true }) indirectOverheadSource?: string;
  @ApiProperty({ nullable: true }) laborRateSource?: string;
  @ApiProperty({ nullable: true }) economicsVersion?: number;
  // Industry-benchmark lane — always present when a machine_library.json
  // match exists, even once a real shop/imported value has superseded it in
  // the fields above, so the UI can show "your rate vs. the benchmark".
  @ApiProperty({ nullable: true }) benchmarkDirectOverheadRateUsdHr?: number;
  @ApiProperty({ nullable: true }) benchmarkIndirectOverheadRateUsdHr?: number;
  @ApiProperty({ nullable: true }) benchmarkLaborRateUsdHr?: number;
  // Press-brake/machine capacity — already used server-side for machine
  // selection/capability checks (machine-selection/selector.ts's maxTonnage);
  // exposed here so the interactive calculator can auto-fill "Selected
  // Tonnage" from the SAME rated capacity, instead of leaving it manual.
  @ApiProperty({ nullable: true }) maxTonnage?: number;
  // Real laser/spindle power (kW) — mhr_records.power_kw, migration 324,
  // backfilled with verified OEM data for the real laser fleet (migration
  // 450). Same reasoning as maxTonnage above: exposed here so the
  // interactive calculator's "Laser Machine Power" field can auto-fill from
  // this REAL capability instead of ever parsing it out of the machine's
  // name string. Undefined/null means no verified capability is on file —
  // callers must treat that as a real gap, never a reason to guess.
  @ApiProperty({ nullable: true }) powerKw?: number;
  // Remaining capability columns (migration 324/339) — same real data
  // machine-selection/selector.ts's fetchMachinePool() reads for ranking;
  // previously exposed nowhere in this DTO at all (only maxTonnage/powerKw
  // were), so the dialog had no way to show or edit them even read-only.
  @ApiProperty({ nullable: true }) maxXMm?: number;
  @ApiProperty({ nullable: true }) maxYMm?: number;
  @ApiProperty({ nullable: true }) maxZMm?: number;
  @ApiProperty({ nullable: true }) maxDiameterMm?: number;
  @ApiProperty({ nullable: true }) maxLengthMm?: number;
  @ApiProperty({ nullable: true }) maxThicknessMm?: number;
  @ApiProperty({ nullable: true }) maxWorkpieceWeightKg?: number;
  @ApiProperty({ nullable: true }) maxThicknessMsMm?: number;
  @ApiProperty({ nullable: true }) maxThicknessSsMm?: number;
  @ApiProperty({ nullable: true }) maxThicknessAlMm?: number;
  @ApiProperty({ nullable: true }) maxThicknessCuMm?: number;
  @ApiProperty({ nullable: true, type: [String] }) cuttableMaterials?: string[];
  @ApiProperty({ nullable: true }) capabilityVersion?: number;
  // mhr_records.capability_source — 'imported' (verified nameplate/OEM
  // data), 'seed' (real, sourced, but not THIS unit's own verified record —
  // e.g. a documented typical model config used as a disclosed estimate,
  // migration 459), or unset. Lets the UI show "Estimated" rather than
  // "Verified" for powerKw/maxTonnage when it isn't the real thing —
  // machine-selection/selector.ts already renders this same distinction
  // server-side ("Capability from model seed data — verify against machine
  // plate"); this just exposes it to callers outside that pipeline (this
  // dialog's own direct MHR fetch) too.
  @ApiProperty({ nullable: true }) capabilitySource?: string;

  // Calculated Results
  @ApiProperty()
  calculations: MHRCalculationResult;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  static fromDatabase(row: any): MHRResponseDto {
    // Read-time resolution (Phase 1, "Machine Economics" initiative) — covers
    // rows created/updated BEFORE this initiative shipped, whose
    // direct_overhead_rate/indirect_overhead_rate/usd_lhr_total may be real
    // (just missing a source tag — resolveMachineEconomics defensively
    // defaults that to 'imported', same as capabilitySource's own convention)
    // or genuinely blank (resolved live from benchmark_*/generic fallback
    // instead of staying "-" until someone happens to re-save the record).
    // A row saved via mhr.service.ts going forward already has these
    // persisted with a real source tag, so this is idempotent for those.
    const resolved = resolveMachineEconomics(row);
    return {
      id: row.id,
      userId: row.user_id,
      location: row.location,
      commodityCode: row.commodity_code,
      machineDescription: row.machine_description,
      manufacturer: row.manufacturer,
      model: row.model,
      machineName: row.machine_name,
      specification: row.specification,
      shiftsPerDay: parseFloat(row.shifts_per_day),
      hoursPerShift: parseFloat(row.hours_per_shift),
      workingDaysPerYear: parseFloat(row.working_days_per_year),
      plannedMaintenanceHoursPerYear: parseFloat(row.planned_maintenance_hours_per_year),
      capacityUtilizationRate: parseFloat(row.capacity_utilization_rate),
      landedMachineCost: parseFloat(row.landed_machine_cost),
      accessoriesCostPercentage: parseFloat(row.accessories_cost_percentage),
      installationCostPercentage: parseFloat(row.installation_cost_percentage),
      paybackPeriodYears: parseFloat(row.payback_period_years),
      interestRatePercentage: parseFloat(row.interest_rate_percentage),
      insuranceRatePercentage: parseFloat(row.insurance_rate_percentage),
      machineFootprintSqm: parseFloat(row.machine_footprint_sqm),
      rentPerSqmPerMonth: parseFloat(row.rent_per_sqm_per_month),
      maintenanceCostPercentage: parseFloat(row.maintenance_cost_percentage),
      powerKwhPerHour: parseFloat(row.power_kwh_per_hour),
      electricityCostPerKwh: parseFloat(row.electricity_cost_per_kwh),
      adminOverheadPercentage: parseFloat(row.admin_overhead_percentage),
      profitMarginPercentage: parseFloat(row.profit_margin_percentage),
      isManualEntry: row.is_manual_entry || false,
      manualMHRValue: row.manual_mhr_value ? parseFloat(row.manual_mhr_value) : undefined,
      processGroup: row.process_group ?? undefined,
      processRoute: row.process_route ?? undefined,
      operation: row.operation ?? undefined,
      processCategory: row.process_category ?? undefined,
      machineClass: row.machine_class ?? undefined,
      automationLevel: row.automation_level ?? undefined,
      operators: row.operators ?? undefined,
      wageGrade: row.wage_grade ?? undefined,
      machinePriceUsd: row.machine_price_usd ? parseFloat(row.machine_price_usd) : undefined,
      manufacturerCountry: row.manufacturer_country ?? undefined,
      setupTimeHr: row.setup_time_hr ? parseFloat(row.setup_time_hr) : undefined,
      lhrInrPerHr: row.lhr_inr_per_hr ? parseFloat(row.lhr_inr_per_hr) : undefined,
      usdLaborRatePerHr: row.usd_labor_rate_per_hr ? parseFloat(row.usd_labor_rate_per_hr) : undefined,
      usdLhrBase: row.usd_lhr_base ? parseFloat(row.usd_lhr_base) : undefined,
      usdLhrBurden: row.usd_lhr_burden ? parseFloat(row.usd_lhr_burden) : undefined,
      // 'generic_fallback' maps to undefined here (renders as "-", not a
      // misleading "$0.00") — the resolver itself always returns a concrete
      // number for internal/persistence consistency; this is a display-only
      // decision. 'benchmark' DOES show its real (non-zero) number, with
      // laborRateSource below telling the UI to caveat it.
      usdLhrTotal: resolved.laborRateUsdHr.source === 'generic_fallback' ? undefined : resolved.laborRateUsdHr.value ?? undefined,
      currency: row.currency ?? undefined,
      currencySymbol: row.currency_symbol ?? undefined,
      mhrUsdPerHour: row.mhr_usd_per_hour ? parseFloat(row.mhr_usd_per_hour) : undefined,
      fullyBurdenedLocalPerHr: row.fully_burdened_local_per_hr ? parseFloat(row.fully_burdened_local_per_hr) : undefined,
      fullyBurdenedUsdPerHr: row.fully_burdened_usd_per_hr ? parseFloat(row.fully_burdened_usd_per_hr) : undefined,
      lhrUsdEffective: row.lhr_usd_effective ? parseFloat(row.lhr_usd_effective) : undefined,
      specs: row.specs ?? undefined,
      directOverheadRate: resolved.directOverheadRate.source === 'generic_fallback' ? undefined : resolved.directOverheadRate.value ?? undefined,
      indirectOverheadRate: resolved.indirectOverheadRate.source === 'generic_fallback' ? undefined : resolved.indirectOverheadRate.value ?? undefined,
      directOverheadSource: resolved.directOverheadRate.source,
      indirectOverheadSource: resolved.indirectOverheadRate.source,
      laborRateSource: resolved.laborRateUsdHr.source,
      economicsVersion: row.economics_version ?? undefined,
      benchmarkDirectOverheadRateUsdHr: row.benchmark_direct_overhead_rate_usd_hr ? parseFloat(row.benchmark_direct_overhead_rate_usd_hr) : undefined,
      benchmarkIndirectOverheadRateUsdHr: row.benchmark_indirect_overhead_rate_usd_hr ? parseFloat(row.benchmark_indirect_overhead_rate_usd_hr) : undefined,
      benchmarkLaborRateUsdHr: row.benchmark_labor_rate_usd_hr ? parseFloat(row.benchmark_labor_rate_usd_hr) : undefined,
      maxTonnage: row.max_tonnage ? parseFloat(row.max_tonnage) : undefined,
      powerKw: row.power_kw ? parseFloat(row.power_kw) : undefined,
      maxXMm: row.max_x_mm ? parseFloat(row.max_x_mm) : undefined,
      maxYMm: row.max_y_mm ? parseFloat(row.max_y_mm) : undefined,
      maxZMm: row.max_z_mm ? parseFloat(row.max_z_mm) : undefined,
      maxDiameterMm: row.max_diameter_mm ? parseFloat(row.max_diameter_mm) : undefined,
      maxLengthMm: row.max_length_mm ? parseFloat(row.max_length_mm) : undefined,
      maxThicknessMm: row.max_thickness_mm ? parseFloat(row.max_thickness_mm) : undefined,
      maxWorkpieceWeightKg: row.max_workpiece_weight_kg ? parseFloat(row.max_workpiece_weight_kg) : undefined,
      maxThicknessMsMm: row.max_thickness_ms_mm ? parseFloat(row.max_thickness_ms_mm) : undefined,
      maxThicknessSsMm: row.max_thickness_ss_mm ? parseFloat(row.max_thickness_ss_mm) : undefined,
      maxThicknessAlMm: row.max_thickness_al_mm ? parseFloat(row.max_thickness_al_mm) : undefined,
      maxThicknessCuMm: row.max_thickness_cu_mm ? parseFloat(row.max_thickness_cu_mm) : undefined,
      cuttableMaterials: row.cuttable_materials ?? undefined,
      capabilityVersion: row.capability_version ?? undefined,
      capabilitySource: row.capability_source ?? undefined,
      calculations: JSON.parse(row.calculations || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export class MHRListResponseDto {
  @ApiProperty({ type: [MHRResponseDto] })
  records: MHRResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
