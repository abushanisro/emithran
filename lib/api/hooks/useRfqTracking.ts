/**
 * React Query hooks for RFQ tracking
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRfqTrackingRecords,
  getRfqTrackingById,
  getRfqTrackingStats,
  createRfqTracking,
  updateRfqTrackingStatus,
  updateVendorResponse,
  deleteRfqTracking,
} from '../rfq-tracking';
import type {
  CreateRfqTrackingData,
  UpdateTrackingStatusData,
  UpdateVendorResponseData,
  RfqTrackingRecord,
} from '../rfq-tracking';

// ============================================================================
// QUERY KEYS
// ============================================================================

export const rfqTrackingKeys = {
  all: ['rfqTracking'] as const,
  lists: () => [...rfqTrackingKeys.all, 'list'] as const,
  list: (projectId?: string) => [...rfqTrackingKeys.lists(), projectId] as const,
  details: () => [...rfqTrackingKeys.all, 'detail'] as const,
  detail: (id: string) => [...rfqTrackingKeys.details(), id] as const,
  stats: () => [...rfqTrackingKeys.all, 'stats'] as const,
  stat: (projectId?: string) => [...rfqTrackingKeys.stats(), projectId] as const,
};

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Get all RFQ tracking records for the current user
 * Production-ready with graceful degradation
 */
export function useRfqTrackingRecords(projectId?: string) {
  return useQuery({
    queryKey: rfqTrackingKeys.list(projectId),
    queryFn: async () => {
      try {
        const data = await getRfqTrackingRecords(projectId);
        return data || [];
      } catch (error: any) {
        // Graceful degradation - return empty array for production
        if (error?.message?.includes('not found') || 
            error?.message?.includes('does not exist') ||
            error?.status === 404) {
          return [];
        }
        throw error;
      }
    },
    staleTime: 2 * 60 * 1000,
    retry: (failureCount, error: any) => {
      // Don't retry database schema errors
      if (error?.message?.includes('not found') || 
          error?.message?.includes('does not exist') ||
          error?.status === 404) {
        return false;
      }
      return failureCount < 2;
    },
    retryDelay: 1000,
    throwOnError: false,
  });
}

/**
 * Get RFQ tracking record by ID
 */
export function useRfqTrackingById(trackingId: string) {
  return useQuery({
    queryKey: rfqTrackingKeys.detail(trackingId),
    queryFn: () => getRfqTrackingById(trackingId),
    enabled: !!trackingId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Get RFQ tracking statistics
 * Production-ready with graceful degradation
 */
export function useRfqTrackingStats(projectId?: string) {
  return useQuery({
    queryKey: rfqTrackingKeys.stat(projectId),
    queryFn: async () => {
      try {
        return await getRfqTrackingStats(projectId);
      } catch (error: any) {
        // Graceful degradation - return default stats for production
        if (error?.message?.includes('not found') || 
            error?.message?.includes('does not exist') ||
            error?.status === 404) {
          return {
            totalSent: 0,
            totalResponded: 0,
            totalCompleted: 0,
            avgResponseTime: 0,
            recentActivity: 0
          };
        }
        throw error;
      }
    },
    staleTime: 10 * 60 * 1000, // 10 minutes cache for stats
    retry: (failureCount, error: any) => {
      // Don't retry database schema errors
      if (error?.message?.includes('not found') || 
          error?.message?.includes('does not exist') ||
          error?.status === 404) {
        return false;
      }
      return failureCount < 2;
    },
    retryDelay: 1000,
    throwOnError: false,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Create new RFQ tracking record
 */
export function useCreateRfqTracking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRfqTrackingData) => createRfqTracking(data),
    onSuccess: (newRecord: RfqTrackingRecord) => {
      // Update all tracking lists that might include this record
      queryClient.invalidateQueries({ queryKey: rfqTrackingKeys.lists() });
      queryClient.invalidateQueries({ queryKey: rfqTrackingKeys.stats() });
      
      // Set the new record in cache
      queryClient.setQueryData(
        rfqTrackingKeys.detail(newRecord.id),
        newRecord
      );
    },
  });
}

/**
 * Update RFQ tracking status
 */
export function useUpdateRfqTrackingStatus(projectId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ trackingId, data }: { trackingId: string; data: UpdateTrackingStatusData }) =>
      updateRfqTrackingStatus(trackingId, data),
    onSuccess: (_, { trackingId, data }) => {
      // Update specific tracking record cache
      queryClient.setQueryData(
        rfqTrackingKeys.detail(trackingId),
        (old: RfqTrackingRecord | undefined) => {
          if (!old) return old;
          return {
            ...old,
            status: data.status,
            ...(data.status === 'completed' && { completedAt: new Date() })
          };
        }
      );

      // Update the list cache with the new status
      queryClient.setQueryData(
        rfqTrackingKeys.list(projectId),
        (old: RfqTrackingRecord[] | undefined) => {
          if (!old || !Array.isArray(old)) return old;
          return old.map(record => 
            record.id === trackingId 
              ? { 
                  ...record, 
                  status: data.status,
                  ...(data.status === 'completed' && { completedAt: new Date() })
                }
              : record
          );
        }
      );

      // Update stats if status changed to completed
      if (data.status === 'completed') {
        queryClient.setQueryData(
          rfqTrackingKeys.stat(projectId),
          (old: any) => {
            if (!old) return old;
            return {
              ...old,
              totalCompleted: (old.totalCompleted || 0) + 1,
            };
          }
        );
      }
    },
  });
}

