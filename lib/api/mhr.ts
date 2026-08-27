/**
 * MHR (Machine Hour Rate) API
 */

import { apiClient } from './client';

export type MHRCalculationResult = {
  workingHoursPerYear: number;
  availableHoursPerYear: number;
  effectiveHoursPerYear: number;
  depreciationPerHour: number;
  interestPerHour: number;
  insurancePerHour: number;
  rentPerHour: number;
  maintenancePerHour: number;
  electricityPerHour: number;
  costOfOwnershipPerHour: number;
  totalFixedCostPerHour: number;
  totalVariableCostPerHour: number;
  totalOperatingCostPerHour: number;
  adminOverheadPerHour: number;
  profitMarginPerHour: number;
  totalMachineHourRate: number;
  depreciationPerAnnum: number;
  interestPerAnnum: number;
  insurancePerAnnum: number;
  rentPerAnnum: number;
  maintenancePerAnnum: number;
  electricityPerAnnum: number;
  totalFixedCostPerAnnum: number;
  totalVariableCostPerAnnum: number;
  totalAnnualCost: number;
  accessoriesCost: number;
  installationCost: number;
  totalCapitalInvestment: number;
};

export type MHRRecord = {
  id: string;
  userId: string;
  location: string;
  commodityCode: string;
  machineDescription?: string;
  manufacturer?: string;
  model?: string;
  machineName: string;
  specification?: string;
  shiftsPerDay: number;
  hoursPerShift: number;
  workingDaysPerYear: number;
  plannedMaintenanceHoursPerYear: number;
  capacityUtilizationRate: number;
  landedMachineCost: number;
  accessoriesCostPercentage: number;
  installationCostPercentage: number;
  paybackPeriodYears: number;
  interestRatePercentage: number;
  insuranceRatePercentage: number;
  machineFootprintSqm: number;
  rentPerSqmPerMonth: number;
  maintenanceCostPercentage: number;
  powerKwhPerHour: number;
  electricityCostPerKwh: number;
  adminOverheadPercentage: number;
  profitMarginPercentage: number;
  isManualEntry: boolean;
  manualMHRValue?: number;
  // India 2026 extended fields
  processGroup?: string;
  processRoute?: string;
  operation?: string;
  processCategory?: string;
  machineClass?: string;
  automationLevel?: string;
  operators?: number;
  wageGrade?: string;
  machinePriceUsd?: number;
  manufacturerCountry?: string;
  setupTimeHr?: number;
  lhrInrPerHr?: number;
  usdLaborRatePerHr?: number;
  usdLhrBase?: number;
  usdLhrBurden?: number;
  usdLhrTotal?: number;
  // Multi-currency fields
  currency?: string;
  currencySymbol?: string;
  mhrUsdPerHour?: number;
  fullyBurdenedLocalPerHr?: number;
  fullyBurdenedUsdPerHr?: number;
  lhrUsdEffective?: number;
  specs?: Record<string, any>;
  directOverheadRate?: number;
  indirectOverheadRate?: number;
  // Economics provenance (Phase 1, "Machine Economics" initiative, see
  // backend's economics-resolver.ts) — one tier per rate field:
  // 'shop_override' (human-entered) | 'imported' (Excel bulk import) |
  // 'benchmark' (machine_library.json reference data) | 'generic_fallback'
  // (no data on file). Never render a 'benchmark'/'generic_fallback' value
  // as if it were this shop's own confirmed rate.
  directOverheadSource?: string;
  indirectOverheadSource?: string;
  laborRateSource?: string;
  economicsVersion?: number;
  // Industry-benchmark lane — present once a machine_library.json match
  // exists, even after a real value supersedes it above, so the UI can show
  // "your rate vs. the benchmark".
  benchmarkDirectOverheadRateUsdHr?: number;
  benchmarkIndirectOverheadRateUsdHr?: number;
  benchmarkLaborRateUsdHr?: number;
  // sm_reference_data.key ("<category>:<machine name>") — the part before
  // ':' is the machine's real machine_library category, a useful fallback
  // display for rows with no machine_class.
  benchmarkSourceKey?: string;
  // Migration 580 (Machine Economics, bottom-up MHR) — a genuine machine-hour
  // rate computed from real capex/lifecycle fields, independent of Direct/
  // Indirect OH and LHR. undefined when the machine lacks the inputs to
  // compute it.
  calculatedMhrUsdHr?: number;
  // Snapshot of manualMHRValue as it stood before migration 580, for rows
  // where that value was actually Direct+Indirect overhead (migration 564's
  // import stopgap) — preserved for audit, never a real machine-hour rate.
  legacyImportedMhrUsdHr?: number;
  // 'calculated' | 'manual' | 'legacy_import' — see calculatedMhrUsdHr/
  // legacyImportedMhrUsdHr above. Display/reference metadata only; real
  // quote costing still reads totalMachineHourRate/manualMHRValue.
  mhrSource?: string;
  // Real machine capability (mhr_records.max_tonnage/power_kw) — used to
  // auto-fill a calculator's "Selected Tonnage"/"Laser Machine Power" from
  // the actual selected machine, never inferred from its name string. Not
  // to be confused with powerKwhPerHour above (electricity consumption).
  maxTonnage?: number;
  powerKw?: number;
  // Remaining capability columns (migration 324/339) — same real data
  // machine-selection/selector.ts's fetchMachinePool() reads for ranking.
  maxXMm?: number;
  maxYMm?: number;
  maxZMm?: number;
  maxDiameterMm?: number;
  maxLengthMm?: number;
  maxThicknessMm?: number;
  maxWorkpieceWeightKg?: number;
  maxThicknessMsMm?: number;
  maxThicknessSsMm?: number;
  maxThicknessAlMm?: number;
  maxThicknessCuMm?: number;
  cuttableMaterials?: string[];
  capabilityVersion?: number;
  // 'imported' = verified nameplate/OEM record; 'seed' = real, sourced, but
  // NOT this specific unit's own verified reading (e.g. a documented
  // typical model config used as a disclosed estimate — migration 459).
  // Never render maxTonnage/powerKw as "Verified" when this is 'seed'.
  capabilitySource?: string;
  // Tier 1 universal machine_library.json economics/lifecycle fields
  // (migration 573) — real, present across all 15 Sheet Metal categories.
  laborTimeStandard?: number;
  avgUtilization?: number;
  goodPartYield?: number;
  machineLengthMm?: number;
  machineWidthMm?: number;
  machineLifeYr?: number;
  machinePowerKw?: number;
  machineUptimePct?: number;
  annualMaintenanceFactorPct?: number;
  footprintAllowanceFactor?: number;
  installationFactorPct?: number;
  calculations: MHRCalculationResult;
  createdAt: string;
  updatedAt: string;
};

