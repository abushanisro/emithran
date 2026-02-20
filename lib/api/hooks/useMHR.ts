/**
 * React Query hooks for MHR API
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mhrApi } from '../mhr';
import type {
  CreateMHRData,
  UpdateMHRData,
  MHRQuery,
} from '../mhr';
import { ApiError } from '../client';
import { toast } from 'sonner';

export const mhrKeys = {
  all: ['mhr'] as const,
  lists: () => [...mhrKeys.all, 'list'] as const,
  list: (query?: MHRQuery) => [...mhrKeys.lists(), query] as const,
  details: () => [...mhrKeys.all, 'detail'] as const,
  detail: (id: string) => [...mhrKeys.details(), id] as const,
};

export function useMHRRecords(query?: MHRQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: mhrKeys.list(query),
    queryFn: () => mhrApi.getAll(query),
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: options?.enabled !== false,
    retry: false, // 2026 Best Practice: Fail fast for list queries
    refetchOnWindowFocus: false,
    throwOnError: false, // Graceful error handling
  });
}

export function useMHRRecord(id: string, options?: { enabled?: boolean; retry?: boolean }) {
  return useQuery({
    queryKey: mhrKeys.detail(id),
    queryFn: () => mhrApi.getById(id),
    enabled: options?.enabled !== false && !!id,
    staleTime: 1000 * 60 * 5,
    retry: (failureCount, error) => {
      if (options?.retry === false) return false;
      const apiError = error as ApiError;
      if (apiError?.statusCode === 404 || apiError?.statusCode === 400) {
        return false;
      }
      return failureCount < 3;
    },
    refetchOnWindowFocus: (query) => {
      return query.state.status !== 'error';
    },
  });
}

export function useCreateMHR() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateMHRData) => mhrApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mhrKeys.lists() });
      toast.success('MHR record created successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check all MHR record details are filled out correctly.');
      } else if (error.status === 409) {
        toast.error('An MHR record with this identifier already exists.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to create MHR records.');
      } else if (error.status === 422) {
        toast.error('Please ensure all rates and time values are valid.');
      } else {
        toast.error('Unable to create MHR record. Please try again or contact support.');
      }
    },
  });
}

export function useUpdateMHR() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateMHRData }) =>
      mhrApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: mhrKeys.lists() });
      queryClient.invalidateQueries({ queryKey: mhrKeys.detail(variables.id) });
      toast.success('MHR record updated successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check that all MHR record information is valid.');
      } else if (error.status === 404) {
        toast.error('This MHR record no longer exists. It may have been deleted.');
      } else if (error.status === 409) {
        toast.error('Another user is editing this MHR record. Please refresh and try again.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to edit this MHR record.');
      } else if (error.status === 422) {
        toast.error('Please ensure all rates and time values are valid.');
      } else {
        toast.error('Unable to update MHR record. Please try again or contact support.');
      }
    },
  });
}

export function useDeleteMHR() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => mhrApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mhrKeys.lists() });
      toast.success('MHR record deleted successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 404) {
        toast.error('This MHR record has already been deleted.');
      } else if (error.status === 409) {
        toast.error('Cannot delete MHR record because it is being used in process calculations.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to delete this MHR record.');
      } else {
        toast.error('Unable to delete MHR record. Please try again or contact support.');
      }
    },
  });
}
