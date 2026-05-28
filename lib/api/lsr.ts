import { apiClient } from './client';

export interface LSREntry {
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
  createdAt: string;
  updatedAt: string;
}

export interface CreateLSRDto {
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
}

export interface UpdateLSRDto extends Partial<CreateLSRDto> { }

export const lsrApi = {
  getAll: async (search?: string): Promise<LSREntry[]> => {
    const params = search ? { search } : {};
    // 2026 Best Practice: Silent mode for background/optional data
    const response = await apiClient.get<LSREntry[]>('/lsr', {
      params,
      silent: true, // Don't show error toasts for background data
      retry: false, // Fail fast - don't retry background data
    });
    return response || [];
  },

  getById: async (id: string | number): Promise<LSREntry> => {
    const response = await apiClient.get<LSREntry>(`/lsr/${id}`);
    if (!response) throw new Error('LSR record not found');
    return response;
  },

  getByLabourCode: async (labourCode: string): Promise<LSREntry> => {
    const response = await apiClient.get<LSREntry>(`/lsr/code/${labourCode}`);
    if (!response) throw new Error('Labour code not found');
    return response;
  },

  create: async (data: CreateLSRDto): Promise<LSREntry> => {
    const response = await apiClient.post<LSREntry>('/lsr', data);
    if (!response) throw new Error('Failed to create LSR record');
    return response;
  },

  update: async (id: string | number, data: UpdateLSRDto): Promise<LSREntry> => {
    const response = await apiClient.put<LSREntry>(`/lsr/${id}`, data);
    if (!response) throw new Error('Failed to update LSR record');
    return response;
  },

  delete: async (id: string | number): Promise<void> => {
    await apiClient.delete(`/lsr/${id}`);
  },

  bulkCreate: async (data: CreateLSRDto[]): Promise<LSREntry[]> => {
    const response = await apiClient.post<LSREntry[]>('/lsr/bulk', data);
    return response || [];
  },

  importFromExcel: async (file: File): Promise<{ imported: number; skipped: number; errors: string[] }> => {
    const formData = new FormData();
    formData.append('file', file);
    return (await apiClient.uploadFiles<{ imported: number; skipped: number; errors: string[] }>(
      '/lsr/import-excel',
      formData,
    )) ?? { imported: 0, skipped: 0, errors: [] };
  },
};
