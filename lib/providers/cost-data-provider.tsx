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

      // Fetch cost components from backend services
      const [rawMaterialCost, processCost, toolingCost, packagingCost, procuredPartsCost] = await Promise.allSettled([
        fetchRawMaterialCost(bomItem.id),
        fetchProcessCost(bomItem.id),
        fetchToolingCost(bomItem.id),
        fetchPackagingCost(bomItem.id),
        fetchProcuredPartsCost(bomItem.id),
      ]);

      // Extract values or default to 0
      const rawMaterials = rawMaterialCost.status === 'fulfilled' ? rawMaterialCost.value : 0;
      const processTotal = processCost.status === 'fulfilled' ? processCost.value : 0;
      const toolingTotal = toolingCost.status === 'fulfilled' ? toolingCost.value : 0;
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
            toolingCost: toolingTotal, // Use actual fetched tooling cost
            totalCost: processTotal,
          }
        ],
        packagingCost: packaging * 0.5,
        logisticsCost: packaging * 0.5,
        procuredPartsCost: procuredParts,
      };

      
      try {
        const result = costEngine.calculateItemCost(costInput);
        return result;
      } catch (engineError) {
        // Return a basic cost structure with the actual values
        const totalCost = rawMaterials + processTotal + toolingTotal + packaging + procuredParts;
        return {
          itemId: bomItem.id,
          breakdown: {
            rawMaterialCost: rawMaterials,
            processCost: processTotal,
            toolingCost: toolingTotal,
            packagingLogisticsCost: packaging,
            procuredPartsCost: procuredParts,
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
      }
    } catch (error) {
      // Return fallback calculation using available item data
      return costEngine.generateSampleCostData(bomItem.itemType);
    }
  };

  /**
   * Fetch raw material cost from backend
   */
  const fetchRawMaterialCost = async (bomItemId: string): Promise<number> => {
    try {
      const response = await apiClient.get(`/raw-material-costs/bom-item/${bomItemId}/total`);
      return response.totalCost || response.data?.totalCost || 0;
    } catch (error) {
      return 0; // Default if no data available
    }
  };

  /**
   * Fetch process cost from backend
   */
  const fetchProcessCost = async (bomItemId: string): Promise<number> => {
    try {
      const response = await apiClient.get(`/process-costs/bom-item/${bomItemId}/total`);
      return response.totalCost || response.data?.totalCost || 0;
    } catch (error) {
      return 0; // Default if no data available
    }
  };

  /**
   * Fetch tooling cost from backend
   */
  const fetchToolingCost = async (bomItemId: string): Promise<number> => {
    try {
      const response = await apiClient.get(`/tooling-costs/bom-item/${bomItemId}/total`);
      console.log(`Tooling cost response for ${bomItemId}:`, response);
      const cost = response.totalCost || response.data?.totalCost || 0;
      console.log(`Extracted tooling cost for ${bomItemId}: ${cost}`);
      return cost;
    } catch (error) {
      console.error(`Error fetching tooling cost for BOM item ${bomItemId}:`, error);
      return 0; // Default if no data available
    }
  };

  /**
   * Fetch packaging & logistics cost from backend
   */
  const fetchPackagingCost = async (bomItemId: string): Promise<number> => {
    try {
      const response = await apiClient.get(`/packaging-logistics-costs/bom-item/${bomItemId}/total`);
      const cost = response.totalCost || response.data?.totalCost || 0;
      return cost;
    } catch (error) {
      return 0; // Default if no data available
    }
  };

  /**
   * Fetch procured parts cost from backend
   */
  const fetchProcuredPartsCost = async (bomItemId: string): Promise<number> => {
    try {
      const response = await apiClient.get(`/procured-parts-costs/bom-item/${bomItemId}/total`);
      const cost = response.totalCost || response.data?.totalCost || 0;
      return cost;
    } catch (error) {
      return 0; // Default if no data available
    }
  };

  /**
   * Fetch all cost data for multiple BOM items in batch (optimized)
   */
  const fetchBulkCostData = async (bomItems: BOMItem[]) => {
    const itemIds = bomItems.map(item => item.id);
    
    try {
      // Single bulk API call instead of multiple individual calls
      const [rawMaterials, processes, tooling, packaging, procuredParts] = await Promise.all([
        apiClient.post('/raw-material-costs/bulk-total', { bomItemIds: itemIds }).catch(() => ({data: {}})),
        apiClient.post('/process-costs/bulk-total', { bomItemIds: itemIds }).catch(() => ({data: {}})),
        apiClient.post('/tooling-costs/bulk-total', { bomItemIds: itemIds }).catch(() => ({data: {}})),
        apiClient.post('/packaging-logistics-costs/bulk-total', { bomItemIds: itemIds }).catch(() => ({data: {}})),
        apiClient.post('/procured-parts-costs/bulk-total', { bomItemIds: itemIds }).catch(() => ({data: {}}))
      ]);

      return {
        rawMaterials: rawMaterials.data || {},
        processes: processes.data || {},
        tooling: tooling.data || {},
        packaging: packaging.data || {},
        procuredParts: procuredParts.data || {}
      };
    } catch (error) {
      console.error('Bulk cost fetch failed, falling back to individual calls:', error);
      return null;
    }
  };

  /**
   * Calculate comprehensive cost data for a BOM (optimized)
   */
  const calculateBomCosts = async (bomId: string, itemCount?: number): Promise<void> => {
    // Prevent multiple simultaneous calculations for the same BOM
    if (calculatingBoms.has(bomId) || isCalculating) {
      return;
    }

    setCalculatingBoms(prev => new Set(prev).add(bomId));
    setIsCalculating(true);
    
    try {
      // Fetch actual BOM items from API
      const response = await apiClient.get(`/boms/${bomId}/items`);
      
      // Handle different response structures - the response IS the data
      const bomItems: BOMItem[] = response.items || response.data || [];
      
      if (bomItems.length === 0) {
        setBomCosts(prev => new Map(prev.set(bomId, [])));
        setAggregatedData(prev => new Map(prev.set(bomId, { totalCost: 0, totalItems: 0 })));
        return;
      }
      
      // Try bulk fetch first for better performance
      const bulkCostData = await fetchBulkCostData(bomItems);
      
      // Process all items in parallel instead of sequentially
      const itemCostPromises = bomItems.map(async (bomItem) => {
        if (bulkCostData) {
          // Use bulk data if available
          const rawMaterialCost = bulkCostData.rawMaterials[bomItem.id] || 0;
          const processCost = bulkCostData.processes[bomItem.id] || 0;
          const toolingCost = bulkCostData.tooling[bomItem.id] || 0;
          const packagingCost = bulkCostData.packaging[bomItem.id] || 0;
          const procuredPartsCost = bulkCostData.procuredParts[bomItem.id] || 0;
          
          return await calculateItemCostWithData(bomItem, {
            rawMaterialCost,
            processCost,
            toolingCost,
            packagingCost,
            procuredPartsCost
          });
        } else {
          // Fallback to individual calculation
          return await calculateRealItemCost(bomItem);
        }
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