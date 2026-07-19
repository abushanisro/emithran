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
  calculations: MHRCalculationResult;
  createdAt: string;
  updatedAt: string;
};

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
};

export type UpdateMHRData = Partial<CreateMHRData>;

export type MHRQuery = {
  search?: string;
  location?: string;
  currency?: string;
  commodityCode?: string;
  page?: number;
  limit?: number;
};

export type MHRListResponse = {
  records: MHRRecord[];
  total: number;
  page: number;
  limit: number;
};

export type MHRBenchmarkEntry = {
  id: string;
  machineName: string;
  processGroup: string;
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
    if (query?.commodityCode) params.append('commodityCode', query.commodityCode);
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
   * Get distinct process groups from MHR records
   */
  getProcessGroups: async (): Promise<string[]> => {
    return (await apiClient.get<string[]>('/mhr/process-groups', { silent: true, retry: false })) ?? [];
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
   * Get MHR record by ID
   */
  getById: async (id: string): Promise<MHRRecord> => {
    return apiClient.get<MHRRecord>(`/mhr/${id}`);
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

  getBenchmarkRates: async (location?: string, processGroup?: string): Promise<MHRBenchmarkEntry[]> => {
    const params = new URLSearchParams();
    if (location) params.append('location', location);
    if (processGroup) params.append('processGroup', processGroup);
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
