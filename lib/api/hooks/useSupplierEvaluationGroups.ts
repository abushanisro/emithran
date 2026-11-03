import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createSupplierEvaluationGroup,
  getAllSupplierEvaluationGroups,
  getSupplierEvaluationGroupsByProject,
  getSupplierEvaluationGroup,
  updateSupplierEvaluationGroup,
  type CreateSupplierEvaluationGroupData,
  type UpdateSupplierEvaluationGroupData,
} from '../supplier-evaluation-groups';

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Get all supplier evaluation groups for current user
 */
export function useAllSupplierEvaluationGroups() {
  return useQuery({
    queryKey: ['supplier-evaluation-groups', 'all'],
    queryFn: () => getAllSupplierEvaluationGroups(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
    retryDelay: 1000,
  });
}

/**
 * Get all supplier evaluation groups for a project
 */
export function useSupplierEvaluationGroups(projectId: string | undefined) {
  return useQuery({
    queryKey: ['supplier-evaluation-groups', 'project', projectId],
    queryFn: () => projectId ? getSupplierEvaluationGroupsByProject(projectId) : Promise.resolve([]),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Get a specific supplier evaluation group by ID
 */
export function useSupplierEvaluationGroup(groupId: string | undefined) {
  return useQuery({
    queryKey: ['supplier-evaluation-groups', groupId],
    queryFn: () => groupId ? getSupplierEvaluationGroup(groupId) : Promise.resolve(null),
    enabled: !!groupId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Create a new supplier evaluation group
 */
export function useCreateSupplierEvaluationGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSupplierEvaluationGroupData) => 
      createSupplierEvaluationGroup(data),
    onSuccess: (newGroup) => {
      // Invalidate and refetch project groups
      queryClient.invalidateQueries({
        queryKey: ['supplier-evaluation-groups', 'project', newGroup.projectId],
      });

      // Set as cache for individual group query
      queryClient.setQueryData(
        ['supplier-evaluation-groups', newGroup.id],
        newGroup
      );

      // Update latest group cache
      queryClient.setQueryData(
        ['supplier-evaluation-groups', 'project', newGroup.projectId, 'latest'],
        newGroup
      );
    },
  });
}

/**
 * Update a supplier evaluation group
 */
export function useUpdateSupplierEvaluationGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ groupId, data }: { groupId: string; data: UpdateSupplierEvaluationGroupData }) =>
      updateSupplierEvaluationGroup(groupId, data),
    onSuccess: (updatedGroup) => {
      // Update the individual group cache
      queryClient.setQueryData(
        ['supplier-evaluation-groups', updatedGroup.id],
        updatedGroup
      );

      // Invalidate project groups to refresh list
      queryClient.invalidateQueries({
        queryKey: ['supplier-evaluation-groups', 'project', updatedGroup.projectId],
      });
    },
  });
}