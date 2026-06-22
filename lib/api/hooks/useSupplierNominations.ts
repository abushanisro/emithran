/**
 * React Query hooks for Supplier Nominations API
 * Production-grade hooks with optimistic updates and error handling
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuthEnabledWith } from './useAuthEnabled';
import {
  createSupplierNomination,
  getSupplierNominationsByProject,
  getSupplierNomination,
  updateNominationCriteria,
  updateVendorEvaluation,
  updateEvaluationScores,
  addVendorsToNomination,
  completeSupplierNomination,
  deleteSupplierNomination,
  updateSupplierNomination,
  storeEvaluationData,
  getEvaluationData,
  saveEvaluationData,
  type SupplierNomination,
  type SupplierNominationSummary,
  type CreateSupplierNominationData,
  type CreateCriteriaData,
  type UpdateVendorEvaluationData,
  type CreateEvaluationScoreData,
} from '../supplier-nominations';

// ============================================================================
// QUERY KEYS
// ============================================================================

export const supplierNominationKeys = {
  all: ['supplier-nominations'] as const,
  lists: () => [...supplierNominationKeys.all, 'list'] as const,
  list: (projectId?: string) => [...supplierNominationKeys.lists(), projectId] as const,
  details: () => [...supplierNominationKeys.all, 'detail'] as const,
  detail: (id: string) => [...supplierNominationKeys.details(), id] as const,
  evaluationData: (evaluationId: string, section: string = '') => ['evaluation-data', evaluationId, section] as const,
};

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Get all nominations for a project
 */
export function useSupplierNominations(projectId: string) {
  return useQuery({
    queryKey: supplierNominationKeys.list(projectId),
    queryFn: () => getSupplierNominationsByProject(projectId),
    enabled: useAuthEnabledWith(!!projectId),
    staleTime: 1 * 60 * 1000, // 1 minute stale time
    gcTime: 5 * 60 * 1000, // 5 minutes cache time
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });
}

/**
 * Get supplier nomination by ID
 */
export function useSupplierNomination(nominationId: string) {
  return useQuery({
    queryKey: supplierNominationKeys.detail(nominationId),
    queryFn: () => getSupplierNomination(nominationId),
    enabled: useAuthEnabledWith(!!nominationId && nominationId !== ''),
    staleTime: 0, // Always fetch fresh data
    retry: 1, // Only retry once if it fails
  });
}

/**
 * Get evaluation data for a vendor evaluation
 */
export function useEvaluationData(evaluationId: string | undefined, section: string) {
  return useQuery({
    queryKey: supplierNominationKeys.evaluationData(evaluationId || '', section),
    queryFn: () => evaluationId ? getEvaluationData(evaluationId, section) : Promise.resolve(null),
    enabled: useAuthEnabledWith(!!evaluationId && evaluationId !== ''),
    staleTime: 30 * 1000, // 30 seconds - frequently updated data
    retry: (failureCount, error) => {
      // Don't retry on circuit breaker errors
      if (error?.message?.includes('Circuit breaker is OPEN')) {
        
        return false;
      }
      // Retry up to 2 times for other errors
      return failureCount < 2;
    },
    retryDelay: 2000,
    refetchOnWindowFocus: false,
    // Return empty data instead of erroring on circuit breaker
    meta: {
      errorHandler: (error: any) => {
        if (error?.message?.includes('Circuit breaker is OPEN')) {
          
          return null; // Return null instead of throwing
        }
        throw error;
      }
    }
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Create a new supplier nomination
 */
export function useCreateSupplierNomination() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSupplierNominationData) => createSupplierNomination(data),
    onSuccess: (_newNomination, variables) => {
      const projectId = variables.projectId;
      
      // Simple approach: just invalidate to force fresh fetch
      queryClient.invalidateQueries({ 
        queryKey: supplierNominationKeys.list(projectId) 
      });

      toast.success('Supplier nomination created successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create supplier nomination');
    },
  });
}

/**
 * Update nomination criteria
 */
