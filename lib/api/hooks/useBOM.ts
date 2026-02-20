/**
 * React Query hooks for BOM API
 * Handles BOM-level operations only (not items - see useBOMItems.ts)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bomApi } from '../bom';
import type { CreateBOMData, UpdateBOMData, BOMQuery } from '../bom';
import { ApiError } from '../client';
import { toast } from 'sonner';
import { useAuthEnabled, useAuthEnabledWith } from './useAuthEnabled';

export const bomKeys = {
  all: ['bom'] as const,
  lists: () => [...bomKeys.all, 'list'] as const,
  list: (query?: BOMQuery) => [...bomKeys.lists(), query] as const,
  details: () => [...bomKeys.all, 'detail'] as const,
  detail: (id: string) => [...bomKeys.details(), id] as const,
  costBreakdown: (id: string) => [...bomKeys.detail(id), 'cost-breakdown'] as const,
};

export function useBOMs(query?: BOMQuery) {
  return useQuery({
    queryKey: bomKeys.list(query),
    queryFn: () => bomApi.getAll(query),
    staleTime: 1000 * 60 * 5,
    enabled: useAuthEnabled(),
  });
}

export function useBOM(id: string, includeItems = true) {
  return useQuery({
    queryKey: bomKeys.detail(id),
    queryFn: () => bomApi.getById(id, includeItems),
    enabled: useAuthEnabledWith(!!id),
    staleTime: 1000 * 60 * 5,
  });
}

export function useBOMCostBreakdown(bomId: string) {
  return useQuery({
    queryKey: bomKeys.costBreakdown(bomId),
    queryFn: () => bomApi.getCostBreakdown(bomId),
    enabled: useAuthEnabledWith(!!bomId),
    staleTime: 1000 * 60 * 2,
  });
}

export function useCreateBOM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateBOMData) => bomApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bomKeys.lists() });
      toast.success('BOM created successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check all required fields are filled out correctly.');
      } else if (error.status === 409) {
        toast.error('A BOM with this name already exists in the project.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to create BOMs in this project.');
      } else {
        toast.error('Unable to create BOM. Please try again or contact support.');
      }
    },
  });
}

export function useUpdateBOM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBOMData }) =>
      bomApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: bomKeys.lists() });
      queryClient.invalidateQueries({ queryKey: bomKeys.detail(variables.id) });
      toast.success('BOM updated successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check all fields have valid information.');
      } else if (error.status === 404) {
        toast.error('This BOM no longer exists. It may have been deleted.');
      } else if (error.status === 409) {
        toast.error('Another user is editing this BOM. Please refresh and try again.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to edit this BOM.');
      } else {
        toast.error('Unable to save changes. Please try again or contact support.');
      }
    },
  });
}

export function useDeleteBOM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => bomApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bomKeys.lists() });
      toast.success('BOM deleted successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 404) {
        toast.error('This BOM has already been deleted.');
      } else if (error.status === 409) {
        toast.error('Cannot delete BOM because it is being used by other components.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to delete this BOM.');
      } else {
        toast.error('Unable to delete BOM. Please try again or contact support.');
      }
    },
  });
}