/**
 * Update vendor response
 */
export function useUpdateVendorResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ 
      trackingId, 
      vendorId, 
      data 
    }: { 
      trackingId: string; 
      vendorId: string; 
      data: UpdateVendorResponseData 
    }) => updateVendorResponse(trackingId, vendorId, data),
    onSuccess: (_, { trackingId, vendorId, data }) => {
      // Invalidate and refetch the specific tracking record
      queryClient.invalidateQueries({ queryKey: rfqTrackingKeys.detail(trackingId) });
      queryClient.invalidateQueries({ queryKey: rfqTrackingKeys.lists() });
      queryClient.invalidateQueries({ queryKey: rfqTrackingKeys.stats() });

      // Optimistically update the vendor response in cache
      queryClient.setQueryData(
        rfqTrackingKeys.detail(trackingId),
        (old: RfqTrackingRecord | undefined) => {
          if (!old) return old;
          
          const updatedVendors = old.vendors.map(vendor => {
            if (vendor.id === vendorId) {
              return {
                ...vendor,
                responded: data.responded,
                ...(data.responded && {
                  responseReceivedAt: new Date(),
                  quoteAmount: data.quoteAmount,
                  leadTimeDays: data.leadTimeDays,
                })
              };
            }
            return vendor;
          });

          const responseCount = updatedVendors.filter(v => v.responded).length;

          return {
            ...old,
            vendors: updatedVendors,
            responseCount,
            ...(responseCount > 0 && !old.firstResponseAt && { firstResponseAt: new Date() }),
            lastResponseAt: new Date(),
          };
        }
      );
    },
  });
}

/**
 * Delete RFQ tracking record - Production-grade with targeted cache updates
 */
export function useDeleteRfqTracking(projectId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (trackingId: string) => deleteRfqTracking(trackingId),
    onMutate: async (trackingId) => {
      // Cancel only relevant queries
      await queryClient.cancelQueries({ queryKey: rfqTrackingKeys.list(projectId) });
      await queryClient.cancelQueries({ queryKey: rfqTrackingKeys.stat(projectId) });
      
      // Snapshot specific queries
      const previousList = queryClient.getQueryData<RfqTrackingRecord[]>(
        rfqTrackingKeys.list(projectId)
      );
      const previousStats = queryClient.getQueryData(
        rfqTrackingKeys.stat(projectId)
      );
      
      // Optimistically remove from list
      queryClient.setQueryData(
        rfqTrackingKeys.list(projectId),
        (old: RfqTrackingRecord[] | undefined) => {
          if (!old || !Array.isArray(old)) return old;
          return old.filter(record => record.id !== trackingId);
        }
      );
      
      // Update stats optimistically
      queryClient.setQueryData(
        rfqTrackingKeys.stat(projectId),
        (old: any) => {
          if (!old) return old;
          return {
            ...old,
            totalSent: Math.max(0, (old.totalSent || 0) - 1),
            recentActivity: Math.max(0, (old.recentActivity || 0) - 1)
          };
        }
      );
      
      return { previousList, previousStats };
    },
    onError: (_err, _trackingId, context) => {
      // Rollback specific queries on error
      if (context?.previousList) {
        queryClient.setQueryData(rfqTrackingKeys.list(projectId), context.previousList);
      }
      if (context?.previousStats) {
        queryClient.setQueryData(rfqTrackingKeys.stat(projectId), context.previousStats);
      }
    },
    onSuccess: (_, trackingId) => {
      // Remove specific tracking record from cache
      queryClient.removeQueries({ queryKey: rfqTrackingKeys.detail(trackingId) });
      
      // Invalidate queries to fetch fresh server state
      queryClient.invalidateQueries({ queryKey: rfqTrackingKeys.lists() });
      queryClient.invalidateQueries({ queryKey: rfqTrackingKeys.stats() });
    },
  });
}

// ============================================================================
// UTILITY HOOKS
// ============================================================================

/**
 * Prefetch RFQ tracking record
 */
export function usePrefetchRfqTracking() {
  const queryClient = useQueryClient();

  return (trackingId: string) => {
    queryClient.prefetchQuery({
      queryKey: rfqTrackingKeys.detail(trackingId),
      queryFn: () => getRfqTrackingById(trackingId),
      staleTime: 2 * 60 * 1000,
    });
  };
}

/**
 * Get cached RFQ tracking data without triggering a request
 */
export function useRfqTrackingCache(trackingId: string) {
  const queryClient = useQueryClient();
  
  return queryClient.getQueryData<RfqTrackingRecord>(
    rfqTrackingKeys.detail(trackingId)
  );
}

/**
 * Invalidate all RFQ tracking queries (useful after major operations)
 */
export function useInvalidateRfqTracking() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: rfqTrackingKeys.all });
  };
}