import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vendorRatingsApi } from '../vendor-ratings';
import type { CreateVendorRatingData } from '../vendor-ratings';
import { toast } from '@/components/ui/sonner';

// Query keys for caching
export const VENDOR_RATING_KEYS = {
  all: ['vendorRatings'] as const,
  lists: () => [...VENDOR_RATING_KEYS.all, 'list'] as const,
  list: (filters: string) => [...VENDOR_RATING_KEYS.lists(), filters] as const,
  details: () => [...VENDOR_RATING_KEYS.all, 'detail'] as const,
  detail: (id: string) => [...VENDOR_RATING_KEYS.details(), id] as const,
  aggregates: () => [...VENDOR_RATING_KEYS.all, 'aggregates'] as const,
  aggregate: (vendorId: string) => [...VENDOR_RATING_KEYS.aggregates(), vendorId] as const,
  stats: (vendorId: string) => [...VENDOR_RATING_KEYS.all, 'stats', vendorId] as const,
  trends: (vendorId: string, months: number) => [...VENDOR_RATING_KEYS.all, 'trends', vendorId, months] as const,
  topPerformers: (limit: number) => [...VENDOR_RATING_KEYS.all, 'topPerformers', limit] as const,
};

// Hook to get ratings with filtering
export function useVendorRatings(params?: {
  vendorId?: string;
  projectId?: string;
  userEmail?: string;
  ratingType?: string;
  fromDate?: string;
  toDate?: string;
  minRating?: number;
  maxRating?: number;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: VENDOR_RATING_KEYS.list(JSON.stringify(params || {})),
    queryFn: () => vendorRatingsApi.getRatings(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to get rating aggregates
export function useVendorRatingAggregates(params?: {
  classification?: string;
  riskLevel?: string;
  performanceTrend?: string;
  minOverallRating?: number;
  maxOverallRating?: number;
  minTotalRatings?: number;
  search?: string;
  city?: string;
  state?: string;
  country?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}) {
  return useQuery({
    queryKey: VENDOR_RATING_KEYS.list(`aggregates-${JSON.stringify(params || {})}`),
    queryFn: () => vendorRatingsApi.getRatingAggregates(params),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

// Hook to get ratings for a specific vendor
export function useVendorRatingsList(vendorId: string) {
  return useQuery({
    queryKey: VENDOR_RATING_KEYS.detail(vendorId),
    queryFn: () => vendorRatingsApi.getVendorRatings(vendorId),
    enabled: !!vendorId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to get vendor rating aggregate
export function useVendorAggregate(vendorId: string) {
  return useQuery({
    queryKey: VENDOR_RATING_KEYS.aggregate(vendorId),
    queryFn: () => vendorRatingsApi.getVendorAggregate(vendorId),
    enabled: !!vendorId,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

// Hook to get vendor stats
export function useVendorStats(vendorId: string) {
  return useQuery({
    queryKey: VENDOR_RATING_KEYS.stats(vendorId),
    queryFn: () => vendorRatingsApi.getVendorStats(vendorId),
    enabled: !!vendorId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to get vendor trends
export function useVendorTrends(vendorId: string, months: number = 12) {
  return useQuery({
    queryKey: VENDOR_RATING_KEYS.trends(vendorId, months),
    queryFn: () => vendorRatingsApi.getVendorTrends(vendorId, months),
    enabled: !!vendorId,
    staleTime: 30 * 60 * 1000, // 30 minutes
  });
}

// Hook to get top performing vendors
export function useTopPerformers(limit: number = 10) {
  return useQuery({
    queryKey: VENDOR_RATING_KEYS.topPerformers(limit),
    queryFn: () => vendorRatingsApi.getTopPerformers(limit),
    staleTime: 15 * 60 * 1000, // 15 minutes
  });
}

// Hook to create a rating
export function useCreateVendorRating() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateVendorRatingData) => vendorRatingsApi.createRating(data),
    onSuccess: (_result, variables) => {
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: VENDOR_RATING_KEYS.detail(variables.vendorId) });
      queryClient.invalidateQueries({ queryKey: VENDOR_RATING_KEYS.aggregate(variables.vendorId) });
      queryClient.invalidateQueries({ queryKey: VENDOR_RATING_KEYS.stats(variables.vendorId) });
      queryClient.invalidateQueries({ queryKey: VENDOR_RATING_KEYS.lists() });
      queryClient.invalidateQueries({ queryKey: VENDOR_RATING_KEYS.aggregates() });
      
      toast.success('Rating submitted successfully!');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to submit rating';
      toast.error(message);
    },
  });
}

// Hook to update a rating
export function useUpdateVendorRating() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ratingId, data }: { ratingId: string; data: Partial<CreateVendorRatingData> }) =>
      vendorRatingsApi.updateRating(ratingId, data),
    onSuccess: (_result, variables) => {
      // Invalidate related queries
      if (variables.data.vendorId) {
        queryClient.invalidateQueries({ queryKey: VENDOR_RATING_KEYS.detail(variables.data.vendorId) });
        queryClient.invalidateQueries({ queryKey: VENDOR_RATING_KEYS.aggregate(variables.data.vendorId) });
        queryClient.invalidateQueries({ queryKey: VENDOR_RATING_KEYS.stats(variables.data.vendorId) });
      }
      queryClient.invalidateQueries({ queryKey: VENDOR_RATING_KEYS.lists() });
      queryClient.invalidateQueries({ queryKey: VENDOR_RATING_KEYS.aggregates() });
      
      toast.success('Rating updated successfully!');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to update rating';
      toast.error(message);
    },
  });
}

// Hook to delete a rating
export function useDeleteVendorRating() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ratingId: string) => vendorRatingsApi.deleteRating(ratingId),
    onSuccess: () => {
      // Invalidate all rating-related queries
      queryClient.invalidateQueries({ queryKey: VENDOR_RATING_KEYS.all });
      toast.success('Rating deleted successfully!');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to delete rating';
      toast.error(message);
    },
  });
}

// Hook to refresh aggregates (admin function)
export function useRefreshRatingAggregates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => vendorRatingsApi.refreshAggregates(),
    onSuccess: () => {
      // Invalidate aggregates
      queryClient.invalidateQueries({ queryKey: VENDOR_RATING_KEYS.aggregates() });
      toast.success('Rating aggregates refreshed successfully!');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to refresh aggregates';
      toast.error(message);
    },
  });
}