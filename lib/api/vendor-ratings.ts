import { apiClient } from './client';

// Types for the rating system
export interface VendorRating {
  id: string;
  vendorId: string;
  projectId?: string;
  userEmail: string;
  qualityRating?: number;
  deliveryRating?: number;
  costRating?: number;
  serviceRating?: number;
  communicationRating?: number;
  comments?: string;
  wouldRecommend?: boolean;
  ratingType: 'project_completion' | 'ongoing_relationship' | 'rfq_response' | 'sample_evaluation';
  createdAt: string;
  updatedAt: string;
  calculatedOverallRating?: number;
}

export interface VendorRatingAggregate {
  vendorId: string;
  vendorName: string;
  supplierCode: string;
  city: string;
  state: string;
  country: string;
  totalRatings: number;
  avgOverallRating: number;
  avgQualityRating: number;
  avgDeliveryRating: number;
  avgCostRating: number;
  avgServiceRating: number;
  avgCommunicationRating: number;
  excellentRatings: number;
  goodRatings: number;
  averageRatings: number;
  poorRatings: number;
  recommendationRate: number;
  recentAvgRating: number;
  performanceTrend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
  vendorClassification: 'preferred' | 'approved' | 'conditional' | 'restricted' | 'unrated';
  riskLevel: 'low' | 'medium' | 'high';
  lastRatedAt: string;
}

export interface CreateVendorRatingData {
  vendorId: string;
  projectId?: string;
  qualityRating?: number;
  deliveryRating?: number;
  costRating?: number;
  serviceRating?: number;
  communicationRating?: number;
  comments?: string;
  wouldRecommend?: boolean;
  contractValue?: number;
  deliveryDate?: string;
  actualDeliveryDate?: string;
  ratingType?: 'project_completion' | 'ongoing_relationship' | 'rfq_response' | 'sample_evaluation';
}

export interface VendorRatingsResponse {
  data: VendorRating[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface VendorRatingAggregatesResponse {
  data: VendorRatingAggregate[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface VendorStatsResponse {
  success: boolean;
  data: {
    totalRatings: number;
    averageRating: number;
    ratingBreakdown: {
      quality: number;
      delivery: number;
      cost: number;
      service: number;
      communication: number;
    };
    recentTrend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
  };
}

// API Functions
export const vendorRatingsApi = {
  // Create a new rating
  async createRating(data: CreateVendorRatingData): Promise<{ success: boolean; message: string; data: VendorRating }> {
    const response = await apiClient.post('/vendor-ratings', data);
    return response.data;
  },

  // Get all ratings with filtering
  async getRatings(params?: {
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
  }): Promise<VendorRatingsResponse> {
    const response = await apiClient.get('/vendor-ratings', { params });
    return response.data;
  },

  // Get aggregated rating data
  async getRatingAggregates(params?: {
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
  }): Promise<VendorRatingAggregatesResponse> {
    const response = await apiClient.get('/vendor-ratings/aggregates', { params });
    return response.data;
  },

  // Get ratings for a specific vendor
  async getVendorRatings(vendorId: string): Promise<{ success: boolean; data: VendorRating[] }> {
    const response = await apiClient.get(`/vendor-ratings/vendor/${vendorId}`);
    return response.data;
  },

  // Get aggregated stats for a specific vendor
  async getVendorAggregate(vendorId: string): Promise<{ success: boolean; data: VendorRatingAggregate | null }> {
    const response = await apiClient.get(`/vendor-ratings/vendor/${vendorId}/aggregate`);
    return response.data;
  },

  // Get comprehensive stats for a vendor
  async getVendorStats(vendorId: string): Promise<VendorStatsResponse> {
    const response = await apiClient.get(`/vendor-ratings/vendor/${vendorId}/stats`);
    return response.data;
  },

  // Get rating trends for a vendor
  async getVendorTrends(vendorId: string, months?: number): Promise<{
    success: boolean;
    data: {
      labels: string[];
      avgRatings: number[];
      ratingCounts: number[];
    };
  }> {
    type R = { success: boolean; data: { labels: string[]; avgRatings: number[]; ratingCounts: number[] } };
    const response = await apiClient.get<{ data: R }>(`/vendor-ratings/vendor/${vendorId}/trends`, { params: { months } });
    return response.data;
  },

  // Get top performing vendors
  async getTopPerformers(limit?: number): Promise<{
    success: boolean;
    data: VendorRatingAggregate[];
  }> {
    type R = { success: boolean; data: VendorRatingAggregate[] };
    const response = await apiClient.get<{ data: R }>('/vendor-ratings/top-performers', { params: { limit } });
    return response.data;
  },

  // Update a rating
  async updateRating(ratingId: string, data: Partial<CreateVendorRatingData>): Promise<{
    success: boolean;
    message: string;
    data: VendorRating;
  }> {
    type R = { success: boolean; message: string; data: VendorRating };
    const response = await apiClient.patch<{ data: R }>(`/vendor-ratings/${ratingId}`, data);
    return response.data;
  },

  // Delete a rating
  async deleteRating(ratingId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    type R = { success: boolean; message: string };
    const response = await apiClient.delete<{ data: R }>(`/vendor-ratings/${ratingId}`);
    return response.data;
  },

  // Refresh rating aggregates (admin function)
  async refreshAggregates(): Promise<{
    success: boolean;
    message: string;
  }> {
    type R = { success: boolean; message: string };
    const response = await apiClient.post<{ data: R }>('/vendor-ratings/refresh-aggregates');
    return response.data;
  }
};