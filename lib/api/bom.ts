/**
 * BOM (Bill of Materials) API
 */

import { apiClient } from './client';

export type BOMItem = {
  id: string;
  bomId: string;
  materialId: string;
  partNumber: string;
  description: string;
  quantity: number;
  unitOfMeasure: string;
  referenceDesignator?: string;
  notes?: string;
  level: number;
  position: number;
  unitCost?: number;
  extendedCost?: number;
};

export type BOM = {
  id: string;
  projectId: string;
  version: string;
  name: string;
  description?: string;
  status: 'draft' | 'approved' | 'released' | 'obsolete';
  totalItems: number;
  totalCost?: number;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  items?: BOMItem[];
};

export type CreateBOMData = {
  projectId: string;
  version: string;
  name: string;
  description?: string;
  status?: BOM['status'];
};

export type UpdateBOMData = Partial<Omit<CreateBOMData, 'projectId'>>;

export type CreateBOMItemData = {
  materialId: string;
  quantity: number;
  referenceDesignator?: string;
  notes?: string;
  level?: number;
  position?: number;
};

export type UpdateBOMItemData = Partial<CreateBOMItemData>;

export type BOMQuery = {
  projectId?: string;
  status?: BOM['status'];
  version?: string;
  search?: string;
  page?: number;
  limit?: number;
};

export type BOMsResponse = {
  boms: BOM[];
  total: number;
  page: number;
  limit: number;
};

export type BOMCostBreakdown = {
  bomId: string;
  totalCost: number;
  itemCount: number;
  costByCategory: Record<string, number>;
  costByLevel: Record<number, number>;
  topCostDrivers: Array<{
    materialId: string;
    partNumber: string;
    description: string;
    quantity: number;
    unitCost: number;
    extendedCost: number;
    percentageOfTotal: number;
  }>;
};

export const bomApi = {
  /**
   * Get all BOMs
   */
  getAll: async (query?: BOMQuery): Promise<BOMsResponse> => {
    const params = new URLSearchParams();
    if (query?.projectId) params.append('projectId', query.projectId);
    if (query?.status) params.append('status', query.status);
    if (query?.version) params.append('version', query.version);
    if (query?.search) params.append('search', query.search);
    if (query?.page) params.append('page', query.page.toString());
    if (query?.limit) params.append('limit', query.limit.toString());

    const queryString = params.toString();
    return apiClient.get<BOMsResponse>(
      `/boms${queryString ? `?${queryString}` : ''}`,
    );
  },

  /**
   * Get BOM by ID
   */
  getById: async (id: string, includeItems = true): Promise<BOM> => {
    return apiClient.get<BOM>(
      `/boms/${id}${includeItems ? '?includeItems=true' : ''}`,
    );
  },

  /**
   * Create new BOM
   */
  create: async (data: CreateBOMData): Promise<BOM> => {
    return apiClient.post<BOM>('/boms', data) as Promise<BOM>;
  },

  /**
   * Update BOM
   */
  update: async (id: string, data: UpdateBOMData): Promise<BOM> => {
    return apiClient.put<BOM>(`/boms/${id}`, data) as Promise<BOM>;
  },

  /**
   * Delete BOM
   */
  delete: async (id: string): Promise<void> => {
    return apiClient.delete(`/boms/${id}`) as Promise<void>;
  },

  /**
   * Get BOM cost breakdown
   */
  getCostBreakdown: async (bomId: string): Promise<BOMCostBreakdown> => {
    return apiClient.get<BOMCostBreakdown>(`/boms/${bomId}/cost-report`);
  },
};
