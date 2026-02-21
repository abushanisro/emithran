import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

// Types for Process Planning Specifications
export interface ProcessPlanningSpec {
  id: string;
  bomItemId: string;
  projectId: string;
  toleranceGrade: string;
  surfaceFinish: string;
  heatTreatment: string;
  hardness?: string;
  manufacturingMethod?: string;
  toolingRequired?: string;
  specialInstructions?: string;
  coatingSpecification?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  // BOM item details from view
  bomItemName?: string;
  partNumber?: string;
  bomItemDescription?: string;
  itemType?: string;
  material?: string;
  materialGrade?: string;
}

export interface CreateProcessPlanningSpecDto {
  bomItemId: string;
  projectId: string;
  toleranceGrade?: string;
  surfaceFinish?: string;
  heatTreatment?: string;
  hardness?: string;
  manufacturingMethod?: string;
  toolingRequired?: string;
  specialInstructions?: string;
  coatingSpecification?: string;
}

export interface UpdateProcessPlanningSpecDto {
  toleranceGrade?: string;
  surfaceFinish?: string;
  heatTreatment?: string;
  hardness?: string;
  manufacturingMethod?: string;
  toolingRequired?: string;
  specialInstructions?: string;
  coatingSpecification?: string;
}

/**
 * Hook to get process planning specifications for a specific BOM item
 */
export function useProcessPlanningSpecsByBomItem(bomItemId?: string) {
  return useQuery({
    queryKey: ['process-planning-specs', 'bom-item', bomItemId],
    queryFn: async (): Promise<ProcessPlanningSpec | null> => {
      if (!bomItemId) return null;
      
      try {
        const response = await apiClient.get<ProcessPlanningSpec>(
          `/process-planning/bom-items/${bomItemId}/specifications`
        );
        return response;
      } catch (error: any) {
        if (error.status === 404) {
          return null; // No specifications found
        }
        throw error;
      }
    },
    enabled: !!bomItemId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook to get all process planning specifications for a project
 */
export function useProcessPlanningSpecsByProject(projectId?: string) {
  return useQuery({
    queryKey: ['process-planning-specs', 'project', projectId],
    queryFn: async (): Promise<ProcessPlanningSpec[]> => {
      if (!projectId) return [];
      
      const response = await apiClient.get<ProcessPlanningSpec[]>(
        `/process-planning/projects/${projectId}/specifications`
      );
      return response;
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook to create process planning specifications
 */
export function useCreateProcessPlanningSpecs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateProcessPlanningSpecDto): Promise<ProcessPlanningSpec> => {
      const response = await apiClient.post<ProcessPlanningSpec>(
        '/process-planning/specifications',
        data
      );
      return response;
    },
    onSuccess: (data) => {
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: ['process-planning-specs', 'bom-item', data.bomItemId]
      });
      queryClient.invalidateQueries({
        queryKey: ['process-planning-specs', 'project', data.projectId]
      });
    },
  });
}

/**
 * Hook to update process planning specifications
 */
export function useUpdateProcessPlanningSpecs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      bomItemId, 
      data 
    }: { 
      bomItemId: string; 
      data: UpdateProcessPlanningSpecDto;
    }): Promise<ProcessPlanningSpec> => {
      const response = await apiClient.put<ProcessPlanningSpec>(
        `/process-planning/bom-items/${bomItemId}/specifications`,
        data
      );
      return response;
    },
    onSuccess: (data) => {
      // Update cache with optimistic update
      queryClient.setQueryData(
        ['process-planning-specs', 'bom-item', data.bomItemId],
        data
      );
      
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: ['process-planning-specs', 'project', data.projectId]
      });
    },
  });
}

/**
 * Hook to upsert (create or update) process planning specifications
 * This is the recommended approach for the UI as it handles both create and update cases
 */
export function useUpsertProcessPlanningSpecs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateProcessPlanningSpecDto): Promise<ProcessPlanningSpec> => {
      const response = await apiClient.post<ProcessPlanningSpec>(
        '/process-planning/specifications/upsert',
        data
      );
      return response;
    },
    onSuccess: (data) => {
      // Update cache with optimistic update
      queryClient.setQueryData(
        ['process-planning-specs', 'bom-item', data.bomItemId],
        data
      );
      
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: ['process-planning-specs', 'project', data.projectId]
      });
    },
    onError: (error) => {
      console.error('Error upserting process planning specifications:', error);
    }
  });
}

/**
 * Hook to delete process planning specifications
 */
export function useDeleteProcessPlanningSpecs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (bomItemId: string): Promise<void> => {
      await apiClient.delete(`/process-planning/bom-items/${bomItemId}/specifications`);
    },
    onSuccess: (_, bomItemId) => {
      // Remove from cache
      queryClient.removeQueries({
        queryKey: ['process-planning-specs', 'bom-item', bomItemId]
      });
      
      // Invalidate project specs to refresh list
      queryClient.invalidateQueries({
        queryKey: ['process-planning-specs', 'project']
      });
    },
  });
}