import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { useAuthEnabledWith } from './useAuthEnabled';
import { toast } from 'sonner';

export interface BOMItem {
  id: string;
  bomId: string;
  name: string;
  partNumber?: string;
  description?: string;
  itemType: 'assembly' | 'sub_assembly' | 'child_part';
  quantity: number;
  annualVolume: number;
  unit?: string;
  material?: string;
  materialGrade?: string;
  bomLevel?: string;
  materialId?: string;
  makeBuy?: 'make' | 'buy';
  unitCost?: number;
  parentItemId?: string;
  sortOrder: number;
  file3dPath?: string;
  file2dPath?: string;
  createdAt: string;
  updatedAt: string;
  weight?: number;
  unitWeight?: number;
  maxLength?: number;
  length?: number;
  maxWidth?: number;
  width?: number;
  maxHeight?: number;
  height?: number;
  surfaceArea?: number;
  toleranceGrade?: string;
  surfaceFinish?: string;
  heatTreatment?: string;
  hardness?: string;
  leadTime?: string;
  revision?: string;
  qualityStandard?: string;
  inspectionLevel?: string;
}

export interface CreateBOMItemDto {
  bomId: string;
  name: string;
  partNumber: string;
  description?: string;
  itemType: 'assembly' | 'sub_assembly' | 'child_part';
  quantity: number;
  annualVolume: number;
  unit?: string;
  material?: string;
  materialGrade?: string;
  makeBuy?: 'make' | 'buy';
  unitCost?: number;
  parentItemId?: string;
  sortOrder?: number;
  weight?: number;
  maxLength?: number;
  maxWidth?: number;
  maxHeight?: number;
  surfaceArea?: number;
}

export interface UpdateBOMItemDto {
  name?: string;
  partNumber?: string;
  description?: string;
  itemType?: 'assembly' | 'sub_assembly' | 'child_part';
  quantity?: number;
  annualVolume?: number;
  unit?: string;
  material?: string;
  materialGrade?: string;
  bomLevel?: string;
  makeBuy?: 'make' | 'buy';
  unitCost?: number;
  parentItemId?: string;
  sortOrder?: number;
  weight?: number;
  maxLength?: number;
  maxWidth?: number;
  maxHeight?: number;
  surfaceArea?: number;
}

const bomItemKeys = {
  all: ['bom-items'] as const,
  lists: () => [...bomItemKeys.all, 'list'] as const,
  list: (bomId?: string) => [...bomItemKeys.lists(), bomId] as const,
  details: () => [...bomItemKeys.all, 'detail'] as const,
  detail: (id: string) => [...bomItemKeys.details(), id] as const,
};

/**
 * Hook to fetch BOM items for a specific BOM
 */
export function useBOMItems(bomId?: string) {
  return useQuery({
    queryKey: bomItemKeys.list(bomId),
    queryFn: async () => {
      if (!bomId) return { items: [] };
      return apiClient.get<{ items: BOMItem[] }>(`/bom-items?bomId=${bomId}`);
    },
    enabled: useAuthEnabledWith(!!bomId),
    staleTime: 2 * 60 * 1000, // Fresh for 2 minutes - medium-changing data
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

/**
 * Hook to fetch a single BOM item
 */
export function useBOMItem(itemId?: string) {
  return useQuery({
    queryKey: bomItemKeys.detail(itemId!),
    queryFn: async () => {
      return apiClient.get<BOMItem>(`/bom-items/${itemId}`);
    },
    enabled: useAuthEnabledWith(!!itemId),
    staleTime: 1000 * 60 * 2,
  });
}

/**
 * Create a new BOM item
 */
export function useCreateBOMItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateBOMItemDto) => {
      return apiClient.post<BOMItem>('/bom-items', dto);
    },
    onSuccess: async (_data, variables) => {
      // Invalidate BOM item queries
      queryClient.invalidateQueries({ queryKey: bomItemKeys.list(variables.bomId) });
      
      // Trigger automatic cost calculation for the BOM
      try {
        await apiClient.post(`/bom/${variables.bomId}/recalculate-all-costs`);
        // Invalidate cost-related queries
        queryClient.invalidateQueries({ queryKey: ['bom-item-cost'] });
        queryClient.invalidateQueries({ queryKey: ['bom-cost-summary'] });
        queryClient.invalidateQueries({ queryKey: ['bom-cost-report'] });
      } catch (error) {
        // Cost recalculation failed but item was created successfully
        console.warn('Auto cost recalculation failed for new BOM item:', error);
      }
    },
    onError: (error: any) => {
      const status = error?.status || error?.response?.status;
      if (status === 400) {
        toast.error('Please check all BOM item details are filled out correctly.');
      } else if (status === 409) {
        toast.error('A BOM item with this part number already exists in this BOM.');
      } else if (status === 403) {
        toast.error('You do not have permission to add items to this BOM.');
      } else if (status === 422) {
        toast.error('Please ensure quantity and volume are valid numbers.');
      } else {
        toast.error('Unable to create BOM item. Please try again or contact support.');
      }
    },
  });
}

