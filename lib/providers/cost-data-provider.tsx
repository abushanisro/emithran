'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { costEngine, CostCalculationResult } from '@/lib/services/cost-engine';
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

  /**
   * Calculate real cost data for a BOM item using backend services
   */
  const calculateRealItemCost = async (bomItem: BOMItem): Promise<CostCalculationResult> => {
    try {
      // If item has user-provided cost data, use it
      if (bomItem.unitCost && bomItem.unitCost > 0) {
        const totalCost = bomItem.unitCost * bomItem.quantity;
        const breakdown = {
          rawMaterialCost: totalCost * 0.4, // Assume 40% raw materials
          processCost: totalCost * 0.35, // Assume 35% processing
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

      // Fetch cost components from backend services
      const [rawMaterialCost, processCost, packagingCost, procuredPartsCost] = await Promise.allSettled([
        fetchRawMaterialCost(bomItem.id),
        fetchProcessCost(bomItem.id),
        fetchPackagingCost(bomItem.id),
        fetchProcuredPartsCost(bomItem.id),
      ]);

      // Extract values or default to 0
      const rawMaterials = rawMaterialCost.status === 'fulfilled' ? rawMaterialCost.value : 0;
      const processTotal = processCost.status === 'fulfilled' ? processCost.value : 0;
      const packaging = packagingCost.status === 'fulfilled' ? packagingCost.value : 0;
      const procuredParts = procuredPartsCost.status === 'fulfilled' ? procuredPartsCost.value : 0;

      // Calculate using the cost engine with actual data
      const costInput = {
        itemId: bomItem.id,
        itemType: bomItem.itemType,
        quantity: bomItem.quantity,
        materials: [
          {
            materialType: bomItem.material || 'unknown',
            unitCost: rawMaterials / bomItem.quantity || 50, // Default unit cost
            quantity: bomItem.quantity,
            wastagePercentage: 5,
            totalCost: rawMaterials,
          }
        ],
        processes: [
          {
            stepName: 'primary_process',
            machineTime: 30, // Default values
            laborTime: 20,
            machineRate: 8.5,
            laborRate: 4.2,
            setupCost: processTotal * 0.1,
            toolingCost: processTotal * 0.1,
            totalCost: processTotal,
          }
        ],
        packagingCost: packaging * 0.5,
        logisticsCost: packaging * 0.5,
        procuredPartsCost: procuredParts,
      };

      return costEngine.calculateItemCost(costInput);
    } catch (error) {
      console.error(`Failed to calculate cost for item ${bomItem.id}:`, error);
      // Return fallback calculation using available item data
      return costEngine.generateSampleCostData(bomItem.itemType);
    }
  };

  /**
   * Fetch raw material cost from backend
   */
  const fetchRawMaterialCost = async (bomItemId: string): Promise<number> => {
    try {
      const response = await apiClient.get(`/raw-materials/cost/${bomItemId}`);
      return response.data?.totalCost || 0;
    } catch (error) {
      return 0; // Default if no data available
    }
  };

  /**
   * Fetch process cost from backend
   */
  const fetchProcessCost = async (bomItemId: string): Promise<number> => {
    try {
      const response = await apiClient.get(`/processes/cost/${bomItemId}`);
      return response.data?.totalCost || 0;
    } catch (error) {
      return 0; // Default if no data available
    }
  };

  /**
   * Fetch packaging & logistics cost from backend
   */
  const fetchPackagingCost = async (bomItemId: string): Promise<number> => {
    try {
      const response = await apiClient.get(`/packaging-logistics/cost/${bomItemId}`);
      return response.data?.totalCost || 0;
    } catch (error) {
      return 0; // Default if no data available
    }
  };

  /**
   * Fetch procured parts cost from backend
   */
  const fetchProcuredPartsCost = async (bomItemId: string): Promise<number> => {
    try {
      const response = await apiClient.get(`/procured-parts/cost/${bomItemId}`);
      return response.data?.totalCost || 0;
    } catch (error) {
      return 0; // Default if no data available
    }
  };

  /**
   * Calculate comprehensive cost data for a BOM
   */
  const calculateBomCosts = async (bomId: string, itemCount?: number): Promise<void> => {
    setIsCalculating(true);
    
    try {
      // Fetch actual BOM items from API
      const response = await apiClient.get(`/boms/${bomId}/items`);
      const bomItems: BOMItem[] = response.data?.items || [];
      
      if (bomItems.length === 0) {
        console.warn(`No items found for BOM ${bomId}`);
        setBomCosts(prev => new Map(prev.set(bomId, [])));
        setAggregatedData(prev => new Map(prev.set(bomId, { totalCost: 0, totalItems: 0 })));
        return;
      }
      
      const itemCosts: CostCalculationResult[] = [];
      
      // Calculate costs for each actual BOM item
      for (const bomItem of bomItems) {
        // Get cost data from backend services for this item
        const costData = await calculateRealItemCost(bomItem);
        itemCosts.push(costData);
      }
      
      // Store individual item costs
      setBomCosts(prev => new Map(prev.set(bomId, itemCosts)));
      
      // Calculate and store aggregated data
      const aggregated = costEngine.aggregateBomCosts(itemCosts);
      setAggregatedData(prev => new Map(prev.set(bomId, aggregated)));
      
    } catch (error) {
      console.error('Failed to calculate BOM costs:', error);
    } finally {
      setIsCalculating(false);
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