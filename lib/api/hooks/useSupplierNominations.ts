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
  updateVendorEvaluation,
  updateEvaluationScores,
  addVendorsToNomination,
  completeSupplierNomination,
  deleteSupplierNomination,
  updateSupplierNomination,
  type SupplierNomination,
  type SupplierNominationSummary,
  type CreateSupplierNominationData,
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