export function useUpdateNominationCriteria(nominationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (criteria: CreateCriteriaData[]) => 
      updateNominationCriteria(nominationId, criteria),
    onSuccess: (updatedCriteria) => {
      // Update nomination details
      queryClient.setQueryData(
        supplierNominationKeys.detail(nominationId),
        (old: SupplierNomination | undefined) => {
          if (!old) return old;
          return {
            ...old,
            criteria: updatedCriteria,
            updatedAt: new Date()
          };
        }
      );

      toast.success('Evaluation criteria updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update criteria');
    },
  });
}

/**
 * Update vendor evaluation
 */
export function useUpdateVendorEvaluation(nominationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ evaluationId, data }: { 
      evaluationId: string; 
      data: UpdateVendorEvaluationData 
    }) => updateVendorEvaluation(evaluationId, data),
    onSuccess: (updatedEvaluation, variables) => {
      // Update nomination details
      queryClient.setQueryData(
        supplierNominationKeys.detail(nominationId),
        (old: SupplierNomination | undefined) => {
          if (!old) return old;
          
          const updatedEvaluations = old.vendorEvaluations.map(evaluation =>
            evaluation.id === variables.evaluationId ? updatedEvaluation : evaluation
          );

          return {
            ...old,
            vendorEvaluations: updatedEvaluations,
            updatedAt: new Date()
          };
        }
      );

      // CRITICAL FIX: Invalidate the nominations list cache to refresh the UI
      // This ensures that the approval status changes are reflected in the list view
      queryClient.invalidateQueries({
        queryKey: supplierNominationKeys.lists(),
      });

      // Also invalidate the specific nomination detail to ensure consistency
      queryClient.invalidateQueries({
        queryKey: supplierNominationKeys.detail(nominationId),
      });

      // Force refetch of the specific nomination to get updated summary data
      queryClient.refetchQueries({
        queryKey: supplierNominationKeys.detail(nominationId),
      });

      toast.success('Vendor evaluation updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update vendor evaluation');
    },
  });
}

/**
 * Update evaluation scores for a vendor
 */
export function useUpdateEvaluationScores(nominationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ evaluationId, scores }: { 
      evaluationId: string; 
      scores: CreateEvaluationScoreData[] 
    }) => updateEvaluationScores(evaluationId, scores),
    onSuccess: (updatedScores, variables) => {
      // Update nomination details
      queryClient.setQueryData(
        supplierNominationKeys.detail(nominationId),
        (old: SupplierNomination | undefined) => {
          if (!old) return old;
          
          const updatedEvaluations = old.vendorEvaluations.map(evaluation => {
            if (evaluation.id === variables.evaluationId) {
              return {
                ...evaluation,
                scores: updatedScores,
                updatedAt: new Date()
              };
            }
            return evaluation;
          });

          return {
            ...old,
            vendorEvaluations: updatedEvaluations,
            updatedAt: new Date()
          };
        }
      );

      toast.success('Evaluation scores updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update evaluation scores');
    },
  });
}

/**
 * Add vendors to nomination
 */
export function useAddVendorsToNomination(nominationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vendorIds: string[]) => addVendorsToNomination(nominationId, vendorIds),
    onSuccess: (newEvaluations) => {
      // Capture projectId from cache before updating
      const existingNomination = queryClient.getQueryData<SupplierNomination>(
        supplierNominationKeys.detail(nominationId)
      );
      const projectId = existingNomination?.projectId || '';

      // Update nomination details
      queryClient.setQueryData(
        supplierNominationKeys.detail(nominationId),
        (old: SupplierNomination | undefined) => {
          if (!old) return old;

          return {
            ...old,
            vendorEvaluations: [...old.vendorEvaluations, ...newEvaluations],
            updatedAt: new Date()
          };
        }
      );

      // Update project list summary
      queryClient.setQueryData(
        supplierNominationKeys.list(projectId),
        (oldList: SupplierNominationSummary[] | undefined) => {
          if (!oldList || !projectId) return oldList;

          return oldList.map(summary =>
            summary.id === nominationId
              ? { ...summary, vendorCount: summary.vendorCount + newEvaluations.length }
              : summary
          );
        }
      );

      toast.success(`${newEvaluations.length} vendor(s) added to nomination`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to add vendors to nomination');
    },
  });
}

