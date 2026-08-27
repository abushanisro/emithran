import { apiClient } from './client';

export interface LHREntry {
  id: string | number;
  labourCode: string;
  labourType: string;
  description: string;
  minimumWagePerDay: number;
  minimumWagePerMonth: number;
  dearnessAllowance: number;
  perksPercentage: number;
  lhr: number;
  reference?: string;
  location: string;
  // India 2026 extended fields
  processGroup?: string;
  machineName?: string;
  machineDescription?: string;
  manufacturer?: string;
  manufacturerCountry?: string;
  wageGrade?: string;
  operators?: number;
  shiftsPerDay?: number;
  hoursPerShift?: number;
  workingDaysPerYear?: number;
  totalHrsPerYear?: number;
  usdLaborRatePerHr?: number;
  usdLhrBase?: number;
  usdLhrBurden?: number;
  usdLhrTotal?: number;
  currency?: string;
  currencySymbol?: string;
  lhrUsdEffective?: number;
  employerBurdenPercentage?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLHRDto {
  labourCode: string;
  labourType: string;
  description: string;
  minimumWagePerDay: number;
  minimumWagePerMonth: number;
  dearnessAllowance: number;
  perksPercentage: number;
  lhr: number;
  reference?: string;
  location?: string;
  // India 2026 extended fields
  processGroup?: string;
  machineName?: string;
  machineDescription?: string;
  manufacturer?: string;
  manufacturerCountry?: string;
  wageGrade?: string;
  operators?: number;
  shiftsPerDay?: number;
  hoursPerShift?: number;
  workingDaysPerYear?: number;
  totalHrsPerYear?: number;
  usdLaborRatePerHr?: number;
  usdLhrBase?: number;
  usdLhrBurden?: number;
  usdLhrTotal?: number;
  lhrUsdEffective?: number;
  currency?: string;
  currencySymbol?: string;
}

export interface UpdateLHRDto extends Partial<CreateLHRDto> { }

export type LHRListResponse = { records: LHREntry[]; total: number };

export interface EffectiveLHRRate {
  rateUsdPerHr: number | null;
  source: 'shop_average' | 'benchmark' | 'none';
  sampleSize: number;
}

export interface BenchmarkLHREntry {
  id: string;
  labourCode: string;
  labourType: string;
  description: string;
  lhr: number;           // USD/hr (already converted)
  location: string;
  processGroup: string;
  currency: 'USD';
  currencySymbol: '$';
  lhrUsdEffective: number;
  isBenchmark: true;
  minimumWagePerDay: 0;
  minimumWagePerMonth: 0;
  dearnessAllowance: 0;
  perksPercentage: 0;
  createdAt: string;
  updatedAt: string;
}

export const lhrApi = {
  getAll: async (search?: string): Promise<LHRListResponse> => {
    const params = search ? { search } : {};
    const response = await apiClient.get<LHRListResponse>('/lhr', {
      params,
      silent: true,
      retry: false,
    });
    return response ?? { records: [], total: 0 };
  },

  getById: async (id: string | number): Promise<LHREntry> => {
    const response = await apiClient.get<LHREntry>(`/lhr/${id}`);
    if (!response) throw new Error('LHR record not found');
    return response;
  },

  getByLabourCode: async (labourCode: string): Promise<LHREntry> => {
    const response = await apiClient.get<LHREntry>(`/lhr/code/${labourCode}`);
    if (!response) throw new Error('Labour code not found');
    return response;
  },

  create: async (data: CreateLHRDto): Promise<LHREntry> => {
    const response = await apiClient.post<LHREntry>('/lhr', data);
    if (!response) throw new Error('Failed to create LHR record');
    return response;
  },

  update: async (id: string | number, data: UpdateLHRDto): Promise<LHREntry> => {
    const response = await apiClient.put<LHREntry>(`/lhr/${id}`, data);
    if (!response) throw new Error('Failed to update LHR record');
    return response;
  },

  delete: async (id: string | number): Promise<void> => {
    await apiClient.delete(`/lhr/${id}`);
  },

  deleteAll: async (): Promise<{ deleted: number }> => {
    const response = await apiClient.delete<{ deleted: number }>('/lhr');
    return response ?? { deleted: 0 };
  },

  bulkCreate: async (data: CreateLHRDto[]): Promise<LHREntry[]> => {
    const response = await apiClient.post<LHREntry[]>('/lhr/bulk', data);
    return response || [];
  },

  getBenchmarkRates: async (location?: string): Promise<BenchmarkLHREntry[]> => {
    const params = location ? { location } : {};
    const response = await apiClient.get<BenchmarkLHREntry[]>('/lhr/benchmark', {
      params,
      silent: true,
      retry: false,
    });
    return response ?? [];
  },

  // The real cost-engine-aligned Skill Rate preview for a (location,
  // process_group) — same precedence bom-items.service.ts's resolveLHRRates()
  // already uses for real quote costing (LHRService.getEffectiveRate).
  getEffectiveRate: async (location: string, processGroup: string): Promise<EffectiveLHRRate> => {
    const response = await apiClient.get<EffectiveLHRRate>('/lhr/effective-rate', {
      params: { location, processGroup },
      silent: true,
      retry: false,
    });
    return response ?? { rateUsdPerHr: null, source: 'none', sampleSize: 0 };
  },

  importFromExcel: async (file: File): Promise<{ imported: number; skipped: number; errors: string[] }> => {
    const formData = new FormData();
    formData.append('file', file);
    return (await apiClient.uploadFiles<{ imported: number; skipped: number; errors: string[] }>(
      '/lhr/import-excel',
      formData,
    )) ?? { imported: 0, skipped: 0, errors: [] };
  },
};