/**
 * Update an existing BOM item
 */
export function useUpdateBOMItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBOMItemDto }) => {
      return apiClient.put<BOMItem>(`/bom-items/${id}`, data);
    },
    onSuccess: async (data) => {
      if (data) {
        // Invalidate BOM item queries
        queryClient.invalidateQueries({ queryKey: bomItemKeys.list(data.bomId) });
        queryClient.invalidateQueries({ queryKey: bomItemKeys.detail(data.id) });
        
        // Trigger automatic cost calculation for the BOM if cost-affecting fields were updated
        try {
          await apiClient.post(`/bom/${data.bomId}/recalculate-all-costs`);
          // Invalidate cost-related queries
          queryClient.invalidateQueries({ queryKey: ['bom-item-cost'] });
          queryClient.invalidateQueries({ queryKey: ['bom-cost-summary'] });
          queryClient.invalidateQueries({ queryKey: ['bom-cost-report'] });
        } catch (error) {
          // Cost recalculation failed but item was updated successfully
          console.warn('Auto cost recalculation failed for updated BOM item:', error);
        }
      }
    },
    onError: (error: any) => {
      const status = error?.status || error?.response?.status;
      if (status === 400) {
        toast.error('Please check that all BOM item information is valid.');
      } else if (status === 404) {
        toast.error('This BOM item no longer exists. It may have been deleted.');
      } else if (status === 409) {
        toast.error('Another user is editing this item. Please refresh and try again.');
      } else if (status === 403) {
        toast.error('You do not have permission to edit this BOM item.');
      } else if (status === 422) {
        toast.error('Please ensure quantity and volume are valid numbers.');
      } else {
        toast.error('Unable to update BOM item. Please try again or contact support.');
      }
    },
  });
}

/**
 * Delete a BOM item
 */
export function useDeleteBOMItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/bom-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bomItemKeys.lists() });
    },
    onError: (error: any) => {
      const status = error?.status || error?.response?.status;
      if (status === 404) {
        toast.error('This BOM item has already been deleted.');
      } else if (status === 409) {
        toast.error('Cannot delete BOM item because it has child components.');
      } else if (status === 403) {
        toast.error('You do not have permission to delete this BOM item.');
      } else {
        toast.error('Unable to delete BOM item. Please try again or contact support.');
      }
    },
  });
}

// Standalone functions for non-hook usage
export async function createBOMItem(dto: CreateBOMItemDto): Promise<BOMItem> {
  const data = await apiClient.post<BOMItem>('/bom-items', dto);
  if (!data) throw new Error('Failed to create BOM item');
  return data;
}

export async function updateBOMItem(id: string, dto: UpdateBOMItemDto): Promise<BOMItem> {
  const data = await apiClient.put<BOMItem>(`/bom-items/${id}`, dto);
  if (!data) throw new Error('Failed to update BOM item');
  return data;
}

export async function deleteBOMItem(id: string): Promise<void> {
  await apiClient.delete(`/bom-items/${id}`);
}

export async function updateBOMItemsSortOrder(items: Array<{ id: string; sortOrder: number }>): Promise<void> {
  await apiClient.patch('/bom-items/reorder', { items });
}
