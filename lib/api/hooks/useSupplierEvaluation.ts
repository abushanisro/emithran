/**
 * React hooks for Supplier Evaluation API
 *
 * Provides hooks for managing supplier evaluations with full CRUD operations
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/providers/auth';
import {
  createSupplierEvaluation,
  getSupplierEvaluations,
  getSupplierEvaluation,
  updateSupplierEvaluation,
  deleteSupplierEvaluation,
  completeSupplierEvaluation,
  approveSupplierEvaluation,
  type SupplierEvaluation,
  type CreateSupplierEvaluationData,
  type UpdateSupplierEvaluationData,
  type SupplierEvaluationQuery,
} from '../supplier-evaluation';

const QUERY_KEY = 'supplier-evaluations';

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Hook to fetch all supplier evaluations with optional filtering
 */
export function useSupplierEvaluations(query?: SupplierEvaluationQuery) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: [QUERY_KEY, query],
    queryFn: () => getSupplierEvaluations(query),
    enabled: !authLoading && !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch evaluations for a specific vendor
 */
export function useVendorEvaluations(vendorId: string) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: [QUERY_KEY, 'vendor', vendorId],
    queryFn: () => getSupplierEvaluations({ vendorId }),
    enabled: !authLoading && !!user && !!vendorId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch evaluations for a specific BOM item
 */
export function useBomItemEvaluations(bomItemId: string) {
  return useQuery({
    queryKey: [QUERY_KEY, 'bomItem', bomItemId],
    queryFn: () => getSupplierEvaluations({ bomItemId }),
    enabled: !!bomItemId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch a single supplier evaluation by ID
 */
export function useSupplierEvaluation(id: string) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: [QUERY_KEY, id],
    queryFn: () => getSupplierEvaluation(id),
    enabled: !authLoading && !!user && !!id,
    staleTime: 5 * 60 * 1000,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Hook to create a new supplier evaluation
 */
export function useCreateSupplierEvaluation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSupplierEvaluationData) => createSupplierEvaluation(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      if (data.vendorId) {
        queryClient.invalidateQueries({ queryKey: [QUERY_KEY, 'vendor', data.vendorId] });
      }
      if (data.bomItemId) {
        queryClient.invalidateQueries({ queryKey: [QUERY_KEY, 'bomItem', data.bomItemId] });
      }
      toast.success('Supplier evaluation created successfully');
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      if (status === 400) {
        toast.error('Please check all evaluation criteria are filled out correctly.');
      } else if (status === 409) {
        toast.error('An evaluation for this supplier and BOM item already exists.');
      } else if (status === 403) {
        toast.error('You do not have permission to create supplier evaluations.');
      } else if (status === 422) {
        toast.error('Please ensure all scoring criteria and weights are valid.');
      } else {
        toast.error('Unable to create evaluation. Please try again or contact support.');
      }
    },
  });
}

/**
 * Hook to update an existing supplier evaluation
 */
export function useUpdateSupplierEvaluation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSupplierEvaluationData }) =>
      updateSupplierEvaluation(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, variables.id] });
      if (data.vendorId) {
        queryClient.invalidateQueries({ queryKey: [QUERY_KEY, 'vendor', data.vendorId] });
      }
      if (data.bomItemId) {
        queryClient.invalidateQueries({ queryKey: [QUERY_KEY, 'bomItem', data.bomItemId] });
      }
      toast.success('Evaluation updated successfully');
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      if (status === 400) {
        toast.error('Please check that all evaluation information is valid.');
      } else if (status === 404) {
        toast.error('This evaluation no longer exists. It may have been deleted.');
      } else if (status === 409) {
        toast.error('Another user is editing this evaluation. Please refresh and try again.');
      } else if (status === 403) {
        toast.error('You do not have permission to edit this evaluation.');
      } else if (status === 422) {
        toast.error('Please ensure all scoring criteria and weights are valid.');
      } else {
        toast.error('Unable to save changes. Please try again or contact support.');
      }
    },
  });
}

/**
 * Hook to delete a supplier evaluation
 */
export function useDeleteSupplierEvaluation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteSupplierEvaluation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success('Evaluation deleted successfully');
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      if (status === 404) {
        toast.error('This evaluation has already been deleted.');
      } else if (status === 409) {
        toast.error('Cannot delete evaluation because it has been approved and frozen.');
      } else if (status === 403) {
        toast.error('You do not have permission to delete this evaluation.');
      } else {
        toast.error('Unable to delete evaluation. Please try again or contact support.');
      }
    },
  });
}

// ============================================================================
// COMMAND HOOKS (State Transitions)
// ============================================================================

/**
 * Hook to mark evaluation as completed
 */
export function useCompleteSupplierEvaluation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => completeSupplierEvaluation(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, id] });
      toast.success('Evaluation marked as completed');
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      if (status === 400) {
        toast.error('Please ensure all required evaluation criteria are completed.');
      } else if (status === 404) {
        toast.error('This evaluation no longer exists. It may have been deleted.');
      } else if (status === 409) {
        toast.error('This evaluation has already been completed or is frozen.');
      } else if (status === 403) {
        toast.error('You do not have permission to complete this evaluation.');
      } else {
        toast.error('Unable to complete evaluation. Please try again or contact support.');
      }
    },
  });
}

/**
 * Hook to approve and freeze evaluation (creates immutable snapshot)
 */
export function useApproveSupplierEvaluation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => approveSupplierEvaluation(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, id] });
      toast.success('Evaluation approved and frozen. Snapshot created.');
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      if (status === 400) {
        toast.error('Evaluation must be completed before it can be approved.');
      } else if (status === 404) {
        toast.error('This evaluation no longer exists. It may have been deleted.');
      } else if (status === 409) {
        toast.error('This evaluation has already been approved and frozen.');
      } else if (status === 403) {
        toast.error('You do not have permission to approve evaluations.');
      } else {
        toast.error('Unable to approve evaluation. Please try again or contact support.');
      }
    },
  });
}

// ============================================================================
// UTILITY HOOKS
// ============================================================================

/**
 * Hook to check if evaluation can be edited
 */
export function useCanEditEvaluation(evaluation?: SupplierEvaluation): boolean {
  if (!evaluation) return false;
  return !evaluation.isFrozen;
}

/**
 * Hook to get evaluations for comparison (multiple vendors for same part)
 */
export function useEvaluationsForComparison(bomItemId: string, vendorIds: string[]) {
  const { data: evaluations, ...rest } = useBomItemEvaluations(bomItemId);

  const filteredEvaluations = evaluations?.filter(
    (evaluation) => vendorIds.includes(evaluation.vendorId)
  );

  return {
    data: filteredEvaluations || [],
    ...rest,
  };
}
