/**
 * React Query hooks for RFQ API
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rfqApi, type CreateRfqData, type RfqQuery } from '../rfq';
import { ApiError } from '../client';
import { toast } from 'sonner';
import { useAuthEnabled } from './useAuthEnabled';
import { rfqTrackingKeys } from './useRfqTracking';

const rfqKeys = {
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
    onSuccess: (_data, variables) => {
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