/**
 * Complete nomination process
 */
export function useCompleteSupplierNomination() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (nominationId: string) => completeSupplierNomination(nominationId),
    onSuccess: (completedNomination) => {
      // Update nomination details
      queryClient.setQueryData(
        supplierNominationKeys.detail(completedNomination.id),
        completedNomination
      );

      // Update project list summary
      queryClient.setQueryData(
        supplierNominationKeys.list(completedNomination.projectId),
        (old: SupplierNominationSummary[] | undefined) => {
          if (!old) return old;
          
          return old.map(summary => 
            summary.id === completedNomination.id
              ? { 
                  ...summary, 
                  status: completedNomination.status,
                  completionPercentage: 100
                }
              : summary
          );
        }
      );

      toast.success('Supplier nomination completed successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to complete nomination');
    },
  });
}

/**
 * Delete supplier nomination
 */
export function useDeleteSupplierNomination() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (nominationId: string) => deleteSupplierNomination(nominationId),
    onSuccess: (_, nominationId) => {
      // Remove from all relevant caches
      queryClient.removeQueries({ queryKey: supplierNominationKeys.detail(nominationId) });
      queryClient.invalidateQueries({ queryKey: supplierNominationKeys.lists() });

      toast.success('Supplier nomination deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete nomination');
    },
  });
}

/**
 * Update supplier nomination
 */
export function useUpdateSupplierNomination() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ nominationId, data }: { 
      nominationId: string; 
      data: Partial<Pick<CreateSupplierNominationData, 'nominationName' | 'description' | 'nominationType'>>
    }) => updateSupplierNomination(nominationId, data),
    onSuccess: (updatedNomination) => {
      // Update nomination details
      queryClient.setQueryData(
        supplierNominationKeys.detail(updatedNomination.id),
        updatedNomination
      );

      // Update project list summary
      queryClient.setQueryData(
        supplierNominationKeys.list(updatedNomination.projectId),
        (old: SupplierNominationSummary[] | undefined) => {
          if (!old) return old;
          
          return old.map(summary => 
            summary.id === updatedNomination.id
              ? { 
                  ...summary, 
                  nominationName: updatedNomination.nominationName,
                  nominationType: updatedNomination.nominationType
                }
              : summary
          );
        }
      );

      toast.success('Supplier nomination updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update nomination');
    },
  });
}

// ============================================================================
// UTILITY HOOKS
// ============================================================================

/**
 * Prefetch supplier nomination
 */
export function usePrefetchSupplierNomination() {
  const queryClient = useQueryClient();

  return (nominationId: string) => {
    queryClient.prefetchQuery({
      queryKey: supplierNominationKeys.detail(nominationId),
      queryFn: () => getSupplierNomination(nominationId),
      staleTime: 2 * 60 * 1000,
    });
  };
}

/**
 * Store complete evaluation data (Overview, Cost Analysis, Rating Engine, Capability, Technical)
 */
export function useStoreEvaluationData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ 
      evaluationId, 
      evaluationData 
    }: { 
      evaluationId: string; 
      evaluationData: {
        overview?: any;
        costAnalysis?: any;
        ratingEngine?: any;
        capability?: any;
        technical?: any;
      }
    }) => storeEvaluationData(evaluationId, evaluationData),
    onMutate: async ({ evaluationId, evaluationData }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: supplierNominationKeys.evaluationData(evaluationId) });

      // Snapshot previous value
      const previousData = queryClient.getQueryData(supplierNominationKeys.evaluationData(evaluationId));

      // Optimistically update cache with new data
      if (previousData) {
        queryClient.setQueryData(supplierNominationKeys.evaluationData(evaluationId), {
          ...previousData,
          ...evaluationData,
        });
      }

      return { previousData };
    },
    onError: (_err, { evaluationId }, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(supplierNominationKeys.evaluationData(evaluationId), context.previousData);
      }
      toast.error('Failed to store evaluation data');
    },
    onSuccess: (result, { evaluationId }) => {
      // Update cache with server response
      queryClient.setQueryData(supplierNominationKeys.evaluationData(evaluationId), result);

      // Invalidate related nomination queries to refresh scores
      queryClient.invalidateQueries({
        queryKey: supplierNominationKeys.all,
        refetchType: 'active',
      });

      toast.success('Evaluation data saved successfully');
    },
  });
}

