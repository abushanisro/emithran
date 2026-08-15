import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createSupplierEvaluationGroup,
  getAllSupplierEvaluationGroups,
  getSupplierEvaluationGroupsByProject,
  getLatestSupplierEvaluationGroup,
  getSupplierEvaluationGroup,
  updateSupplierEvaluationGroup,
  deleteSupplierEvaluationGroup,
  validateSupplierEvaluationGroupDeletion,
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
 * Get the latest supplier evaluation group for a project
 */
export function useLatestSupplierEvaluationGroup(projectId: string | undefined) {
  return useQuery({
    queryKey: ['supplier-evaluation-groups', 'project', projectId, 'latest'],
    queryFn: () => projectId ? getLatestSupplierEvaluationGroup(projectId) : Promise.resolve(null),
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000, // 2 minutes
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

/**
 * Validate deletion of supplier evaluation group
 */
export function useValidateSupplierEvaluationGroupDeletion() {
  return useMutation({
    mutationFn: (groupId: string) => validateSupplierEvaluationGroupDeletion(groupId),
  });
}

/**
 * Delete a supplier evaluation group
 */
export function useDeleteSupplierEvaluationGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (groupId: string) => deleteSupplierEvaluationGroup(groupId),
    onSuccess: (_, groupId) => {
      // Remove from individual cache
      queryClient.removeQueries({
        queryKey: ['supplier-evaluation-groups', groupId],
      });

      // Invalidate all related queries
      queryClient.invalidateQueries({
        queryKey: ['supplier-evaluation-groups'],
      });
    },
  });
}

// ============================================================================
// HELPER HOOKS
// ============================================================================

/**
 * Check if there's an active evaluation group for a project
 */
export function useHasActiveEvaluationGroup(projectId: string | undefined) {
  const { data: groups, isLoading } = useSupplierEvaluationGroups(projectId);
  
  const hasActiveGroup = groups?.some(group => group.status === 'active') ?? false;
  
  return {
    hasActiveGroup,
    isLoading,
    activeGroups: groups?.filter(group => group.status === 'active') || [],
  };
}

/**
 * Get evaluation group statistics for a project
 */
export function useSupplierEvaluationGroupStats(projectId: string | undefined) {
  const { data: groups, isLoading } = useSupplierEvaluationGroups(projectId);

  if (isLoading || !groups) {
    return { isLoading, stats: null };
  }

  const stats = {
    total: groups.length,
    active: groups.filter(g => g.status === 'active').length,
    completed: groups.filter(g => g.status === 'completed').length,
    archived: groups.filter(g => g.status === 'archived').length,
    totalBomItems: groups.reduce((sum, g) => sum + g.bomItemsCount, 0),
    totalProcesses: groups.reduce((sum, g) => sum + g.processesCount, 0),
  };

  return { isLoading: false, stats };
}