/**
 * React hooks for Tooling Cost API
 *
 * Provides hooks for managing tooling cost records linked to BOM items
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { toast } from 'sonner';

export interface ToolingCostInput {
  toolingType: string;
  description: string;
  specifications?: string;
  unitCost: number;
  quantity: number;
  amortizationParts: number;
  usagePercentage: number;
  isCustom: boolean;
  supplier?: string;
  leadTime?: number;
  notes?: string;
  isActive?: boolean;
}

export interface CreateToolingCostDto extends ToolingCostInput {
  bomItemId: string;
}

export interface UpdateToolingCostDto extends Partial<ToolingCostInput> { }

export interface ToolingCostRecord {
  id: string;
  bomItemId: string;
  userId: string;
  toolingType: string;
  description: string;
  specifications?: string;
  unitCost: number;
  quantity: number;
  amortizationParts: number;
  usagePercentage: number;
  totalCost: number;
  totalToolingInvestment: number;
  isCustom: boolean;
  supplier?: string;
  leadTime?: number;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolingCostListResponse {
  records: ToolingCostRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UseToolingCostsOptions {
  bomItemId?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
  enabled?: boolean;
}

/**
 * Hook to fetch tooling costs
 */
export function useToolingCosts(options: UseToolingCostsOptions = {}) {
  const { bomItemId, isActive = true, page = 1, limit = 100, enabled = true } = options;

  return useQuery({
    queryKey: ['tooling-costs', { bomItemId, isActive, page, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (bomItemId) params.append('bomItemId', bomItemId);
      if (isActive !== undefined) params.append('isActive', String(isActive));
      params.append('page', String(page));
      params.append('limit', String(limit));

      const data = await apiClient.get<ToolingCostListResponse>(
        `/tooling-costs?${params.toString()}`
      );
      return data;
    },
    enabled: enabled && !!bomItemId,
  });
}

/**
 * Hook to fetch single tooling cost
 */
export function useToolingCost(id?: string) {
  return useQuery({
    queryKey: ['tooling-cost', id],
    queryFn: async () => {
      if (!id) throw new Error('ID is required');
      const data = await apiClient.get<ToolingCostRecord>(`/tooling-costs/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

/**
 * Hook to create tooling cost
 */
export function useCreateToolingCost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateToolingCostDto) => {
      const result = await apiClient.post<ToolingCostRecord>('/tooling-costs', data);
      return result;
    },
    onSuccess: () => {
      // Invalidate all tooling-costs queries
      queryClient.invalidateQueries({
        queryKey: ['tooling-costs'],
        exact: false,
      });
      // Invalidate BOM cost queries to trigger recalculation
      queryClient.invalidateQueries({ queryKey: ['bom-item-cost'] });
      queryClient.invalidateQueries({ queryKey: ['bom-cost-report'] });
      queryClient.invalidateQueries({ queryKey: ['bom-cost-summary'] });
      toast.success('Tooling cost added successfully');
    },
    onError: (error: any) => {
      const status = error?.status || error?.response?.status;
      if (status === 400) {
        toast.error('Please check all tooling cost details are filled out correctly.');
      } else if (status === 404) {
        toast.error('The selected BOM item no longer exists.');
      } else if (status === 409) {
        toast.error('A tooling cost record for this item already exists.');
      } else if (status === 403) {
        toast.error('You do not have permission to add tooling costs.');
      } else if (status === 422) {
        toast.error('Please ensure unit cost and quantities are valid numbers.');
      } else {
        toast.error('Unable to add tooling cost. Please try again or contact support.');
      }
    },
  });
}

/**
 * Hook to update tooling cost
 */
export function useUpdateToolingCost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateToolingCostDto }) => {
      const result = await apiClient.put<ToolingCostRecord>(`/tooling-costs/${id}`, data);
      return result;
    },
    onSuccess: (data) => {
      // Invalidate all tooling-costs queries
      queryClient.invalidateQueries({
        queryKey: ['tooling-costs'],
        exact: false,
      });
      queryClient.invalidateQueries({ queryKey: ['tooling-cost', data.id] });
      // Invalidate BOM cost queries to trigger recalculation
      queryClient.invalidateQueries({ queryKey: ['bom-item-cost'] });
      queryClient.invalidateQueries({ queryKey: ['bom-cost-report'] });
      queryClient.invalidateQueries({ queryKey: ['bom-cost-summary'] });
      toast.success('Tooling cost updated successfully');
    },
    onError: (error: any) => {
      const status = error?.status || error?.response?.status;
      if (status === 400) {
        toast.error('Please check that all tooling cost information is valid.');
      } else if (status === 404) {
        toast.error('This tooling cost record no longer exists. It may have been deleted.');
      } else if (status === 409) {
        toast.error('Another user is editing this tooling cost. Please refresh and try again.');
      } else if (status === 403) {
        toast.error('You do not have permission to edit this tooling cost.');
      } else if (status === 422) {
        toast.error('Please ensure unit cost and quantities are valid numbers.');
      } else {
        toast.error('Unable to update tooling cost. Please try again or contact support.');
      }
    },
  });
}

/**
 * Hook to delete tooling cost
 */
export function useDeleteToolingCost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, bomItemId }: { id: string; bomItemId: string }) => {
      await apiClient.delete(`/tooling-costs/${id}`);
      return { id, bomItemId };
    },
    onSuccess: () => {
      // Invalidate all tooling-costs queries
      queryClient.invalidateQueries({
        queryKey: ['tooling-costs'],
        exact: false,
      });
      // Invalidate BOM cost queries to trigger recalculation
      queryClient.invalidateQueries({ queryKey: ['bom-item-cost'] });
      queryClient.invalidateQueries({ queryKey: ['bom-cost-report'] });
      queryClient.invalidateQueries({ queryKey: ['bom-cost-summary'] });
      toast.success('Tooling cost deleted successfully');
    },
    onError: (error: any) => {
      const status = error?.status || error?.response?.status;
      if (status === 404) {
        toast.error('This tooling cost record has already been deleted.');
      } else if (status === 409) {
        toast.error('Cannot delete tooling cost because it is being used in calculations.');
      } else if (status === 403) {
        toast.error('You do not have permission to delete this tooling cost.');
      } else {
        toast.error('Unable to delete tooling cost. Please try again or contact support.');
      }
    },
  });
}