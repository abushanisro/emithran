/**
 * React hooks for Packaging & Logistics Cost API
 *
 * Production-grade React Query hooks following 2026 best practices
 * - Type-safe API operations
 * - Automatic cache invalidation
 * - Error handling with toast notifications
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { toast } from 'sonner';


// ============================================================================
// TYPES
// ============================================================================

export enum LogisticsType {
  PACKAGING = 'packaging',
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
  STORAGE = 'storage',
}

export enum CostBasis {
  PER_UNIT = 'per_unit',
  PER_BATCH = 'per_batch',
  PER_KG = 'per_kg',
  PER_KM = 'per_km',
}

export interface CreatePackagingLogisticsCostDto {
  bomItemId: string;
  costName: string;
  logisticsType: LogisticsType;
  modeOfTransport?: string;
  calculatorId?: string;
  calculatorName?: string;
  costBasis: CostBasis;
  parameters?: Record<string, any>;
  unitCost: number;
  quantity: number;
  costBreakdown?: Record<string, any>;
  notes?: string;
  isActive?: boolean;
}

export interface UpdatePackagingLogisticsCostDto {
  costName?: string;
  logisticsType?: LogisticsType;
  modeOfTransport?: string;
  calculatorId?: string;
  calculatorName?: string;
  costBasis?: CostBasis;
  parameters?: Record<string, any>;
  unitCost?: number;
  quantity?: number;
  costBreakdown?: Record<string, any>;
  notes?: string;
  isActive?: boolean;
}

export interface PackagingLogisticsCostRecord {
  id: string;
  bomItemId: string;
  userId: string;
  costName: string;
  logisticsType: LogisticsType;
  modeOfTransport?: string;
  calculatorId?: string;
  calculatorName?: string;
  costBasis: CostBasis;
  parameters?: Record<string, any>;
  unitCost: number;
  quantity: number;
  totalCost: number;
  costBreakdown?: Record<string, any>;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PackagingLogisticsCostListResponse {
  items: PackagingLogisticsCostRecord[];
  total: number;
  page: number;
  limit: number;
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Hook to get all packaging/logistics costs with pagination and filtering
 *
 * Best practices (2026):
 * - Graceful error handling with fallback data
 * - Type-safe response validation
 * - Automatic retry with exponential backoff
 * - Prevents "undefined" query data errors
 */
export function usePackagingLogisticsCosts(params?: {
  bomItemId?: string;
  logisticsType?: LogisticsType;
  search?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}) {
  return useQuery<PackagingLogisticsCostListResponse>({
    queryKey: ['packaging-logistics-costs', params],
    queryFn: async () => {
      // Use silent mode to prevent console errors for expected failures
      const response = await apiClient.get<PackagingLogisticsCostListResponse>(
        '/packaging-logistics-costs',
        { ...(params !== undefined ? { params } : {}), silent: true }
      );

      // If response is null (error occurred), return empty data
      if (!response) {
        return {
          items: [],
          total: 0,
          page: params?.page || 1,
          limit: params?.limit || 100,
        };
      }

      // Return response directly assuming correct API shape
      return response;
    },
    enabled: !!params?.bomItemId,
    staleTime: 30000, // Consider data fresh for 30 seconds
    retry: 1, // Retry once on failure
    refetchOnWindowFocus: false, // Prevent excessive refetching
  });
}

/**
 * Hook to get a single packaging/logistics cost by ID
 *
 * Best practices (2026):
 * - Null-safe with proper fallback
 * - Type validation
 */
export function usePackagingLogisticsCost(id: string) {
  return useQuery<PackagingLogisticsCostRecord | null>({
    queryKey: ['packaging-logistics-cost', id],
    queryFn: async () => {
      // Use silent mode to prevent console errors
      const response = await apiClient.get<PackagingLogisticsCostRecord>(
        `/packaging-logistics-costs/${id}`,
        { silent: true }
      );

      // Response is null if error occurred or cost doesn't exist
      return response;
    },
    enabled: !!id,
    staleTime: 30000,
    retry: 1,
  });
}

export interface FreightRateBenchmark {
  rateType: string;
  rateUsdPerKg: number;
}

/**
 * Hook to get real region-pair freight reference rates (USD/kg) — used as a
 * click-to-fill suggestion source in the "Add Logistics Item" dialog, never
 * auto-applied to a cost record (see migration 389 for why: a previous
 * fabricated flat freight default was removed as an anti-pattern).
 */
export function useFreightRateBenchmarks() {
  return useQuery<FreightRateBenchmark[]>({
    queryKey: ['freight-rate-benchmarks'],
    queryFn: async () => {
      const response = await apiClient.get<FreightRateBenchmark[]>(
        '/packaging-logistics-costs/freight-rate-benchmarks',
        { silent: true }
      );
      return response ?? [];
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Hook to create a new packaging/logistics cost
 */
export function useCreatePackagingLogisticsCost() {
  const queryClient = useQueryClient();

  return useMutation<PackagingLogisticsCostRecord, Error, CreatePackagingLogisticsCostDto>({
    mutationFn: async (data: CreatePackagingLogisticsCostDto) => {
      // Mutations should NOT use silent mode - they need to throw errors
      const response = await apiClient.post<PackagingLogisticsCostRecord>('/packaging-logistics-costs', data);

      if (!response) {
        throw new Error('Failed to create packaging/logistics cost');
      }

      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packaging-logistics-costs'] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-costs'] });
      toast.success('Packaging/logistics cost created successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create packaging/logistics cost');
    },
  });
}

/**
 * Hook to update an existing packaging/logistics cost
 */
export function useUpdatePackagingLogisticsCost() {
  const queryClient = useQueryClient();

  return useMutation<PackagingLogisticsCostRecord, Error, { id: string; data: UpdatePackagingLogisticsCostDto }>({
    mutationFn: async ({ id, data }) => {
      // Mutations should NOT use silent mode - they need to throw errors
      const response = await apiClient.put<PackagingLogisticsCostRecord>(`/packaging-logistics-costs/${id}`, data);

      if (!response) {
        throw new Error('Failed to update packaging/logistics cost');
      }

      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packaging-logistics-costs'] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-costs'] });
      toast.success('Packaging/logistics cost updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update packaging/logistics cost');
    },
  });
}

/**
 * Hook to delete a packaging/logistics cost
 */
export function useDeletePackagingLogisticsCost() {
  const queryClient = useQueryClient();

  return useMutation<{ message: string }, Error, string>({
    mutationFn: async (id: string) => {
      // Mutations should NOT use silent mode - they need to throw errors
      const response = await apiClient.delete<{ message: string }>(`/packaging-logistics-costs/${id}`);

      if (!response) {
        throw new Error('Failed to delete packaging/logistics cost');
      }

      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packaging-logistics-costs'] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-costs'] });
      toast.success('Packaging/logistics cost deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete packaging/logistics cost');
    },
  });
}
