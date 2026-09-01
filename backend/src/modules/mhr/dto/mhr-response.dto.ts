import { ApiProperty } from '@nestjs/swagger';
import { resolveMachineEconomics } from '../../bom-items/costing/shared/capability/machine-selection/economics-resolver';

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
  // Migration 580 (Machine Economics, bottom-up MHR) — a genuine machine-hour
  // rate computed from real capex/lifecycle fields (price, life, salvage,
  // maintenance, installation, supplies, uptime, utilization), independent of
  // Direct/Indirect OH and LHR. null when the machine lacks the inputs to
  // compute it (never a fabricated 0).
  @ApiProperty({ nullable: true }) calculatedMhrUsdHr?: number;
  // Snapshot of manual_mhr_value as it stood before migration 580, for the
  // 281 rows where that value was actually direct+indirect overhead (migration
  // 564's import stopgap) — preserved for audit even though it was never a
  // real machine-hour rate.
  @ApiProperty({ nullable: true }) legacyImportedMhrUsdHr?: number;
  // Provenance of this row's authoritative MHR figure: 'calculated'
  // (calculatedMhrUsdHr), 'manual' (a human deliberately entered/approved
  // manualMHRValue), or 'legacy_import' (an old import artifact — not an
  // approved value). Real quote costing still reads totalMachineHourRate/
  // manualMHRValue regardless of this tag — migration 580 deliberately left
  // that untouched; this is display/reference metadata only.
  @ApiProperty({ nullable: true }) mhrSource?: string;
  // Economics provenance (Phase 1, "Machine Economics" initiative) — mirrors
  // capabilitySource below, one tier per rate field: 'shop_override'
  // (human-entered) | 'imported' (Excel bulk import) | 'benchmark'
  // (machine_library.json reference data) | 'no_rate' (no real value or
  // benchmark on file — resolves to a null value, never a fabricated number)
  // | 'generic_fallback' (legacy tag on rows saved before 2026-08-30, when
  // this resolved to a fabricated $0 — no longer produced, but old rows can
  // still carry it). Lets the UI show a provenance badge instead of
  // presenting a reference-benchmark number as if it were this shop's real rate.
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
  // sm_reference_data.key ("<category>:<machine name>") this row was matched
  // to (migration 537 / mhr.service.ts's lookupMachineLibraryBenchmark). The
  // part before ':' is the machine's real machine_library category (e.g.
  // "Fiber Laser Cutting Machine") — used by the UI as a real fallback for
  // rows with no machine_class, instead of showing a blank/slug category.
  @ApiProperty({ nullable: true }) benchmarkSourceKey?: string;
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

  // Tier 1 universal machine_library.json economics/lifecycle fields
  // (migration 573) — real, present across all 15 Sheet Metal categories.
  @ApiProperty({ nullable: true }) laborTimeStandard?: number;
  @ApiProperty({ nullable: true }) avgUtilization?: number;
  @ApiProperty({ nullable: true }) goodPartYield?: number;
  @ApiProperty({ nullable: true }) machineLengthMm?: number;
  @ApiProperty({ nullable: true }) machineWidthMm?: number;
  @ApiProperty({ nullable: true }) machineLifeYr?: number;
  @ApiProperty({ nullable: true }) machinePowerKw?: number;
  @ApiProperty({ nullable: true }) machineUptimePct?: number;
  @ApiProperty({ nullable: true }) annualMaintenanceFactorPct?: number;
  @ApiProperty({ nullable: true }) footprintAllowanceFactor?: number;
  @ApiProperty({ nullable: true }) installationFactorPct?: number;

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
      // The resolver returns value: null (not a fabricated number) for
      // 'no_rate'/legacy 'generic_fallback' — collapses to undefined here,
      // rendering as "-" rather than a misleading "$0.00". 'benchmark' DOES
      // show its real (non-zero) number, with laborRateSource below telling
      // the UI to caveat it.
      usdLhrTotal: resolved.laborRateUsdHr.value ?? undefined,
      currency: row.currency ?? undefined,
      currencySymbol: row.currency_symbol ?? undefined,
      mhrUsdPerHour: row.mhr_usd_per_hour ? parseFloat(row.mhr_usd_per_hour) : undefined,
      fullyBurdenedLocalPerHr: row.fully_burdened_local_per_hr ? parseFloat(row.fully_burdened_local_per_hr) : undefined,
      fullyBurdenedUsdPerHr: row.fully_burdened_usd_per_hr ? parseFloat(row.fully_burdened_usd_per_hr) : undefined,
      lhrUsdEffective: row.lhr_usd_effective ? parseFloat(row.lhr_usd_effective) : undefined,
      specs: row.specs ?? undefined,
      directOverheadRate: resolved.directOverheadRate.value ?? undefined,
      indirectOverheadRate: resolved.indirectOverheadRate.value ?? undefined,
      directOverheadSource: resolved.directOverheadRate.source,
      indirectOverheadSource: resolved.indirectOverheadRate.source,
      laborRateSource: resolved.laborRateUsdHr.source,
      economicsVersion: row.economics_version ?? undefined,
      benchmarkDirectOverheadRateUsdHr: row.benchmark_direct_overhead_rate_usd_hr ? parseFloat(row.benchmark_direct_overhead_rate_usd_hr) : undefined,
      benchmarkIndirectOverheadRateUsdHr: row.benchmark_indirect_overhead_rate_usd_hr ? parseFloat(row.benchmark_indirect_overhead_rate_usd_hr) : undefined,
      benchmarkLaborRateUsdHr: row.benchmark_labor_rate_usd_hr ? parseFloat(row.benchmark_labor_rate_usd_hr) : undefined,
      benchmarkSourceKey: row.benchmark_source_key ?? undefined,
      calculatedMhrUsdHr: row.calculated_mhr_usd_hr != null ? parseFloat(row.calculated_mhr_usd_hr) : undefined,
      legacyImportedMhrUsdHr: row.legacy_imported_mhr_usd_hr != null ? parseFloat(row.legacy_imported_mhr_usd_hr) : undefined,
      mhrSource: row.mhr_source ?? undefined,
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
      laborTimeStandard: row.labor_time_standard ? parseFloat(row.labor_time_standard) : undefined,
      avgUtilization: row.avg_utilization ? parseFloat(row.avg_utilization) : undefined,
      goodPartYield: row.good_part_yield ? parseFloat(row.good_part_yield) : undefined,
      machineLengthMm: row.machine_length_mm ? parseFloat(row.machine_length_mm) : undefined,
      machineWidthMm: row.machine_width_mm ? parseFloat(row.machine_width_mm) : undefined,
      machineLifeYr: row.machine_life_yr ? parseFloat(row.machine_life_yr) : undefined,
      machinePowerKw: row.machine_power_kw ? parseFloat(row.machine_power_kw) : undefined,
      machineUptimePct: row.machine_uptime_pct ? parseFloat(row.machine_uptime_pct) : undefined,
      annualMaintenanceFactorPct: row.annual_maintenance_factor_pct ? parseFloat(row.annual_maintenance_factor_pct) : undefined,
      footprintAllowanceFactor: row.footprint_allowance_factor ? parseFloat(row.footprint_allowance_factor) : undefined,
      installationFactorPct: row.installation_factor_pct ? parseFloat(row.installation_factor_pct) : undefined,
      calculations: JSON.parse(row.calculations || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// Read-only lookup joining an mhr_records row to its sm_reference_data source
// row (by benchmark_source_key, falling back to a machine-name match). Full
// machine_library.json detail for a row stays visible (press force, roll
// diameter, RPM, tool costs, etc.) without duplicating that data onto
// mhr_records itself or letting a user hand-type it as free JSON.
export class MHRReferenceDetailDto {
  @ApiProperty()
  found: boolean;

  @ApiProperty({ nullable: true })
  sourceKey: string | null;

  @ApiProperty({ nullable: true, type: Object })
  raw: Record<string, any> | null;
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
