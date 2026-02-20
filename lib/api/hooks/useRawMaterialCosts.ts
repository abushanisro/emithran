/**
 * React hooks for Raw Material Cost API
 *
 * Provides hooks for managing raw material cost records linked to BOM items
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { toast } from 'sonner';

export interface RawMaterialCostInput {
  materialId?: string;
  materialName?: string;
  materialCategory?: string;
  materialType?: string;
  materialCategoryId?: string;
  materialTypeId?: string;
  materialCostId?: string;
  costName?: string;
  unitCost: number;
  reclaimRate?: number;
  uom?: string;
  grossUsage: number;
  netUsage: number;
  scrap: number;
  overhead: number;
  materialGroup?: string;
  materialGrade?: string;
  location?: string;
  quarter?: string;
  notes?: string;
  isActive?: boolean;
}

export interface CreateRawMaterialCostDto extends RawMaterialCostInput {
  bomItemId: string;
}

export interface UpdateRawMaterialCostDto extends Partial<RawMaterialCostInput> { }

export interface RawMaterialCostRecord {
  id: string;
  bomItemId?: string;
  userId: string;
  materialId?: string;
  materialName: string;
  materialCategory?: string;
  materialType?: string;
  materialCategoryId?: string;
  materialTypeId?: string;
  materialCostId?: string;
  costName?: string;
  unitCost: number;
  reclaimRate: number;
  uom: string;
  grossUsage: number;
  netUsage: number;
  scrap: number;
  overhead: number;
  totalCost: number;
  grossMaterialCost: number;
  reclaimValue: number;
  netMaterialCost: number;
  scrapAdjustment: number;
  overheadCost: number;
  totalCostPerUnit: number;
  effectiveCostPerUnit: number;
  materialUtilizationRate: number;
  scrapRate: number;
  calculationBreakdown?: any;
  materialGroup?: string;
  materialGrade?: string;
  location?: string;
  quarter?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RawMaterialCostListResponse {
  records: RawMaterialCostRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UseRawMaterialCostsOptions {
  bomItemId?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
  enabled?: boolean;
}

/**
 * Hook to fetch raw material costs
 */
export function useRawMaterialCosts(options: UseRawMaterialCostsOptions = {}) {
  const { bomItemId, isActive = true, page = 1, limit = 100, enabled = true } = options;

  return useQuery({
    queryKey: ['raw-material-costs', { bomItemId, isActive, page, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (bomItemId) params.append('bomItemId', bomItemId);
      if (isActive !== undefined) params.append('isActive', String(isActive));
      params.append('page', String(page));
      params.append('limit', String(limit));

      const data = await apiClient.get<RawMaterialCostListResponse>(
        `/raw-material-costs?${params.toString()}`
      );
      return data;
    },
    enabled: enabled && !!bomItemId,
  });
}

/**
 * Hook to fetch single raw material cost
 */
export function useRawMaterialCost(id?: string) {
  return useQuery({
    queryKey: ['raw-material-cost', id],
    queryFn: async () => {
      if (!id) throw new Error('ID is required');
      const data = await apiClient.get<RawMaterialCostRecord>(`/raw-material-costs/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

/**
 * Hook to create raw material cost
 */
export function useCreateRawMaterialCost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateRawMaterialCostDto) => {
      const result = await apiClient.post<RawMaterialCostRecord>('/raw-material-costs', data);
      return result;
    },
    onSuccess: () => {
      // Invalidate all raw-material-costs queries for this bomItemId
      queryClient.invalidateQueries({
        queryKey: ['raw-material-costs'],
        exact: false,
      });
      toast.success('Raw material cost added successfully');
    },
    onError: (error: any) => {
      const status = error?.status || error?.response?.status;
      if (status === 400) {
        toast.error('Please check all raw material cost details are filled out correctly.');
      } else if (status === 404) {
        toast.error('The selected BOM item or material no longer exists.');
      } else if (status === 409) {
        toast.error('A raw material cost record for this material already exists.');
      } else if (status === 403) {
        toast.error('You do not have permission to add raw material costs.');
      } else if (status === 422) {
        toast.error('Please ensure unit cost and usage quantities are valid numbers.');
      } else {
        toast.error('Unable to add raw material cost. Please try again or contact support.');
      }
    },
  });
}

/**
 * Hook to update raw material cost
 */
export function useUpdateRawMaterialCost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateRawMaterialCostDto }) => {
      const result = await apiClient.put<RawMaterialCostRecord>(`/raw-material-costs/${id}`, data);
      return result;
    },
    onSuccess: (data) => {
      // Invalidate all raw-material-costs queries
      queryClient.invalidateQueries({
        queryKey: ['raw-material-costs'],
        exact: false,
      });
      queryClient.invalidateQueries({ queryKey: ['raw-material-cost', data.id] });
      toast.success('Raw material cost updated successfully');
    },
    onError: (error: any) => {
      const status = error?.status || error?.response?.status;
      if (status === 400) {
        toast.error('Please check that all raw material cost information is valid.');
      } else if (status === 404) {
        toast.error('This raw material cost record no longer exists. It may have been deleted.');
      } else if (status === 409) {
        toast.error('Another user is editing this raw material cost. Please refresh and try again.');
      } else if (status === 403) {
        toast.error('You do not have permission to edit this raw material cost.');
      } else if (status === 422) {
        toast.error('Please ensure unit cost and usage quantities are valid numbers.');
      } else {
        toast.error('Unable to update raw material cost. Please try again or contact support.');
      }
    },
  });
}

/**
 * Hook to delete raw material cost
 */
export function useDeleteRawMaterialCost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, bomItemId }: { id: string; bomItemId: string }) => {
      await apiClient.delete(`/raw-material-costs/${id}`);
      return { id, bomItemId };
    },
    onSuccess: () => {
      // Invalidate all raw-material-costs queries
      queryClient.invalidateQueries({
        queryKey: ['raw-material-costs'],
        exact: false,
      });
      toast.success('Raw material cost deleted successfully');
    },
    onError: (error: any) => {
      const status = error?.status || error?.response?.status;
      if (status === 404) {
        toast.error('This raw material cost record has already been deleted.');
      } else if (status === 409) {
        toast.error('Cannot delete raw material cost because it is being used in calculations.');
      } else if (status === 403) {
        toast.error('You do not have permission to delete this raw material cost.');
      } else {
        toast.error('Unable to delete raw material cost. Please try again or contact support.');
      }
    },
  });
}
