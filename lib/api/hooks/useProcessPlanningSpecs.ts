import { useQuery } from '@tanstack/react-query';
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