// process_cost_records.machine_rate is always stored in USD (see backend's
// apply-route toUsd() convention) — prefer the USD-normalised field so a
// non-USA-location machine's local-currency rate isn't misread as a USD
// number. Shared by every UI that lists real MHR records for picking.
export function resolveMhrUsdRate(r: MHRRecord): number {
  // fullyBurdenedLocalPerHr is machine + labour combined (see mhr.service.ts's
  // calculateMHR) — deliberately excluded here. This rate ends up as the "machine"
  // side of a formula (ProcessCostDialog, cost-engine.ts) that always separately adds
  // its own labour term; substituting the burdened figure would double-count labour.
  return r.mhrUsdPerHour ?? r.calculations?.totalMachineHourRate ?? r.manualMHRValue ?? 0;
}

export type CreateMHRData = {
  location: string;
  commodityCode: string;
  machineDescription?: string;
  manufacturer?: string;
  model?: string;
  machineName: string;
  specification?: string;
  shiftsPerDay: number;
  hoursPerShift: number;
  workingDaysPerYear: number;
  plannedMaintenanceHoursPerYear: number;
  capacityUtilizationRate: number;
  landedMachineCost: number;
  accessoriesCostPercentage: number;
  installationCostPercentage: number;
  paybackPeriodYears: number;
  interestRatePercentage: number;
  insuranceRatePercentage: number;
  machineFootprintSqm: number;
  rentPerSqmPerMonth: number;
  maintenanceCostPercentage: number;
  powerKwhPerHour: number;
  electricityCostPerKwh: number;
  adminOverheadPercentage: number;
  profitMarginPercentage: number;
  isManualEntry?: boolean;
  manualMHRValue?: number;
  // India 2026 extended fields
  processGroup?: string;
  processRoute?: string;
  operation?: string;
  machineClass?: string;
  automationLevel?: string;
  wageGrade?: string;
  operators?: number;
  machinePriceUsd?: number;
  manufacturerCountry?: string;
  setupTimeHr?: number;
  lhrInrPerHr?: number;
  usdLaborRatePerHr?: number;
  usdLhrBase?: number;
  usdLhrBurden?: number;
  usdLhrTotal?: number;
  directOverheadRate?: number;
  indirectOverheadRate?: number;
  specs?: Record<string, any>;
  // Machine capability — see MHRRecord's identical block for context.
  maxXMm?: number;
  maxYMm?: number;
  maxZMm?: number;
  maxDiameterMm?: number;
  maxLengthMm?: number;
  maxTonnage?: number;
  maxThicknessMm?: number;
  maxWorkpieceWeightKg?: number;
  powerKw?: number;
  maxThicknessMsMm?: number;
  maxThicknessSsMm?: number;
  maxThicknessAlMm?: number;
  maxThicknessCuMm?: number;
  cuttableMaterials?: string[];
};

export type UpdateMHRData = Partial<CreateMHRData>;

export type MHRQuery = {
  search?: string;
  location?: string;
  currency?: string;
  commodityCode?: string;
  processGroup?: string;
  machineClass?: string;
  page?: number;
  limit?: number;
};

export type MHRListResponse = {
  records: MHRRecord[];
  total: number;
  page: number;
  limit: number;
};

