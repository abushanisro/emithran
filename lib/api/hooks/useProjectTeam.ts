/**
 * React Query hooks for Project Team Members API
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectTeamApi } from '../project-team';
import type { AddTeamMemberData, UpdateTeamMemberData } from '../project-team';
import { ApiError } from '../client';
import { toast } from 'sonner';

export const projectTeamKeys = {
  all: (projectId: string) => ['projects', projectId, 'team'] as const,
};

export function useProjectTeam(projectId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: projectTeamKeys.all(projectId),
    queryFn: () => projectTeamApi.getAll(projectId),
    enabled: options?.enabled !== false && !!projectId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useAddTeamMember(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: AddTeamMemberData) => projectTeamApi.add(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectTeamKeys.all(projectId) });
      toast.success('Team member added successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 404) {
        toast.error('This person hasn\'t joined the platform yet. Ask them to sign up first, then try adding them again.');
      } else if (error.status === 400) {
        toast.error('Please double-check the email address - it appears to be incorrect.');
      } else if (error.status === 403) {
        toast.error('You don\'t have permission to add team members to this project.');
      } else if (error.status === 409) {
        toast.error('This person is already a member of your project team.');
      } else {
        toast.error('Unable to add team member. Please try again or contact support.');
      }
    },
  });
}

export function useUpdateTeamMember(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ memberId, data }: { memberId: string; data: UpdateTeamMemberData }) =>
      projectTeamApi.update(projectId, memberId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectTeamKeys.all(projectId) });
      toast.success('Team member role updated successfully');
    },
    onError: (error: ApiError) => {
      toast.error(error.message || 'Failed to update team member');
    },
  });
}

export function useRemoveTeamMember(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberId: string) => projectTeamApi.remove(projectId, memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectTeamKeys.all(projectId) });
      toast.success('Team member removed successfully');
    },
    onError: (error: ApiError) => {
      toast.error(error.message || 'Failed to remove team member');
    },
  });
}
