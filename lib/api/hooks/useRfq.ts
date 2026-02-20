/**
 * React Query hooks for RFQ API
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rfqApi, type CreateRfqData, type RfqQuery } from '../rfq';
import { ApiError } from '../client';
import { toast } from 'sonner';
import { useAuthEnabled, useAuthEnabledWith } from './useAuthEnabled';
import { rfqTrackingKeys } from './useRfqTracking';

export const rfqKeys = {
  all: ['rfq'] as const,
  lists: () => [...rfqKeys.all, 'list'] as const,
  list: (query?: RfqQuery) => [...rfqKeys.lists(), query] as const,
  details: () => [...rfqKeys.all, 'detail'] as const,
  detail: (id: string) => [...rfqKeys.details(), id] as const,
};

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Hook to fetch all RFQs with optional filtering
 */
export function useRfqs(query?: RfqQuery) {
  return useQuery({
    queryKey: rfqKeys.list(query),
    queryFn: () => rfqApi.getAll(query),
    staleTime: 1000 * 60 * 2, // Fresh for 2 minutes
    enabled: useAuthEnabled(),
  });
}

/**
 * Hook to fetch a single RFQ by ID
 */
export function useRfq(id: string) {
  return useQuery({
    queryKey: rfqKeys.detail(id),
    queryFn: () => rfqApi.getById(id),
    enabled: useAuthEnabledWith(!!id),
    staleTime: 1000 * 60 * 2,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Hook to create a new RFQ
 */
export function useCreateRfq() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRfqData) => rfqApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rfqKeys.lists() });
      toast.success('RFQ created successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check all RFQ details are filled out correctly.');
      } else if (error.status === 409) {
        toast.error('An RFQ with this reference number already exists.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to create RFQs.');
      } else if (error.status === 422) {
        toast.error('Please ensure vendor selection and item requirements are valid.');
      } else {
        toast.error('Unable to create RFQ. Please try again or contact support.');
      }
    },
  });
}

/**
 * Hook to send an RFQ to vendors
 */
export function useSendRfq() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => rfqApi.send(id),
    onSuccess: (data, variables) => {
      // Update RFQ status immediately
      queryClient.setQueryData(
        rfqKeys.detail(variables),
        (old: any) => old ? { ...old, status: 'sent', sentAt: new Date() } : old
      );
      
      // Update RFQ lists
      queryClient.invalidateQueries({ queryKey: rfqKeys.lists() });
      
      // Refresh tracking data
      queryClient.invalidateQueries({ queryKey: rfqTrackingKeys.all });
      
      toast.success('RFQ sent to vendors successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please ensure all required RFQ information is complete before sending.');
      } else if (error.status === 404) {
        toast.error('This RFQ no longer exists. It may have been deleted.');
      } else if (error.status === 409) {
        toast.error('This RFQ has already been sent to vendors.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to send this RFQ.');
      } else if (error.status === 422) {
        toast.error('No valid vendor contacts found. Please check vendor email addresses.');
      } else {
        toast.error('Unable to send RFQ. Please try again or contact support.');
      }
    },
  });
}

/**
 * Hook to close an RFQ
 */
export function useCloseRfq() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => rfqApi.close(id),
    onSuccess: (data, variables) => {
      // Update RFQ status immediately
      queryClient.setQueryData(
        rfqKeys.detail(variables),
        (old: any) => old ? { ...old, status: 'closed', closedAt: new Date() } : old
      );
      
      // Update RFQ lists
      queryClient.invalidateQueries({ queryKey: rfqKeys.lists() });
      
      // Update tracking status
      queryClient.invalidateQueries({ queryKey: rfqTrackingKeys.all });
      
      toast.success('RFQ closed successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Only sent RFQs can be closed.');
      } else if (error.status === 404) {
        toast.error('This RFQ no longer exists. It may have been deleted.');
      } else if (error.status === 409) {
        toast.error('This RFQ has already been closed.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to close this RFQ.');
      } else {
        toast.error('Unable to close RFQ. Please try again or contact support.');
      }
    },
  });
}

/**
 * Hook to cancel RFQ by deleting tracking record
 */
export function useCancelRfqTracking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (trackingId: string) => {
      return fetch(`/api/v1/rfq/tracking/${trackingId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      }).then(res => {
        if (!res.ok) throw new Error('Failed to cancel RFQ');
        return res.json();
      });
    },
    onMutate: async (trackingId) => {
      // Optimistically remove from tracking list
      await queryClient.cancelQueries({ queryKey: rfqTrackingKeys.all });
      
      const previousData = queryClient.getQueryData(rfqTrackingKeys.all);
      
      queryClient.setQueriesData(
        { queryKey: rfqTrackingKeys.lists() },
        (old: any[]) => old?.filter(record => record.id !== trackingId) || []
      );
      
      return { previousData };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rfqTrackingKeys.all });
      toast.success('RFQ cancelled successfully');
    },
    onError: (error, variables, context) => {
      // Restore previous data on error
      if (context?.previousData) {
        queryClient.setQueryData(rfqTrackingKeys.all, context.previousData);
      }
      const apiError = error as any;
      if (apiError?.status === 404) {
        toast.error('This RFQ tracking record no longer exists.');
      } else if (apiError?.status === 409) {
        toast.error('Cannot cancel RFQ because responses have already been received.');
      } else if (apiError?.status === 403) {
        toast.error('You do not have permission to cancel this RFQ.');
      } else {
        toast.error('Unable to cancel RFQ. Please try again or contact support.');
      }
    },
  });
}