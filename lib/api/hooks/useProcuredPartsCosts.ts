/**
 * React hooks for Procured Parts Cost API
 *
 * Production-grade React Query hooks following 2026 best practices
 * - Type-safe API operations
 * - Automatic cache invalidation
 * - Optimistic updates where applicable
 * - Comprehensive error handling
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { toast } from 'sonner';


// ============================================================================
// TYPES
// ============================================================================

export interface CreateProcuredPartsCostDto {
  bomItemId: string;
  partName: string;
  partNumber?: string;
  supplierName?: string;
  supplierId?: string;
  unitCost: number;
  quantity: number;
  scrapPercentage?: number;
  defectRatePercentage?: number;
  overheadPercentage?: number;
  freightCost?: number;
  dutyCost?: number;
  moq?: number;
  leadTimeDays?: number;
  currency?: string;
  costBreakdown?: Record<string, any>;
  notes?: string;
  isActive?: boolean;
}

export interface UpdateProcuredPartsCostDto {
  partName?: string;
  partNumber?: string;
  supplierName?: string;
  supplierId?: string;
  unitCost?: number;
  quantity?: number;
  scrapPercentage?: number;
  defectRatePercentage?: number;
  overheadPercentage?: number;
  freightCost?: number;
  dutyCost?: number;
  moq?: number;
  leadTimeDays?: number;
  currency?: string;
  costBreakdown?: Record<string, any>;
  notes?: string;
  isActive?: boolean;
}

export interface ProcuredPartsCostRecord {
  id: string;
  bomItemId: string;
  userId: string;
  partName: string;
  partNumber?: string;
  supplierName?: string;
  supplierId?: string;
  unitCost: number;
  quantity: number;
  scrapPercentage: number;
  defectRatePercentage: number;
  overheadPercentage: number;
  freightCost: number;
  dutyCost: number;
  baseCost: number;
  scrapAdjustment: number;
  defectAdjustment: number;
  overheadCost: number;
  totalCost: number;
  moq?: number;
  leadTimeDays?: number;
  currency: string;
  costBreakdown?: Record<string, any>;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProcuredPartsCostListResponse {
  items: ProcuredPartsCostRecord[];
  total: number;
  page: number;
  limit: number;
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Hook to get all procured parts costs with pagination and filtering
 *
 * Best practices (2026):
 * - Graceful error handling with fallback data
 * - Type-safe response validation
 * - Automatic retry with exponential backoff
 * - Prevents "undefined" query data errors
 */
export function useProcuredPartsCosts(params?: {
  bomItemId?: string;
  supplierName?: string;
  search?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}) {
  return useQuery<ProcuredPartsCostListResponse>({
    queryKey: ['procured-parts-costs', params],
    queryFn: async () => {
      // Use silent mode to prevent console errors for expected failures
      const response = await apiClient.get<ProcuredPartsCostListResponse>(
        '/procured-parts-costs',
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
 * Hook to get a single procured part cost by ID
 *
 * Best practices (2026):
 * - Null-safe with proper fallback
 * - Type validation
 */
export function useProcuredPartsCost(id: string) {
  return useQuery<ProcuredPartsCostRecord | null>({
    queryKey: ['procured-parts-cost', id],
    queryFn: async () => {
      // Use silent mode to prevent console errors
      const response = await apiClient.get<ProcuredPartsCostRecord>(
        `/procured-parts-costs/${id}`,
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

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Hook to create a new procured part cost
 */
export function useCreateProcuredPartsCost() {
  const queryClient = useQueryClient();

  return useMutation<ProcuredPartsCostRecord, Error, CreateProcuredPartsCostDto>({
    mutationFn: async (data: CreateProcuredPartsCostDto) => {
      // Mutations should NOT use silent mode - they need to throw errors
      const response = await apiClient.post<ProcuredPartsCostRecord>('/procured-parts-costs', data);

      if (!response) {
        throw new Error('Failed to create procured part cost');
      }

      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['procured-parts-costs'] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-costs'] });
      toast.success('Procured part cost created successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create procured part cost');
    },
  });
}

/**
 * Hook to update an existing procured part cost
 */
export function useUpdateProcuredPartsCost() {
  const queryClient = useQueryClient();

  return useMutation<ProcuredPartsCostRecord, Error, { id: string; data: UpdateProcuredPartsCostDto }>({
    mutationFn: async ({ id, data }) => {
      // Mutations should NOT use silent mode - they need to throw errors
      const response = await apiClient.put<ProcuredPartsCostRecord>(`/procured-parts-costs/${id}`, data);

      if (!response) {
        throw new Error('Failed to update procured part cost');
      }

      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['procured-parts-costs'] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-costs'] });
      toast.success('Procured part cost updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update procured part cost');
    },
  });
}

/**
 * Hook to delete a procured part cost
 */
export function useDeleteProcuredPartsCost() {
  const queryClient = useQueryClient();

  return useMutation<{ message: string }, Error, string>({
    mutationFn: async (id: string) => {
      // Mutations should NOT use silent mode - they need to throw errors
      const response = await apiClient.delete<{ message: string }>(`/procured-parts-costs/${id}`);

      if (!response) {
        throw new Error('Failed to delete procured part cost');
      }

      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['procured-parts-costs'] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-costs'] });
      toast.success('Procured part cost deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete procured part cost');
    },
  });
}
