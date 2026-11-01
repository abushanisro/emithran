'use client';

import React, { createContext, useContext, useState } from 'react';

import { apiClient } from '@/lib/api/client';
import type { BOMItem } from '@/lib/api/hooks/useBOMItems';
import { aggregateBomCosts, costResultFromAnalysis } from '@/lib/services/cost-engine';
import type {
  AggregatedBomCosts,
  BomItemCostAnalysis,
  CostCalculationResult,
} from '@/lib/services/cost-engine';

import type { ReactNode } from 'react';

interface CostDataContextType {
  bomCosts: Map<string, CostCalculationResult[]>;
  isCalculating: boolean;
  calculateBomCosts: (bomId: string) => Promise<void>;
  getCostData: (bomId: string) => CostCalculationResult[] | null;
  getAggregatedData: (bomId: string) => AggregatedBomCosts | null;
  /** Why the last calculation for this BOM failed, or null. */
  getError: (bomId: string) => string | null;
  clearCache: () => void;
}

const CostDataContext = createContext<CostDataContextType | undefined>(undefined);

interface CostDataProviderProps {
  children: ReactNode;
}

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error);

export const CostDataProvider: React.FC<CostDataProviderProps> = ({ children }) => {
  const [bomCosts, setBomCosts] = useState<Map<string, CostCalculationResult[]>>(new Map());
  const [aggregatedData, setAggregatedData] = useState<Map<string, AggregatedBomCosts>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculatingBoms, setCalculatingBoms] = useState<Set<string>>(new Set());

  /**
   * Load every item's cost from the authoritative /cost-analysis/bom-item/:id
   * endpoint. If any item's cost cannot be loaded the whole report is an
   * error: a BOM total with a missing item would be wrong, not partial.
   */
  const calculateBomCosts = async (bomId: string): Promise<void> => {
    if (calculatingBoms.has(bomId) || isCalculating) {
      return;
    }

    setCalculatingBoms(prev => new Set(prev).add(bomId));
    setIsCalculating(true);
    setErrors(prev => {
      const next = new Map(prev);
      next.delete(bomId);
      return next;
    });

    try {
      const response = await apiClient.get<{ items?: BOMItem[]; data?: BOMItem[] } | null>(`/boms/${bomId}/items`);
      const bomItems: BOMItem[] = response?.items ?? response?.data ?? [];

      const itemCosts = await Promise.all(
        bomItems.map(async (item) => {
          try {
            const analysis = await apiClient.get<BomItemCostAnalysis | null>(`/cost-analysis/bom-item/${item.id}`);
            return costResultFromAnalysis(item.id, analysis ?? {});
          } catch (error) {
            throw new Error(`Cost analysis for "${item.name || item.id}" failed: ${messageOf(error)}`, { cause: error });
          }
        }),
      );

      setBomCosts(prev => new Map(prev).set(bomId, itemCosts));
      setAggregatedData(prev => new Map(prev).set(bomId, aggregateBomCosts(itemCosts)));
    } catch (error) {
      console.error('Cost calculation failed:', error);
      setErrors(prev => new Map(prev).set(bomId, messageOf(error)));
    } finally {
      setCalculatingBoms(prev => {
        const newSet = new Set(prev);
        newSet.delete(bomId);
        return newSet;
      });
      setIsCalculating(false);
    }
  };

  const getCostData = (bomId: string): CostCalculationResult[] | null => bomCosts.get(bomId) ?? null;

  const getAggregatedData = (bomId: string): AggregatedBomCosts | null => aggregatedData.get(bomId) ?? null;

  const getError = (bomId: string): string | null => errors.get(bomId) ?? null;

  const clearCache = (): void => {
    setBomCosts(new Map());
    setAggregatedData(new Map());
    setErrors(new Map());
  };

  const contextValue: CostDataContextType = {
    bomCosts,
    isCalculating,
    calculateBomCosts,
    getCostData,
    getAggregatedData,
    getError,
    clearCache,
  };

  return (
    <CostDataContext.Provider value={contextValue}>
      {children}
    </CostDataContext.Provider>
  );
};

/**
 * Hook to use cost data context
 */
export const useCostData = (): CostDataContextType => {
  const context = useContext(CostDataContext);
  if (!context) {
    throw new Error('useCostData must be used within a CostDataProvider');
  }
  return context;
};
