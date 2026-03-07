import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/providers/auth';
import { apiClient } from '@/lib/api/client';

export interface BomItemCost {
  id: string;
  bomItemId: string;
  userId: string;
  rawMaterialCost: number;
  processCost: number;
  toolingCost: number;
  packagingLogisticsCost: number;
  procuredPartsCost: number;
  directChildrenCost: number;
  ownCost: number;
  totalCost: number;
  unitCost: number;
  extendedCost: number;
  sgaPercentage: number;
  profitPercentage: number;
  sellingPrice: number;
  costBreakdown?: Record<string, any>;
  isStale: boolean;
  lastCalculatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface BomItemCostSummary {
  bomItemId: string;
  name: string;
  itemType: 'assembly' | 'sub_assembly' | 'child_part' | 'bop';
  totalCost: number;
  rawMaterialCost: number;
  processCost: number;
  toolingCost: number;
  packagingLogisticsCost: number;
  procuredPartsCost: number;
  directChildrenCost: number;
  childrenCount: number;
  isStale: boolean;
  children?: BomItemCostSummary[];
}

export interface UpdateBomItemCostDto {
  rawMaterialCost?: number;
  processCost?: number;
  toolingCost?: number;
  sgaPercentage?: number;
  profitPercentage?: number;
}

export interface CostByType {
  itemType: 'assembly' | 'sub_assembly' | 'child_part' | 'bop';
  count: number;
  rawMaterialCost: number;
  processCost: number;
  toolingCost: number;
  packagingLogisticsCost: number;
  procuredPartsCost: number;
  ownCost: number;
  totalCost: number;
}

export interface CostBreakdown {
  totalRawMaterialCost: number;
  totalProcessCost: number;
  totalToolingCost: number;
  totalPackagingLogisticsCost: number;
  totalProcuredPartsCost: number;
  totalDirectChildrenCost: number;
  overallTotalCost: number;
  averageSgaPercentage: number;
  averageProfitPercentage: number;
  totalSellingPrice: number;
}

export interface BomCostReport {
  bomId: string;
  bomName: string;
  totalItems: number;
  itemsWithCosts: number;
  staleCosts: number;
  costByType: CostByType[];
  breakdown: CostBreakdown;
  topLevelAssemblies: Array<{
    id: string;
    name: string;
    itemType: string;
    totalCost: number;
    sellingPrice: number;
  }>;
  generatedAt: string;
}

/**
 * Get or create cost for a BOM item
 */
export function useBomItemCost(bomItemId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['bom-item-cost', bomItemId],
    queryFn: async (): Promise<BomItemCost> => {
      if (!bomItemId) throw new Error('BOM item ID is required');
      return apiClient.get<BomItemCost>(`/bom-items/${bomItemId}/cost`);
    },
    enabled: !!bomItemId && !!user,
    staleTime: 0, // Always fetch fresh data
    refetchOnWindowFocus: true,
  });
}

/**
 * Update cost for a BOM item
 */
export function useUpdateBomItemCost(bomItemId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateBomItemCostDto): Promise<BomItemCost> => {
      return apiClient.put<BomItemCost>(`/bom-items/${bomItemId}/cost`, data);
    },
    onSuccess: (data) => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['bom-item-cost', bomItemId] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-cost-hierarchy'] });
      queryClient.invalidateQueries({ queryKey: ['bom-cost-summary'] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-costs-children'] });
    },
  });
}

/**
 * Recalculate cost for a BOM item and all parents
 */
export function useRecalculateBomItemCost(bomItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<BomItemCost> => {
      return apiClient.post<BomItemCost>(`/bom-items/${bomItemId}/cost/recalculate`);
    },
    onSuccess: () => {
      // Invalidate all cost queries to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ['bom-item-cost'] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-cost-hierarchy'] });
      queryClient.invalidateQueries({ queryKey: ['bom-cost-summary'] });
    },
  });
}

/**
 * Get cost hierarchy for a BOM item
 */
export function useBomItemCostHierarchy(bomItemId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['bom-item-cost-hierarchy', bomItemId],
    queryFn: async (): Promise<BomItemCostSummary> => {
      if (!bomItemId) throw new Error('BOM item ID is required');
      return apiClient.get<BomItemCostSummary>(`/bom-items/${bomItemId}/cost/hierarchy`);
    },
    enabled: !!bomItemId && !!user,
    staleTime: 0,
  });
}

/**
 * Get costs for all children of a BOM item
 */
export function useBomItemChildrenCosts(bomItemId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['bom-item-costs-children', bomItemId],
    queryFn: async (): Promise<BomItemCost[]> => {
      if (!bomItemId) throw new Error('BOM item ID is required');
      return apiClient.get<BomItemCost[]>(`/bom-items/${bomItemId}/cost/children`);
    },
    enabled: !!bomItemId && !!user,
    staleTime: 0,
  });
}

/**
 * Recalculate all costs for a BOM (triggered on save)
 */
export function useRecalculateAllBomCosts(bomId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<{ message: string }> => {
      return apiClient.post<{ message: string }>(`/bom/${bomId}/recalculate-all-costs`);
    },
    onSuccess: () => {
      // Invalidate all cost-related queries
      queryClient.invalidateQueries({ queryKey: ['bom-item-cost'] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-cost-hierarchy'] });
      queryClient.invalidateQueries({ queryKey: ['bom-cost-summary'] });
      queryClient.invalidateQueries({ queryKey: ['bom-item-costs-children'] });
    },
  });
}

/**
 * Get cost summary for all top-level assemblies in a BOM
 */
export function useBomCostSummary(bomId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['bom-cost-summary', bomId],
    queryFn: async (): Promise<BomItemCostSummary[]> => {
      if (!bomId) throw new Error('BOM ID is required');
      return apiClient.get<BomItemCostSummary[]>(`/bom/${bomId}/cost-summary`);
    },
    enabled: !!bomId && !!user,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * Get all costs that need recalculation for current user
 */
export function useStaleBomCosts() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['stale-bom-costs'],
    queryFn: async (): Promise<BomItemCost[]> => {
      return apiClient.get<BomItemCost[]>('/bom/user/stale-costs');
    },
    enabled: !!user,
    refetchInterval: 30000, // Refetch every 30 seconds to check for stale costs
  });
}

/**
 * Get comprehensive cost report for a BOM
 */
export function useBomCostReport(bomId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['bom-cost-report', bomId],
    queryFn: async (): Promise<BomCostReport> => {
      if (!bomId) throw new Error('BOM ID is required');
      return apiClient.get<BomCostReport>(`/bom/${bomId}/cost-report`);
    },
    enabled: !!bomId && !!user,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
