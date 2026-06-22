'use client';

import React, { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { costEngine } from '@/lib/services/cost-engine';
import type { CostCalculationResult } from '@/lib/services/cost-engine';
import { apiClient } from '@/lib/api/client';
import type { BOMItem } from '@/lib/api/hooks/useBOMItems';

interface CostDataContextType {
  bomCosts: Map<string, CostCalculationResult[]>;
  aggregatedData: any;
  isCalculating: boolean;
  calculateBomCosts: (bomId: string, itemCount?: number) => Promise<void>;
  getCostData: (bomId: string) => CostCalculationResult[] | null;
  getAggregatedData: (bomId: string) => any | null;
  clearCache: () => void;
}

const CostDataContext = createContext<CostDataContextType | undefined>(undefined);

interface CostDataProviderProps {
  children: ReactNode;
}

export const CostDataProvider: React.FC<CostDataProviderProps> = ({ children }) => {
  const [bomCosts, setBomCosts] = useState<Map<string, CostCalculationResult[]>>(new Map());
  const [aggregatedData, setAggregatedData] = useState<Map<string, any>>(new Map());
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculatingBoms, setCalculatingBoms] = useState<Set<string>>(new Set());

  /**
   * Calculate real cost data for a BOM item using backend services
   */
  const calculateRealItemCost = async (bomItem: BOMItem): Promise<CostCalculationResult> => {
    try {
      // If item has user-provided cost data, use it
      if (bomItem.unitCost && bomItem.unitCost > 0) {
        const totalCost = bomItem.unitCost * bomItem.quantity;
        const toolingCostAmount = totalCost * 0.05; // 5% tooling
        const breakdown = {
          rawMaterialCost: totalCost * 0.4, // Assume 40% raw materials
          processCost: totalCost * 0.3, // Assume 30% processing
          toolingCost: toolingCostAmount, // 5% tooling
          packagingLogisticsCost: totalCost * 0.1, // Assume 10% packaging/logistics
          procuredPartsCost: totalCost * 0.15, // Assume 15% procured parts
          overheadCost: totalCost * 0.15, // 15% overhead
          directCost: totalCost,
          sgaCost: totalCost * 0.125, // 12.5% SGA
          profitAmount: totalCost * 0.08, // 8% profit
          totalCost: totalCost,
          sellingPrice: totalCost * 1.205, // Add SGA + profit
        };

        return {
          itemId: bomItem.id,
          breakdown,
          margins: {
            grossMarginAmount: breakdown.sellingPrice - breakdown.directCost,
            grossMarginPercentage: ((breakdown.sellingPrice - breakdown.directCost) / breakdown.sellingPrice) * 100,
            netMarginAmount: breakdown.profitAmount,
            netMarginPercentage: (breakdown.profitAmount / breakdown.sellingPrice) * 100,
          },
          efficiency: {
            materialEfficiency: 85,
            processEfficiency: 80,
            overallEfficiency: 82.5,
          },
        };
      }

      // Single authoritative endpoint — replaces 5 parallel calls.
      // Computes all cost categories from source fields on the backend.
      const costAnalysis = await apiClient.get<any>(`/cost-analysis/bom-item/${bomItem.id}`).catch(() => null);

      const rawMaterials   = costAnalysis?.rawMaterialCost  || 0;
      const processTotal   = costAnalysis?.processCost       || 0;
      const toolingTotal   = costAnalysis?.toolingCost       || 0;
      const packaging      = costAnalysis?.packagingCost     || 0;
      const procuredParts  = costAnalysis?.procuredPartCost  || 0;
      const totalCost      = costAnalysis?.manufacturingCost || (rawMaterials + processTotal + toolingTotal + packaging + procuredParts);

      return {
        itemId: bomItem.id,
        breakdown: {
          rawMaterialCost:       rawMaterials,
          processCost:           processTotal,
          toolingCost:           toolingTotal,
          packagingLogisticsCost: packaging,
          procuredPartsCost:     procuredParts,
          overheadCost:          totalCost * 0.15,
          directCost:            totalCost,
          sgaCost:               costAnalysis?.sgaCost    || totalCost * 0.125,
          profitAmount:          costAnalysis?.profitCost || totalCost * 0.08,
          totalCost:             totalCost,
          sellingPrice:          costAnalysis?.sellingPrice || totalCost * 1.205,
        },
        margins: {
          grossMarginAmount:      (costAnalysis?.sellingPrice || totalCost * 1.205) - totalCost,
          grossMarginPercentage:  (((costAnalysis?.sellingPrice || totalCost * 1.205) - totalCost) / (costAnalysis?.sellingPrice || totalCost * 1.205)) * 100,
          netMarginAmount:        costAnalysis?.profitCost || totalCost * 0.08,
          netMarginPercentage:    ((costAnalysis?.profitCost || totalCost * 0.08) / (costAnalysis?.sellingPrice || totalCost * 1.205)) * 100,
        },
        efficiency: {
          materialEfficiency:  85,
          processEfficiency:   80,
          overallEfficiency:   82.5,
        },
      };
    } catch (error) {
      // Return fallback calculation using available item data
      return costEngine.generateSampleCostData(bomItem.itemType);
    }
  };

  /**
   * Fetch aggregated cost data for all BOM items in parallel via the
   * single authoritative /cost-analysis/bom-item/:id endpoint.
   */
  const fetchBulkCostData = async (bomItems: BOMItem[]) => {
    try {
      const results = await Promise.all(
        bomItems.map(item =>
          apiClient.get<any>(`/cost-analysis/bom-item/${item.id}`).catch(() => null)
        )
      );
      const map: Record<string, any> = {};
      bomItems.forEach((item, i) => { map[item.id] = results[i]; });
      return map;
    } catch {
      return null;
    }
  };

  /**
   * Calculate comprehensive cost data for a BOM (optimized)
   */
  const calculateBomCosts = async (bomId: string, _itemCount?: number): Promise<void> => {
    // Prevent multiple simultaneous calculations for the same BOM
    if (calculatingBoms.has(bomId) || isCalculating) {
      return;
    }

    setCalculatingBoms(prev => new Set(prev).add(bomId));
    setIsCalculating(true);
    
    try {
      // Fetch actual BOM items from API
      const response = await apiClient.get(`/boms/${bomId}/items`) as any;

      // Handle different response structures - the response IS the data
      const bomItems: BOMItem[] = response.items || response.data || [];
      
      if (bomItems.length === 0) {
        setBomCosts(prev => new Map(prev.set(bomId, [])));
        setAggregatedData(prev => new Map(prev.set(bomId, { totalCost: 0, totalItems: 0 })));
        return;
      }
      
      // Fetch all item cost analyses in parallel via the new aggregated endpoint
      const bulkCostData = await fetchBulkCostData(bomItems);

      const itemCostPromises = bomItems.map(async (bomItem) => {
        const analysis = bulkCostData?.[bomItem.id];
        if (analysis) {
          return await calculateItemCostWithData(bomItem, {
            rawMaterialCost:  analysis.rawMaterialCost  || 0,
            processCost:      analysis.processCost       || 0,
            toolingCost:      analysis.toolingCost       || 0,
            packagingCost:    analysis.packagingCost     || 0,
            procuredPartsCost: analysis.procuredPartCost || 0,
          });
        }
        return await calculateRealItemCost(bomItem);
      });
      
      // Wait for all parallel calculations to complete
      const itemCosts = await Promise.all(itemCostPromises);
      
      // Store individual item costs
      setBomCosts(prev => new Map(prev.set(bomId, itemCosts)));
      
      // Calculate and store aggregated data
      const aggregated = costEngine.aggregateBomCosts(itemCosts);
      setAggregatedData(prev => new Map(prev.set(bomId, aggregated)));
      
    } catch (error) {
      // Cost calculation failed
      console.error('Cost calculation failed:', error);
    } finally {
      setCalculatingBoms(prev => {
        const newSet = new Set(prev);
        newSet.delete(bomId);
        return newSet;
      });
      setIsCalculating(false);
    }
  };

  /**
   * Calculate item cost using pre-fetched bulk data
   */
  const calculateItemCostWithData = async (bomItem: BOMItem, costData: {
    rawMaterialCost: number;
    processCost: number;
    toolingCost: number;
    packagingCost: number;
    procuredPartsCost: number;
  }): Promise<CostCalculationResult> => {
    try {
      // If item has user-provided cost data, use it
      if (bomItem.unitCost && bomItem.unitCost > 0) {
        const totalCost = bomItem.unitCost * bomItem.quantity;
        const toolingCostAmount = totalCost * 0.05;
        const breakdown = {
          rawMaterialCost: totalCost * 0.4,
          processCost: totalCost * 0.3,
          toolingCost: toolingCostAmount,
          packagingLogisticsCost: totalCost * 0.1,
          procuredPartsCost: totalCost * 0.15,
          overheadCost: totalCost * 0.15,
          directCost: totalCost,
          sgaCost: totalCost * 0.125,
          profitAmount: totalCost * 0.08,
          totalCost: totalCost,
          sellingPrice: totalCost * 1.205,
        };

        return {
          itemId: bomItem.id,
          breakdown,
          margins: {
            grossMarginAmount: breakdown.sellingPrice - breakdown.directCost,
            grossMarginPercentage: ((breakdown.sellingPrice - breakdown.directCost) / breakdown.sellingPrice) * 100,
            netMarginAmount: breakdown.profitAmount,
            netMarginPercentage: (breakdown.profitAmount / breakdown.sellingPrice) * 100,
          },
          efficiency: {
            materialEfficiency: 85,
            processEfficiency: 80,
            overallEfficiency: 82.5,
          },
        };
      }

      // Use pre-fetched cost data
      const totalCost = costData.rawMaterialCost + costData.processCost + 
                       costData.toolingCost + costData.packagingCost + costData.procuredPartsCost;
      
      return {
        itemId: bomItem.id,
        breakdown: {
          rawMaterialCost: costData.rawMaterialCost,
          processCost: costData.processCost,
          toolingCost: costData.toolingCost,
          packagingLogisticsCost: costData.packagingCost,
          procuredPartsCost: costData.procuredPartsCost,
          overheadCost: totalCost * 0.15,
          directCost: totalCost,
          sgaCost: totalCost * 0.125,
          profitAmount: totalCost * 0.08,
          totalCost: totalCost,
          sellingPrice: totalCost * 1.205,
        },
        margins: {
          grossMarginAmount: totalCost * 1.205 - totalCost,
          grossMarginPercentage: ((totalCost * 1.205 - totalCost) / (totalCost * 1.205)) * 100,
          netMarginAmount: totalCost * 0.08,
          netMarginPercentage: (totalCost * 0.08 / (totalCost * 1.205)) * 100,
        },
        efficiency: {
          materialEfficiency: 85,
          processEfficiency: 80,
          overallEfficiency: 82.5,
        },
      };
    } catch (error) {
      return costEngine.generateSampleCostData(bomItem.itemType);
    }
  };

  /**
   * Get calculated cost data for a specific BOM
   */
  const getCostData = (bomId: string): CostCalculationResult[] | null => {
    return bomCosts.get(bomId) || null;
  };

  /**
   * Get aggregated cost data for a specific BOM
   */
  const getAggregatedData = (bomId: string): any | null => {
    return aggregatedData.get(bomId) || null;
  };

  /**
   * Clear all cached cost data
   */
  const clearCache = (): void => {
    setBomCosts(new Map());
    setAggregatedData(new Map());
  };

  const contextValue: CostDataContextType = {
    bomCosts,
    aggregatedData: Object.fromEntries(aggregatedData),
    isCalculating,
    calculateBomCosts,
    getCostData,
    getAggregatedData,
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