/**
 * Update specific evaluation section
 */
export function useUpdateEvaluationSection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ 
      evaluationId, 
      section, 
      sectionData 
    }: { 
      evaluationId: string; 
      section: string; 
      sectionData: any;
    }) => saveEvaluationData(evaluationId, section, sectionData),
    onMutate: async ({ evaluationId, section, sectionData }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: supplierNominationKeys.evaluationData(evaluationId, section) });

      // Snapshot previous value
      const previousData = queryClient.getQueryData(supplierNominationKeys.evaluationData(evaluationId, section));

      // Optimistically update the specific section
      if (previousData) {
        const updatedData = {
          ...previousData,
          [section]: {
            ...(previousData as any)[section],
            ...sectionData,
          },
        };
        queryClient.setQueryData(supplierNominationKeys.evaluationData(evaluationId), updatedData);
      }

      return { previousData };
    },
    onError: (_err, { evaluationId, section }, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(supplierNominationKeys.evaluationData(evaluationId, section), context.previousData);
      }
      toast.error('Failed to save evaluation section');
    },
    onSuccess: (result, { evaluationId, section }) => {
      // Update cache with server response
      queryClient.setQueryData(supplierNominationKeys.evaluationData(evaluationId, section), result);
      
      const sectionNames: Record<string, string> = {
        overview: 'Overview',
        cost_analysis: 'Cost Analysis',
        rating_engine: 'Rating Engine',
        capability: 'Capability',
        technical: 'Technical'
      };
      
      toast.success(`${sectionNames[section] || section} updated successfully`);
    },
  });
}

/**
 * Invalidate all supplier nomination queries
 */
export function useInvalidateSupplierNominations() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: supplierNominationKeys.all });
  };
}

// ============================================================================
// EVALUATION DATA UTILITY HOOKS
// ============================================================================

/**
 * Check evaluation data status and completion
 */
export function useEvaluationDataStatus(evaluationId: string | undefined, section: string) {
  const { data, isLoading, error } = useEvaluationData(evaluationId, section);

  const hasData = !!data && typeof data === 'object' && Object.keys(data).length > 0;
  
  const completionPercentage = hasData ? 100 : 0;

  return {
    isLoading,
    error,
    hasData,
    completionPercentage: Math.round(completionPercentage),
    overallScore: (data as any)?.overall_score || 0,
    finalRank: (data as any)?.final_rank || null,
    recommendation: (data as any)?.overview?.recommendation,
    riskLevel: (data as any)?.overview?.risk_level,
  };
}

/**
 * Get supplier nomination statistics for a project
 */
export function useSupplierNominationStats(projectId: string | undefined) {
  const { data: nominations, isLoading } = useSupplierNominations(projectId || '');

  if (isLoading || !nominations || !projectId) {
    return { isLoading, stats: null };
  }

  const stats = {
    total: nominations.length,
    draft: nominations.filter(n => n.status === 'draft').length,
    inProgress: nominations.filter(n => n.status === 'in_progress').length,
    completed: nominations.filter(n => n.status === 'completed').length,
    approved: nominations.filter(n => n.status === 'approved').length,
    rejected: nominations.filter(n => n.status === 'rejected').length,
    totalVendors: nominations.reduce((sum, n) => sum + n.vendorCount, 0),
    avgCompletion: nominations.length > 0 
      ? Math.round(nominations.reduce((sum, n) => sum + n.completionPercentage, 0) / nominations.length)
      : 0,
  };

  return { isLoading: false, stats };
}