// Read-only join to the machine's sm_reference_data source row — full
// machine_library.json detail for a record (press force, roll diameter,
// RPM, tool costs, etc.) without duplicating it onto mhr_records itself.
export type MHRReferenceDetail = {
  found: boolean;
  sourceKey: string | null;
  raw: Record<string, any> | null;
};

export type MHRBenchmarkEntry = {
  id: string;
  machineName: string;
  processGroup: string;
  machineClass?: string;
  location: string;
  machineRef?: string;
  isBenchmark: true;
  calculations: { totalMachineHourRate: number };
};

export const mhrApi = {
  /**
   * Get all MHR records
   */
  getAll: async (query?: MHRQuery): Promise<MHRListResponse | null> => {
    const params = new URLSearchParams();
    if (query?.search) params.append('search', query.search);
    if (query?.location) params.append('location', query.location);
    if (query?.currency) params.append('currency', query.currency);
    if (query?.commodityCode) params.append('commodityCode', query.commodityCode);
    if (query?.processGroup) params.append('processGroup', query.processGroup);
    if (query?.machineClass) params.append('machineClass', query.machineClass);
    if (query?.page) params.append('page', query.page.toString());
    if (query?.limit) params.append('limit', query.limit.toString());

    const queryString = params.toString();
    // 2026 Best Practice: Silent mode for background/optional data
    return apiClient.get<MHRListResponse>(
      `/mhr${queryString ? `?${queryString}` : ''}`,
      {
        silent: true, // Don't show error toasts for background data
        retry: false, // Fail fast - don't retry background data
      },
    );
  },

  /**
   * Get distinct real machine categories (benchmark_source_key-derived, machine_class fallback),
   * optionally scoped to a real process group (e.g. "Sheet Metal", "Machining").
   */
  getCategories: async (processGroup?: string): Promise<string[]> => {
    return (await apiClient.get<string[]>('/mhr/categories', {
      silent: true, retry: false,
      ...(processGroup ? { params: { processGroup } } : {}),
    })) ?? [];
  },

  /**
   * Get distinct locations from MHR records
   */
  getLocations: async (): Promise<string[]> => {
    return (await apiClient.get<string[]>('/mhr/locations', { silent: true, retry: false })) ?? [];
  },

  /**
   * Get distinct currencies from MHR records
   */
  getCurrencies: async (): Promise<string[]> => {
    return (await apiClient.get<string[]>('/mhr/currencies', { silent: true, retry: false })) ?? [];
  },

  /**
   * Get distinct manufacturer countries from MHR records
   */
  getManufacturerCountries: async (): Promise<string[]> => {
    return (await apiClient.get<string[]>('/mhr/manufacturer-countries', { silent: true, retry: false })) ?? [];
  },

  /**
   * Get MHR record by ID
   */
  getById: async (id: string): Promise<MHRRecord> => {
    return apiClient.get<MHRRecord>(`/mhr/${id}`);
  },

  /**
   * Get full machine_library reference detail for an MHR record (read-only)
   */
  getReferenceDetail: async (id: string): Promise<MHRReferenceDetail> => {
    return (await apiClient.get<MHRReferenceDetail>(`/mhr/${id}/reference-detail`, { silent: true, retry: false })) ?? { found: false, sourceKey: null, raw: null };
  },

  /**
   * Create new MHR record
   */
  create: async (data: CreateMHRData): Promise<MHRRecord> => {
    return apiClient.post<MHRRecord>('/mhr', data);
  },

  /**
   * Update MHR record
   */
  update: async (id: string, data: UpdateMHRData): Promise<MHRRecord> => {
    return apiClient.put<MHRRecord>(`/mhr/${id}`, data);
  },

  /**
   * Delete MHR record
   */
  delete: async (id: string): Promise<void> => {
    return apiClient.delete(`/mhr/${id}`);
  },

  /**
   * Delete all MHR records for the current user
   */
  deleteAll: async (): Promise<{ deleted: number }> => {
    return apiClient.delete<{ deleted: number }>('/mhr') ?? { deleted: 0 };
  },

  getBenchmarkRates: async (location?: string, processGroup?: string, machineClass?: string): Promise<MHRBenchmarkEntry[]> => {
    const params = new URLSearchParams();
    if (location) params.append('location', location);
    if (machineClass) params.append('machineClass', machineClass);
    else if (processGroup) params.append('processGroup', processGroup);
    const qs = params.toString();
    return (await apiClient.get<MHRBenchmarkEntry[]>(`/mhr/benchmark${qs ? `?${qs}` : ''}`, { silent: true, retry: false })) ?? [];
  },

  /**
   * Import MHR records from Excel file
   */
  importFromExcel: async (file: File): Promise<{ imported: number; skipped: number; errors: string[] }> => {
    const formData = new FormData();
    formData.append('file', file);
    return (await apiClient.uploadFiles<{ imported: number; skipped: number; errors: string[] }>(
      '/mhr/import-excel',
      formData,
    )) ?? { imported: 0, skipped: 0, errors: [] };
  },
};
