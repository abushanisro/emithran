/**
 * React hooks for Child Part Cost API
 *
 * Provides hooks for calculating and managing child part costs
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

export interface ChildPartCostInput {
  makeBuy: 'make' | 'buy';
  partNumber?: string;
  partName?: string;
  // For purchased parts (buy)
  unitCost?: number;
  freight?: number;
  duty?: number;
  overhead?: number;
  // For manufactured parts (make)
  rawMaterialCost?: number;
  processCost?: number;
  // Quality parameters
  scrap?: number;
  defectRate?: number;
  // Quantity
  quantity?: number;
  moq?: number;
  leadTimeDays?: number;
  currency?: string;
}

export interface ChildPartCostResult {
  partNumber: string;
  partName: string;
  makeBuy: 'make' | 'buy';
  currency: string;
  baseCost: number;
  freightCost: number;
  dutyCost: number;
  overheadCost: number;
  costBeforeQuality: number;
  scrapPercentage: number;
  defectRatePercentage: number;
  scrapAdjustment: number;
  defectAdjustment: number;
  qualityFactor: number;
  totalCostPerPart: number;
  extendedCost: number;
  quantity: number;
  moq: number;
  leadTimeDays: number;
  moqExtendedCost: number;
  freightPercentage: number;
  dutyPercentage: number;
  overheadPercentage: number;
  scrapCostPercentage: number;
  defectCostPercentage: number;
  rawMaterialCost?: number;
  processCost?: number;
  rawMaterialPercentage?: number;
  processCostPercentage?: number;
}

export interface CreateChildPartCostDto extends ChildPartCostInput {
  bomItemId: string;
  description?: string;
  supplierId?: string;
  supplierName?: string;
  supplierLocation?: string;
  notes?: string;
  isActive?: boolean;
}

export interface ChildPartCostRecord extends ChildPartCostResult {
  id: string;
  bomItemId: string;
  userId: string;
  supplierId?: string;
  supplierName?: string;
  supplierLocation?: string;
  notes?: string;
  isActive: boolean;
  calculationBreakdown: any;
  createdAt: string;
  updatedAt: string;
}

/**
 * Hook to calculate child part cost without saving (preview)
 */
export function useCalculateChildPartCost() {
  return useMutation<ChildPartCostResult, Error, ChildPartCostInput>({
    mutationFn: async (input: ChildPartCostInput) => {
      const result = await apiClient.post<ChildPartCostResult>('/child-part-costs/calculate', input);
      return result;
    },
  });
}

/**
 * Hook to create a child part cost record
 */
export function useCreateChildPartCost() {
  const queryClient = useQueryClient();

  return useMutation<ChildPartCostRecord, Error, CreateChildPartCostDto>({
    mutationFn: async (data: CreateChildPartCostDto) => {
      const result = await apiClient.post<ChildPartCostRecord>('/child-part-costs', data);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['child-part-costs'] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-costs'] });
    },
  });
}

/**
 * Hook to update a child part cost record
 */
export function useUpdateChildPartCost() {
  const queryClient = useQueryClient();

  return useMutation<ChildPartCostRecord, Error, { id: string; data: Partial<CreateChildPartCostDto> }>({
    mutationFn: async ({ id, data }) => {
      const result = await apiClient.put<ChildPartCostRecord>(`/child-part-costs/${id}`, data);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['child-part-costs'] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-costs'] });
    },
  });
}

/**
 * Hook to delete a child part cost record
 */
export function useDeleteChildPartCost() {
  const queryClient = useQueryClient();

  return useMutation<{ message: string }, Error, string>({
    mutationFn: async (id: string) => {
      const result = await apiClient.delete<{ message: string }>(`/child-part-costs/${id}`);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['child-part-costs'] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-costs'] });
    },
  });
}

/**
 * Hook to get child part cost by BOM item ID
 */
export function useChildPartCostByBomItem(bomItemId: string | null) {
  return useQuery<ChildPartCostRecord | null, Error>({
    queryKey: ['child-part-cost-by-bom-item', bomItemId],
    queryFn: async () => {
      if (!bomItemId) return null;
      const result = await apiClient.get<ChildPartCostRecord>(`/child-part-costs/bom-item/${bomItemId}`);
      return result;
    },
    enabled: !!bomItemId,
  });
}

/**
 * Hook to get all child part costs (paginated)
 */
export function useChildPartCosts(params?: {
  bomItemId?: string;
  makeBuy?: 'make' | 'buy';
  search?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['child-part-costs', params],
    queryFn: async () => {
      // Use silent mode to prevent console errors for expected failures
      const result = await apiClient.get<{ childPartCosts: ChildPartCostRecord[]; count: number; page: number; limit: number } | null>(
        '/child-part-costs',
        { ...(params !== undefined ? { params } : {}), silent: true }
      );

      // If result is null (error occurred), return empty data
      if (!result) {
        return { childPartCosts: [], count: 0, page: 1, limit: 10 };
      }

      // Ensure we always return a defined value matching the API structure
      return result || { childPartCosts: [], count: 0, page: 1, limit: 10 };
    },
    enabled: !!params?.bomItemId, // Only run if bomItemId is provided
  });
}
