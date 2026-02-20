/**
 * React Query hooks for Projects API
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '../projects';
import type {
  CreateProjectData,
  UpdateProjectData,
  ProjectQuery,
} from '../projects';
import { ApiError } from '../client';
import { toast } from 'sonner';

export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (query?: ProjectQuery) => [...projectKeys.lists(), query] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
  costAnalysis: (id: string) => [...projectKeys.detail(id), 'cost-analysis'] as const,
};

export function useProjects(query?: ProjectQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: projectKeys.list(query),
    queryFn: () => projectsApi.getAll(query),
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: options?.enabled,
  });
}

export function useProject(id: string, options?: { enabled?: boolean; retry?: boolean }) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => projectsApi.getById(id),
    enabled: options?.enabled !== false && !!id,
    staleTime: 1000 * 60 * 5,
    // Don't retry on 404 errors - the project genuinely doesn't exist
    retry: (failureCount, error) => {
      if (options?.retry === false) return false;
      // Don't retry on 404 (not found) or 400 (bad request)
      const apiError = error as ApiError;
      if (apiError?.statusCode === 404 || apiError?.statusCode === 400) {
        return false;
      }
      // Retry up to 3 times for other errors (network issues, 500s, etc.)
      return failureCount < 3;
    },
    // Prevent refetching on window focus for error states
    refetchOnWindowFocus: (query) => {
      return query.state.status !== 'error';
    },
  });
}

export function useProjectCostAnalysis(id: string) {
  return useQuery({
    queryKey: projectKeys.costAnalysis(id),
    queryFn: () => projectsApi.getCostAnalysis(id),
    enabled: !!id,
    staleTime: 1000 * 60 * 2,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProjectData) => projectsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      toast.success('Project created successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check that the project name and dates are valid.');
      } else if (error.status === 409) {
        toast.error('A project with this name already exists.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to create projects.');
      } else {
        toast.error('Unable to create project. Please try again or contact support.');
      }
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProjectData }) =>
      projectsApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.id) });
      toast.success('Project updated successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check that all project information is valid.');
      } else if (error.status === 404) {
        toast.error('This project no longer exists. It may have been deleted.');
      } else if (error.status === 409) {
        toast.error('Another user is editing this project. Please refresh and try again.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to edit this project.');
      } else {
        toast.error('Unable to save changes. Please try again or contact support.');
      }
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      toast.success('Project deleted successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 404) {
        toast.error('This project has already been deleted.');
      } else if (error.status === 409) {
        toast.error('Cannot delete project because it contains BOMs, team members, or other data.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to delete this project.');
      } else {
        toast.error('Unable to delete project. Please try again or contact support.');
      }
    },
  });
}
