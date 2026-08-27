import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// Types
export interface ProcessCalculatorMapping {
  id: string;
  processGroup: string;
  processRoute: string;
  operation: string;
  machineClass?: string;
  lhrProcessGroup?: string;
  calculatorId?: string;
  calculatorName?: string;
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  // Real reconciliation-export cross-reference (sm_operation_reference_map,
  // migration 504) — present only for operations with a clean, justified
  // name match; informational only, never a live cost input.
  referenceHint?: { sourceProcessName: string; exampleMachine: string | null };
}

export interface ProcessHierarchy {
  processGroups: string[];
  processRoutes: string[];
  operations: string[];
}

export interface QueryProcessCalculatorMappingsParams {
  processGroup?: string;
  processRoute?: string;
  operation?: string;
  calculatorId?: string;
  isActive?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateProcessCalculatorMappingDto {
  processGroup: string;
  processRoute: string;
  operation: string;
  calculatorId?: string;
  calculatorName?: string;
  isActive?: boolean;
  displayOrder?: number;
}

export interface UpdateProcessCalculatorMappingDto extends Partial<CreateProcessCalculatorMappingDto> {}

// Query Keys
const QUERY_KEYS = {
  mappings: (params?: QueryProcessCalculatorMappingsParams) => ['process-calculator-mappings', params],
  mapping: (id: string) => ['process-calculator-mapping', id],
  hierarchy: () => ['process-hierarchy'],
};

// API Functions
const processCalculatorMappingsApi = {
  getAll: async (params?: QueryProcessCalculatorMappingsParams) => {
    return apiClient.get<{
      mappings: ProcessCalculatorMapping[];
      count: number;
      page: number;
      limit: number;
    }>('/processes/calculator-mappings', { ...(params !== undefined ? { params } : {}) });
  },

  getOne: async (id: string) => {
    return apiClient.get<ProcessCalculatorMapping>(`/processes/calculator-mappings/${id}`);
  },

  getHierarchy: async () => {
    return apiClient.get<ProcessHierarchy>('/processes/calculator-mappings/hierarchy');
  },

  create: async (data: CreateProcessCalculatorMappingDto) => {
    return apiClient.post<ProcessCalculatorMapping>('/processes/calculator-mappings', data);
  },

  update: async (id: string, data: UpdateProcessCalculatorMappingDto) => {
    return apiClient.put<ProcessCalculatorMapping>(`/processes/calculator-mappings/${id}`, data);
  },

  delete: async (id: string) => {
    return apiClient.delete(`/processes/calculator-mappings/${id}`);
  },

  importExcel: async (file: File, replaceExisting = false) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('replaceExisting', String(replaceExisting));
    return apiClient.uploadFiles<{ imported: number; skipped: number }>(
      '/processes/calculator-mappings/import-excel',
      formData,
    );
  },

  clearAll: async () => {
    return apiClient.delete<{ deleted: number }>('/processes/calculator-mappings');
  },
};

// Hooks
export function useProcessCalculatorMappings(
  params?: QueryProcessCalculatorMappingsParams | string,
  options?: { enabled?: boolean }
) {
  // Support both old signature (operationId as string) and new signature (params object)
  const queryParams = typeof params === 'string' ? { operation: params } : params;

  return useQuery({
    queryKey: QUERY_KEYS.mappings(queryParams),
    queryFn: () => processCalculatorMappingsApi.getAll(queryParams),
    enabled: options?.enabled !== false,
    // Same fix as useLHRBenchmark/useMHRBenchmark for the exact same bug:
    // whichever result this exact params shape got BEFORE a transient
    // backend outage (confirmed live — the API server can crash mid-session
    // and stay down) permanently caches that empty/partial result for the
    // rest of the browser tab's life otherwise. Confirmed live: this exact
    // failure mode made MHRFormDialog's Process Route dropdown show only 1
    // of 13 real Sheet Metal routes after the backend had restarted —
    // nothing forced a re-fetch of the already-cached key.
    refetchOnMount: 'always',
    throwOnError: false,
  });
}

export function useProcessCalculatorMapping(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.mapping(id),
    queryFn: () => processCalculatorMappingsApi.getOne(id),
    enabled: !!id,
  });
}

export function useProcessHierarchy() {
  return useQuery({
    queryKey: QUERY_KEYS.hierarchy(),
    queryFn: () => processCalculatorMappingsApi.getHierarchy(),
    // Same reasoning as useProcessCalculatorMappings above.
    refetchOnMount: 'always',
    throwOnError: false,
  });
}

export function useCreateProcessCalculatorMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProcessCalculatorMappingDto) => processCalculatorMappingsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['process-calculator-mappings'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.hierarchy() });
    },
  });
}

export function useUpdateProcessCalculatorMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProcessCalculatorMappingDto }) =>
      processCalculatorMappingsApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['process-calculator-mappings'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.mapping(id) });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.hierarchy() });
    },
  });
}

export function useDeleteProcessCalculatorMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => processCalculatorMappingsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['process-calculator-mappings'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.hierarchy() });
    },
  });
}

export function useImportProcessCalculatorMappings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, replaceExisting }: { file: File; replaceExisting?: boolean }) =>
      processCalculatorMappingsApi.importExcel(file, replaceExisting),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['process-calculator-mappings'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.hierarchy() });
    },
  });
}

export function useClearAllProcessCalculatorMappings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => processCalculatorMappingsApi.clearAll(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['process-calculator-mappings'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.hierarchy() });
    },
  });
}

// Helper hook to get calculator for a specific process combination
export function useCalculatorForProcess(processGroup?: string, processRoute?: string, operation?: string) {
  return useQuery({
    queryKey: ['process-calculator', processGroup, processRoute, operation],
    queryFn: async () => {
      if (!processGroup || !processRoute || !operation) {
        return null;
      }

      const response = await processCalculatorMappingsApi.getAll({
        processGroup,
        processRoute,
        operation,
        isActive: true,
      });

      return response.mappings[0] || null;
    },
    enabled: !!processGroup && !!processRoute && !!operation,
  });
}
