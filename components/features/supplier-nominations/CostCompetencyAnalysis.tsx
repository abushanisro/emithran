'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  getFactorWeights,
  updateFactorWeights,
  calculateSupplierRankings,
  getPartWiseCostAnalysis,
  initializePartWiseCostAnalysis,
  bulkUpdatePartWiseCostAnalysis,
  type PartWiseCostAnalysis,
  type PartWiseCostBaseData,
  type BulkUpdatePartWiseCostAnalysisData
} from '@/lib/api/supplier-nominations';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  Award,
  Calculator,
  BarChart3,
  Edit,
  Save,
  Package
} from 'lucide-react';
import { toast } from 'sonner';

export interface CostCompetencyData {
  id: number;
  costComponent: string;
  baseValue?: number;
  supplierValues: number[]; // Dynamic array for supplier values
  isRanking?: boolean;
  unit?: string;
  paymentTerms?: string[]; // Dynamic array for payment terms
  basePaymentTerm?: string; // Base payment term for reference
}

// Helper function to calculate summary for part-wise overview
function calculatePartSummary(
  costAnalysis: PartWiseCostAnalysis[],
  vendors: Array<{ id: string; name: string }>
) {
  if (!costAnalysis || costAnalysis.length === 0) {
    return {
      topVendor: vendors.length > 0 ? vendors[0] : null,
      bestScore: 0,
      lowestCost: 0,
      vendorCount: vendors.length
    };
  }

  // Find vendor with best overall rank (lowest rank number means better)
  const bestRankedVendor = costAnalysis
    .filter(ca => ca.overallRank != null && ca.overallRank > 0)
    .sort((a, b) => (a.overallRank || Infinity) - (b.overallRank || Infinity))[0];

  const topVendor = bestRankedVendor
    ? vendors.find(v => v.id === bestRankedVendor.vendorId) || null
    : (vendors.length > 0 ? vendors[0] : null);

  // Get best total score (highest score)
  const bestScore = Math.max(...costAnalysis.map(ca => ca.totalScore || 0));

  // Get lowest net price (if available)
  const lowestCost = Math.min(
    ...costAnalysis
      .map(ca => ca.netPriceUnit || 0)
      .filter(price => price > 0)
  );

  return {
    topVendor,
    bestScore: bestScore > 0 ? bestScore : 0,
    lowestCost: lowestCost !== Infinity ? lowestCost : 0,
    vendorCount: vendors.length
  };
}

// Transformation functions for part-wise cost analysis
function transformPartWiseCostToComponentData(
  costAnalysis: PartWiseCostAnalysis[],
  baseData: PartWiseCostBaseData | null,
  vendors: Array<{ id: string; name: string }>
): CostCompetencyData[] {

  // Create vendor mapping for consistent ordering
  const vendorOrder = vendors.map(v => v.id);

  const result: CostCompetencyData[] = [
    {
      id: 1,
      costComponent: "Raw Material Cost",
      baseValue: baseData?.baseRawMaterialCost || 0,
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.rawMaterialCost || 0;
      }),
      unit: "₹"
    },
    {
      id: 2,
      costComponent: "Process Cost",
      baseValue: baseData?.baseProcessCost || 0,
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.processCost || 0;
      }),
      unit: "₹"
    },
    {
      id: 3,
      costComponent: "Overheads & Profit",
      baseValue: baseData?.baseOverheadsProfit || 0,
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.overheadsProfit || 0;
      }),
      unit: "₹"
    },
    {
      id: 4,
      costComponent: "Packing & Forwarding Cost",
      baseValue: baseData?.basePackingForwardingCost || 0,
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.packingForwardingCost || 0;
      }),
      unit: "₹"
    },
    {
      id: 5,
      costComponent: "Payment Terms",
      paymentTerms: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.paymentTerms || "";
      }),
      supplierValues: [],
      basePaymentTerm: baseData?.basePaymentTerms || ""
    },
    {
      id: 6,
      costComponent: "Net Price/unit",
      baseValue: baseData?.baseNetPriceUnit || 0,
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.netPriceUnit || 0;
      }),
      unit: "₹"
    },
    {
      id: 7,
      costComponent: "Development cost",
      baseValue: baseData?.baseDevelopmentCost || 0,
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.developmentCost || 0;
      }),
      unit: "Lakhs"
    },
    {
      id: 8,
      costComponent: "Financial Risk",
      baseValue: baseData?.baseFinancialRisk || 0,
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.financialRisk || 0;
      }),
      unit: "%"
    },
    {
      id: 9,
      costComponent: "Cost Competency Score",
      baseValue: baseData?.baseCostCompetencyScore || 0,
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.costCompetencyScore || 0;
      }),
      unit: "Score"
    },
    {
      id: 10,
      costComponent: "Lead Time Days",
      baseValue: baseData?.baseLeadTimeDays || 0,
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.leadTimeDays || 0;
      }),
      unit: "Days"
    },
    // Ranking rows
    {
      id: 11,
      costComponent: "Rank-Cost",
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.rankCost || 0;
      }),
      isRanking: true
    },
    {
      id: 12,
      costComponent: "Rank-Development cost",
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.rankDevelopmentCost || 0;
      }),
      isRanking: true
    },
    {
      id: 13,
      costComponent: "Lead Time Ranking",
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.rankLeadTime || 0;
      }),
      isRanking: true
    },
    {
      id: 14,
      costComponent: "Total Score",
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.totalScore || 0;
      }),
      unit: "Score",
      isRanking: true
    },
    {
      id: 15,
      costComponent: "Overall Rank",
      supplierValues: vendorOrder.map(vendorId => {
        const analysis = costAnalysis.find(ca => ca.vendorId === vendorId);
        return analysis?.overallRank || 0;
      }),
      isRanking: true
    }
  ];

  return result;
}

function transformComponentDataToPartWise(
  costData: CostCompetencyData[],
  vendors: Array<{ id: string; name: string }>,
  nominationId: string,
  bomItemId: string
): BulkUpdatePartWiseCostAnalysisData {
  const vendorOrder = vendors.map(v => v.id);

  // Transform base data
  const baseData: any = {
    nominationId,
    bomItemId
  };

  costData.forEach(item => {
    switch (item.costComponent) {
      case "Raw Material Cost":
        baseData.baseRawMaterialCost = item.baseValue;
        break;
      case "Process Cost":
        baseData.baseProcessCost = item.baseValue;
        break;
      case "Overheads & Profit":
        baseData.baseOverheadsProfit = item.baseValue;
        break;
      case "Packing & Forwarding Cost":
        baseData.basePackingForwardingCost = item.baseValue;
        break;
      case "Payment Terms":
        baseData.basePaymentTerms = item.basePaymentTerm;
        break;
      case "Net Price/unit":
        baseData.baseNetPriceUnit = item.baseValue;
        break;
      case "Development cost":
        baseData.baseDevelopmentCost = item.baseValue;
        break;
      case "Financial Risk":
        baseData.baseFinancialRisk = item.baseValue;
        break;
      case "Cost Competency Score":
        baseData.baseCostCompetencyScore = item.baseValue;
        break;
      case "Lead Time Days":
        baseData.baseLeadTimeDays = item.baseValue;
        break;
    }
  });

  // Transform vendor data
  const vendorCostData: any[] = vendorOrder.map((vendorId, vendorIndex) => {
    const vendorData: any = {
      nominationId,
      bomItemId,
      vendorId
    };

    costData.forEach(item => {
      if (item.isRanking) return; // Skip ranking rows

      switch (item.costComponent) {
        case "Raw Material Cost":
          vendorData.rawMaterialCost = Math.round((item.supplierValues[vendorIndex] || 0) * 100) / 100;
          break;
        case "Process Cost":
          vendorData.processCost = Math.round((item.supplierValues[vendorIndex] || 0) * 100) / 100;
          break;
        case "Overheads & Profit":
          vendorData.overheadsProfit = Math.round((item.supplierValues[vendorIndex] || 0) * 100) / 100;
          break;
        case "Packing & Forwarding Cost":
          vendorData.packingForwardingCost = Math.round((item.supplierValues[vendorIndex] || 0) * 100) / 100;
          break;
        case "Payment Terms":
          vendorData.paymentTerms = item.paymentTerms?.[vendorIndex] || '';
          break;
        case "Net Price/unit":
          vendorData.netPriceUnit = Math.round((item.supplierValues[vendorIndex] || 0) * 100) / 100;
          break;
        case "Development cost":
          vendorData.developmentCost = Math.round((item.supplierValues[vendorIndex] || 0) * 100) / 100;
          break;
        case "Financial Risk":
          vendorData.financialRisk = item.supplierValues[vendorIndex];
          break;
        case "Cost Competency Score":
          vendorData.costCompetencyScore = item.supplierValues[vendorIndex];
          break;
        case "Lead Time Days":
          vendorData.leadTimeDays = item.supplierValues[vendorIndex];
          break;
      }
    });

    return vendorData;
  });

  return {
    baseData,
    vendorCostData
  };
}

interface CostCompetencyAnalysisProps {
  nominationId: string;
  projectId?: string; // Project ID for fetching BOMs and BOM items
  onDataUpdate?: (data: CostCompetencyData[]) => void;
  vendors?: Array<{ id: string; name: string; }>;
  nominationBomParts?: Array<{
    bomItemId: string;
    bomItemName: string;
    partNumber?: string;
    material?: string;
    quantity: number;
    vendorIds: string[];
  }>; // BOM parts included in this nomination
}

export function CostCompetencyAnalysis({ nominationId, projectId, vendors = [], onDataUpdate, nominationBomParts = [] }: CostCompetencyAnalysisProps) {
  // Create empty cost data structure for real data input
  const createEmptyCostData = () => {
    const numVendors = vendors.length || 0;

    return [
      {
        id: 1,
        costComponent: "Raw Material Cost",
        baseValue: 0,
        supplierValues: new Array(numVendors).fill(0),
        unit: "₹"
      },
      {
        id: 2,
        costComponent: "Process Cost",
        baseValue: 0,
        supplierValues: new Array(numVendors).fill(0),
        unit: "₹"
      },
      {
        id: 3,
        costComponent: "Overheads & Profit",
        baseValue: 0,
        supplierValues: new Array(numVendors).fill(0),
        unit: "₹"
      },
      {
        id: 4,
        costComponent: "Packing & Forwarding Cost",
        baseValue: 0,
        supplierValues: new Array(numVendors).fill(0),
        unit: "₹"
      },
      {
        id: 5,
        costComponent: "Payment Terms",
        paymentTerms: new Array(numVendors).fill(""),
        supplierValues: [],
        basePaymentTerm: ""
      },
      {
        id: 6,
        costComponent: "Net Price/unit",
        baseValue: 0,
        supplierValues: new Array(numVendors).fill(0),
        unit: "₹"
      },
      {
        id: 7,
        costComponent: "Development cost",
        baseValue: 0,
        supplierValues: new Array(numVendors).fill(0),
        unit: "Lakhs"
      },
      {
        id: 8,
        costComponent: "Financial Risk",
        baseValue: 0,
        supplierValues: new Array(numVendors).fill(0),
        unit: "%"
      },
      {
        id: 9,
        costComponent: "Cost Competency Score",
        baseValue: 0,
        supplierValues: new Array(numVendors).fill(0),
        unit: "Score"
      },
      {
        id: 10,
        costComponent: "Lead Time Days",
        baseValue: 0,
        supplierValues: new Array(numVendors).fill(0),
        unit: "Days"
      },
      // Ranking rows
      {
        id: 11,
        costComponent: "Rank-Cost",
        supplierValues: new Array(numVendors).fill(0), // Will be calculated
        isRanking: true
      },
      {
        id: 12,
        costComponent: "Rank-Development cost",
        supplierValues: new Array(numVendors).fill(0), // Will be calculated
        isRanking: true
      },
      {
        id: 13,
        costComponent: "Lead Time Ranking",
        supplierValues: new Array(numVendors).fill(0), // Will be calculated dynamically
        isRanking: true
      },
      {
        id: 14,
        costComponent: "Total Score",
        supplierValues: new Array(numVendors).fill(0), // Will be calculated dynamically
        unit: "Score",
        isRanking: true
      },
      {
        id: 15,
        costComponent: "Overall Rank",
        supplierValues: new Array(numVendors).fill(0), // Will be calculated dynamically
        isRanking: true
      }
    ];
  };

  // BOM Part Selection State - now using nomination BOM parts
  const [selectedBomItemId, setSelectedBomItemId] = useState<string>('');

  // Use nomination BOM parts directly
  const availableBomParts = nominationBomParts || [];

  // Auto-select first BOM part when parts become available
  React.useEffect(() => {
    if (availableBomParts.length > 0 && !selectedBomItemId) {
      setSelectedBomItemId(availableBomParts[0]?.bomItemId ?? '');
    }
  }, [availableBomParts, selectedBomItemId]);

  const [costData, setCostData] = useState<CostCompetencyData[]>([]);
  const [isLoadingCostData, setIsLoadingCostData] = useState(false);
  const [isEditingCost, setIsEditingCost] = useState(false);
  const [editingCostValues, setEditingCostValues] = useState<Record<string, any>>({});
  const [isSavingCost, setIsSavingCost] = useState(false);

  // Function to clean duplicate and malformed entries
  const removeDuplicateEntries = (data: CostCompetencyData[]) => {
    const seen = new Set();
    return data.filter(item => {
      // Filter out malformed entries
      if (!item.costComponent ||
        item.costComponent.includes('Development costss') ||
        item.costComponent.includes('Vendor 1e8e') ||
        item.costComponent === '' ||
        item.costComponent.length > 100) {
        return false;
      }

      // Filter out duplicates
      if (seen.has(item.costComponent)) {
        return false;
      }

      seen.add(item.costComponent);
      return true;
    });
  };

  // Factor weights for ranking calculations
  const [factorWeights, setFactorWeights] = useState({
    cost: 33.3,
    developmentCost: 33.3,
    leadTime: 33.34
  });
  const [isLoadingWeights, setIsLoadingWeights] = useState(false);

  // Part-wise summary data for dashboard
  const [partWiseSummary, setPartWiseSummary] = useState<Record<string, any>>({});
  // const [rankings, setRankings] = useState<SupplierRanking[]>([]); // Removed unused state

  // ENTERPRISE OPTIMIZATION: Load part-wise cost analysis data with single optimized call
  React.useEffect(() => {
    const loadPartWiseCostData = async () => {
      if (!nominationId || !selectedBomItemId || vendors.length === 0) {
        // If no BOM part selected, show empty state
        if (vendors.length > 0 && !selectedBomItemId) {
          const emptyData = createEmptyCostData();
          setCostData(emptyData);
        }
        return;
      }

      // Prevent duplicate calls
      if (isLoadingCostData || isLoadingWeights) return;

      try {
        setIsLoadingCostData(true);
        setIsLoadingWeights(true);

        // BATCH LOAD: Get part-wise cost analysis and factor weights in parallel - ENTERPRISE BEST PRACTICE
        const [partWiseResult, weights] = await Promise.all([
          getPartWiseCostAnalysis(nominationId, selectedBomItemId),
          getFactorWeights(nominationId)
        ]);

        // Process part-wise cost analysis data efficiently
        if (!partWiseResult || partWiseResult.costAnalysis.length === 0) {
          // Initialize if no data exists (one-time setup)
          await initializePartWiseCostAnalysis(nominationId, selectedBomItemId);
          // Single re-fetch after initialization
          const newPartWiseResult = await getPartWiseCostAnalysis(nominationId, selectedBomItemId);
          const transformedData = transformPartWiseCostToComponentData(
            newPartWiseResult.costAnalysis,
            newPartWiseResult.baseData,
            vendors
          );
          setCostData(transformedData);

          // Update part-wise summary for overview
          setPartWiseSummary(prev => ({
            ...prev,
            [selectedBomItemId]: calculatePartSummary(newPartWiseResult.costAnalysis, vendors)
          }));
        } else {
          const transformedData = transformPartWiseCostToComponentData(
            partWiseResult.costAnalysis,
            partWiseResult.baseData,
            vendors
          );
          setCostData(transformedData);

          // Update part-wise summary for overview
          setPartWiseSummary(prev => ({
            ...prev,
            [selectedBomItemId]: calculatePartSummary(partWiseResult.costAnalysis, vendors)
          }));
        }

        // Set factor weights from parallel call
        setFactorWeights({
          cost: weights.costFactor,
          developmentCost: weights.developmentCostFactor,
          leadTime: weights.leadTimeFactor
        });

      } catch (error) {
        // Fallback to empty data structure only if no data exists
        if (costData.length === 0) {
          const fallbackData = createEmptyCostData();
          setCostData(fallbackData);
        }
      } finally {
        setIsLoadingCostData(false);
        setIsLoadingWeights(false);
      }
    };

    // Load data when nomination, BOM part, or vendor list changes
    loadPartWiseCostData();
  }, [nominationId, selectedBomItemId, vendors.length]); // Stable dependencies

  // Clean up duplicates on initial mount
  React.useEffect(() => {
    setCostData(prevData => removeDuplicateEntries(prevData));
  }, []);

  // Update cost data when vendors change - memoized to prevent loops
  React.useEffect(() => {
    if (vendors.length > 0 && costData.length === 0) {
      const newData = createEmptyCostData();
      const cleanData = removeDuplicateEntries(newData);
      setCostData(cleanData);
    }
  }, [vendors.length]); // Only depend on vendor count, not vendor objects

  // Calculate rankings based on cost data - REAL-TIME WITH EDITING VALUES
  React.useEffect(() => {
    setCostData(prev => {
      const newData = [...prev];

      // Find relevant rows
      const netPriceRow = newData.find(item => item.costComponent === "Net Price/unit");
      const devCostRow = newData.find(item => item.costComponent === "Development cost");
      const leadTimeDaysRow = newData.find(item => item.costComponent === "Lead Time Days");

      const rankCostRow = newData.find(item => item.costComponent === "Rank-Cost");
      const rankDevRow = newData.find(item => item.costComponent === "Rank-Development cost");
      const rankLeadRow = newData.find(item => item.costComponent === "Lead Time Ranking");
      const totalScoreRow = newData.find(item => item.costComponent === "Total Score");
      const overallRankRow = newData.find(item => item.costComponent === "Overall Rank");

      // Get current values (including edited ones)
      const getCurrentNetPriceValues = () =>
        netPriceRow ? netPriceRow.supplierValues.map((_, index) =>
          getCurrentSupplierValue(netPriceRow.id, index)
        ) : [];

      const getCurrentDevCostValues = () =>
        devCostRow ? devCostRow.supplierValues.map((_, index) =>
          getCurrentSupplierValue(devCostRow.id, index)
        ) : [];

      const getCurrentLeadTimeValues = () =>
        leadTimeDaysRow ? leadTimeDaysRow.supplierValues.map((_, index) =>
          getCurrentSupplierValue(leadTimeDaysRow.id, index)
        ) : [];

      if (netPriceRow && rankCostRow) {
        // Calculate Cost Rankings using current values (including edited ones)
        const currentNetPrices = getCurrentNetPriceValues();
        const hasNetPriceData = currentNetPrices.some(val => val > 0);

        if (hasNetPriceData) {
          const sortedIndices = [...Array(currentNetPrices.length).keys()]
            .sort((a, b) => (currentNetPrices[a] ?? 0) - (currentNetPrices[b] ?? 0));
          rankCostRow.supplierValues = rankCostRow.supplierValues.map((_, index) =>
            sortedIndices.indexOf(index) + 1
          );
        } else {
          rankCostRow.supplierValues = new Array(rankCostRow.supplierValues.length).fill(0);
        }
      }

      if (devCostRow && rankDevRow) {
        // Calculate Development Cost Rankings using current values (including edited ones)
        const currentDevCosts = getCurrentDevCostValues();
        const hasDevCostData = currentDevCosts.some(val => val > 0);

        if (hasDevCostData) {
          const sortedIndices = [...Array(currentDevCosts.length).keys()]
            .sort((a, b) => (currentDevCosts[a] ?? 0) - (currentDevCosts[b] ?? 0));
          rankDevRow.supplierValues = rankDevRow.supplierValues.map((_, index) =>
            sortedIndices.indexOf(index) + 1
          );
        } else {
          rankDevRow.supplierValues = new Array(rankDevRow.supplierValues.length).fill(0);
        }
      }

      if (leadTimeDaysRow && rankLeadRow) {
        // Calculate Lead Time Rankings using current values (including edited ones)
        const currentLeadTimes = getCurrentLeadTimeValues();
        const hasLeadTimeData = currentLeadTimes.some(val => val > 0);

        if (hasLeadTimeData) {
          const sortedIndices = [...Array(currentLeadTimes.length).keys()]
            .sort((a, b) => (currentLeadTimes[a] ?? 0) - (currentLeadTimes[b] ?? 0));
          rankLeadRow.supplierValues = rankLeadRow.supplierValues.map((_, index) =>
            sortedIndices.indexOf(index) + 1
          );
        } else {
          rankLeadRow.supplierValues = new Array(rankLeadRow.supplierValues.length).fill(0);
        }
      }

      if (rankCostRow && rankDevRow && rankLeadRow && totalScoreRow && netPriceRow && devCostRow && leadTimeDaysRow) {
        // Calculate Total Score using current values (including edited ones)
        const currentNetPrices = getCurrentNetPriceValues();
        const currentDevCosts = getCurrentDevCostValues();
        const currentLeadTimes = getCurrentLeadTimeValues();

        const hasRealData = currentNetPrices.some(val => val > 0) ||
          currentDevCosts.some(val => val > 0) ||
          currentLeadTimes.some(val => val > 0);

        if (hasRealData) {
          totalScoreRow.supplierValues = totalScoreRow.supplierValues.map((_, index) =>
            Math.round((((rankCostRow.supplierValues[index] ?? 0) * factorWeights.cost / 100) +
              ((rankDevRow.supplierValues[index] ?? 0) * factorWeights.developmentCost / 100) +
              ((rankLeadRow.supplierValues[index] ?? 0) * factorWeights.leadTime / 100)) * 100) / 100
          );
        } else {
          // Reset to 0 if no real data
          totalScoreRow.supplierValues = new Array(totalScoreRow.supplierValues.length).fill(0);
        }
      }

      if (totalScoreRow && overallRankRow) {
        // Only calculate Overall Rankings if there are actual total scores
        const hasTotalScores = totalScoreRow.supplierValues.some(val => val > 0);

        if (hasTotalScores) {
          const sortedIndices = [...Array(totalScoreRow.supplierValues.length).keys()]
            .sort((a, b) => (totalScoreRow.supplierValues[a] ?? 0) - (totalScoreRow.supplierValues[b] ?? 0));
          overallRankRow.supplierValues = overallRankRow.supplierValues.map((_, index) =>
            sortedIndices.indexOf(index) + 1
          );
        } else {
          // Reset to 0 if no total scores
          overallRankRow.supplierValues = new Array(overallRankRow.supplierValues.length).fill(0);
        }
      }

      return newData;
    });
  }, [factorWeights, editingCostValues]);

  // Call onDataUpdate when costData changes - memoized to prevent loops
  const memoizedOnDataUpdate = React.useCallback((data: CostCompetencyData[]) => {
    if (onDataUpdate) {
      onDataUpdate(data);
    }
  }, [onDataUpdate]);

  React.useEffect(() => {
    if (costData.length > 0) {
      // Debounce the callback to prevent excessive calls
      const timeoutId = setTimeout(() => {
        memoizedOnDataUpdate(costData);
      }, 100);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [costData, memoizedOnDataUpdate]);

  // ENTERPRISE BEST PRACTICE: Local updates without API calls
  const updateSupplierValueLocal = (rowId: number, supplierIndex: number, value: number) => {
    // Only update local editing state
    const key = `${rowId}_${supplierIndex}`;
    setEditingCostValues(prev => ({
      ...prev,
      [key]: { type: 'supplier', value }
    }));
  };

  const updateBaseValueLocal = (rowId: number, value: number) => {
    const key = `base_${rowId}`;
    setEditingCostValues(prev => ({
      ...prev,
      [key]: { type: 'base', value }
    }));
  };

  const updatePaymentTermLocal = (rowId: number, index: number, value: string) => {
    const key = `payment_${rowId}_${index}`;
    setEditingCostValues(prev => ({
      ...prev,
      [key]: { type: 'payment', value }
    }));
  };

  const updateBasePaymentTermLocal = (value: string) => {
    const key = 'base_payment_terms';
    setEditingCostValues(prev => ({
      ...prev,
      [key]: { type: 'base_payment', value }
    }));
  };

  // Get current value (edited or original)
  const getCurrentSupplierValue = (rowId: number, supplierIndex: number): number => {
    const key = `${rowId}_${supplierIndex}`;
    const editedValue = editingCostValues[key];
    if (editedValue?.type === 'supplier') {
      return editedValue.value;
    }
    const row = costData.find(item => item.id === rowId);
    return row?.supplierValues[supplierIndex] || 0;
  };

  const getCurrentBaseValue = (rowId: number): number => {
    const key = `base_${rowId}`;
    const editedValue = editingCostValues[key];
    if (editedValue?.type === 'base') {
      return editedValue.value;
    }
    const row = costData.find(item => item.id === rowId);
    return row?.baseValue || 0;
  };

  const getCurrentPaymentTerm = (rowId: number, index: number): string => {
    const key = `payment_${rowId}_${index}`;
    const editedValue = editingCostValues[key];
    if (editedValue?.type === 'payment') {
      return editedValue.value;
    }
    const row = costData.find(item => item.id === rowId);
    return row?.paymentTerms?.[index] || '';
  };

  const getCurrentBasePaymentTerm = (): string => {
    const key = 'base_payment_terms';
    const editedValue = editingCostValues[key];
    if (editedValue?.type === 'base_payment') {
      return editedValue.value;
    }
    const row = costData.find(item => item.costComponent === 'Payment Terms');
    return row?.basePaymentTerm || '';
  };

  // ENTERPRISE BEST PRACTICE: Batch save all changes
  const saveCostData = async () => {
    if (!nominationId || Object.keys(editingCostValues).length === 0) {
      return;
    }

    setIsSavingCost(true);

    try {
      // Apply all changes to local state first
      const updatedCostData = [...costData];

      Object.entries(editingCostValues).forEach(([key, change]) => {
        if (change.type === 'supplier') {
          const parts = key.split('_');
          const rowId = Number(parts[0]);
          const supplierIndex = Number(parts[1]);
          if (!isNaN(rowId) && !isNaN(supplierIndex)) {
            const row = updatedCostData.find(item => item.id === rowId);
            if (row) {
              row.supplierValues[supplierIndex] = change.value;
            }
          }
        } else if (change.type === 'base') {
          const rowId = Number(key.replace('base_', ''));
          const row = updatedCostData.find(item => item.id === rowId);
          if (row) {
            row.baseValue = change.value;
          }
        } else if (change.type === 'payment') {
          const parts = key.split('_');
          const rowId = Number(parts[1]);
          const index = Number(parts[2]);
          if (!isNaN(rowId) && !isNaN(index)) {
            const row = updatedCostData.find(item => item.id === rowId);
            if (row && row.paymentTerms) {
              row.paymentTerms[index] = change.value;
            }
          }
        } else if (change.type === 'base_payment') {
          const row = updatedCostData.find(item => item.costComponent === 'Payment Terms');
          if (row) {
            row.basePaymentTerm = change.value;
          }
        }
      });

      // Transform to part-wise API format and send batch update - ENTERPRISE BEST PRACTICE
      if (!selectedBomItemId) {
        throw new Error('No BOM part selected for cost analysis');
      }

      const bulkUpdateData = transformComponentDataToPartWise(updatedCostData, vendors, nominationId, selectedBomItemId);
      await bulkUpdatePartWiseCostAnalysis(nominationId, selectedBomItemId, bulkUpdateData);

      // Update local state and clear editing state
      setCostData(updatedCostData);
      setEditingCostValues({});
      setIsEditingCost(false);

      // Show success message with count
      const changeCount = Object.keys(editingCostValues).length;
      toast.success(`Successfully saved ${changeCount} cost data changes`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Provide specific error message based on the error type
      if (errorMessage.includes('token')) {
        toast.error('Session expired. Please refresh the page and try again.');
      } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        toast.error('Network error. Please check your connection and try again.');
      } else {
        toast.error(`Failed to save cost data: ${errorMessage}`);
      }
    } finally {
      setIsSavingCost(false);
    }
  };

  // Cancel cost editing
  const cancelCostEditing = () => {
    setEditingCostValues({});
    setIsEditingCost(false);
  };

  // Handle weight changes with API integration
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleWeightChange = async (type: 'cost' | 'developmentCost' | 'leadTime', value: number) => {
    const newWeights = { ...factorWeights, [type]: value };

    // Validate weights sum to 100 (with tolerance for floating point precision)
    const sum = newWeights.cost + newWeights.developmentCost + newWeights.leadTime;
    if (Math.abs(sum - 100) > 0.1) {
      // Still allow the change for UI responsiveness
    }

    setFactorWeights(newWeights);

    // Update via API with rounded values to avoid floating-point precision issues
    if (nominationId) {
      try {
        // Round to 2 decimal places to avoid floating-point precision issues
        const roundedWeights = {
          costFactor: Math.round(newWeights.cost * 100) / 100,
          developmentCostFactor: Math.round(newWeights.developmentCost * 100) / 100,
          leadTimeFactor: Math.round(newWeights.leadTime * 100) / 100
        };

        await updateFactorWeights(nominationId, roundedWeights);

        // Recalculate rankings with new weights
        await handleCalculateRankings();
      } catch (error) {
        // Show user-friendly error message
        if (error instanceof Error && error.message.includes('must sum to 100%')) {
          // Auto-adjust the last weight to make sum exactly 100
          const adjustedLeadTime = 100 - newWeights.cost - newWeights.developmentCost;
          setFactorWeights(prev => ({ ...prev, leadTime: adjustedLeadTime }));
        }
      }
    }
  };

  // Calculate and update rankings
  const handleCalculateRankings = async () => {
    if (!nominationId) return;

    try {
      const newRankings = await calculateSupplierRankings(nominationId);
      // setRankings(newRankings); // Removed unused state update

      // Update the cost data with new rankings
      setCostData(prev => {
        const newData = [...prev];

        // Update ranking data from API response
        newRankings.forEach((ranking, index) => {
          const rankCostRow = newData.find(item => item.costComponent === "Rank-Cost");
          const rankDevRow = newData.find(item => item.costComponent === "Rank-Development cost");
          const rankLeadRow = newData.find(item => item.costComponent === "Lead Time Ranking");
          const totalScoreRow = newData.find(item => item.costComponent === "Total Score");
          const overallRankRow = newData.find(item => item.costComponent === "Overall Rank");

          if (rankCostRow) rankCostRow.supplierValues[index] = ranking.costRank;
          if (rankDevRow) rankDevRow.supplierValues[index] = ranking.developmentCostRank;
          if (rankLeadRow) rankLeadRow.supplierValues[index] = ranking.leadTimeRank;
          if (totalScoreRow) totalScoreRow.supplierValues[index] = ranking.totalScore;
          if (overallRankRow) overallRankRow.supplierValues[index] = ranking.overallRank;
        });

        return newData;
      });
    } catch (error) {
      // Rankings calculation failed
    }
  };

  // Simplified inline editing - no mode management needed

  // Common payment terms options
  const paymentTermOptions = [
    "100% Advance",
    "30 Days credit",
    "Against delivery",
    "50% ADP +50% AD",
    "15 Days credit",
    "45 Days credit",
    "60 Days credit",
    "90 Days credit",
    "Cash on Delivery",
    "Letter of Credit"
  ];

  const supplierSummary = useMemo(() => {
    const overallRanking = costData.find(item => item.costComponent === "Overall Rank");
    const competencyScore = costData.find(item => item.costComponent === "Cost Competency Score");
    const netPrice = costData.find(item => item.costComponent === "Net Price/unit");
    const devCost = costData.find(item => item.costComponent === "Development cost");

    const numVendors = vendors.length || 4;
    return Array(numVendors).fill(0).map((_, index) => ({
      rank: overallRanking?.supplierValues[index] || 0,
      score: competencyScore?.supplierValues[index] || 0,
      netPrice: netPrice?.supplierValues[index] || 0,
      devCost: devCost?.supplierValues[index] || 0
    }));
  }, [costData, vendors]);

  const getRankingColor = (rank: number) => {
    switch (rank) {
      case 1: return 'bg-green-500/20 text-green-400 border-green-500';
      case 2: return 'bg-blue-500/20 text-blue-400 border-blue-500';
      case 3: return 'bg-yellow-500/20 text-yellow-400 border-yellow-500';
      case 4: return 'bg-red-500/20 text-red-400 border-red-500';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500';
    }
  };

  const getRankingIcon = (rank: number) => {
    if (rank === 1) return <Award className="h-3 w-3" />;
    if (rank <= 2) return <TrendingUp className="h-3 w-3" />;
    return <TrendingDown className="h-3 w-3" />;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _getBestSupplier = () => {
    if (supplierSummary.length === 0) return 'No suppliers';

    const bestRank = Math.min(...supplierSummary.map(s => s.rank));
    const bestIndex = supplierSummary.findIndex(s => s.rank === bestRank);

    if (vendors[bestIndex]) {
      return vendors[bestIndex].name;
    }
    return `Supplier-${bestIndex + 1}`;
  };

  // Remove loading state to show data immediately and prevent duplicate requests

  // Show empty state if no vendors
  if (!vendors || vendors.length === 0) {
    return (
      <div className="space-y-6">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-8 text-center">
            <Calculator className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-300 mb-2">No Vendors Selected</h3>
            <p className="text-gray-400 mb-4">Add vendors to the nomination to start cost competency analysis</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show empty state if no project ID provided
  if (!projectId) {
    return (
      <div className="space-y-6">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-8 text-center">
            <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-300 mb-2">No Project Context</h3>
            <p className="text-gray-400 mb-4">Project information is required to load BOMs for cost analysis</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Part-wise Cost Vendor Rating Dashboard */}
      {availableBomParts.length > 1 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Part-wise Vendor Performance Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {availableBomParts.map((part) => {
                // Get real part-wise summary data
                const partSummary = partWiseSummary[part.bomItemId] || {
                  topVendor: vendors.length > 0 ? vendors[0] : null,
                  bestScore: 0,
                  lowestCost: 0,
                  vendorCount: vendors.length
                };

                return (
                  <div key={part.bomItemId} className="bg-gray-900 rounded-lg p-4 border border-gray-600">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-white font-medium text-sm">{part.bomItemName}</h4>
                        {part.partNumber && (
                          <p className="text-gray-400 text-xs">Part: {part.partNumber}</p>
                        )}
                      </div>
                      <Badge
                        variant={selectedBomItemId === part.bomItemId ? "default" : "outline"}
                        className={selectedBomItemId === part.bomItemId ? "bg-blue-600" : "border-gray-600"}
                      >
                        {selectedBomItemId === part.bomItemId ? "Active" : "View"}
                      </Badge>
                    </div>

                    <div className="space-y-2">
                      {/* Top Vendor */}
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 text-xs">Top Vendor:</span>
                        {partSummary.topVendor ? (
                          <div className="flex items-center gap-1">
                            <Award className="h-3 w-3 text-green-400" />
                            <span className="text-green-400 text-xs font-medium">
                              {partSummary.topVendor.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-500 text-xs">No data</span>
                        )}
                      </div>

                      {/* Overall Score */}
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 text-xs">Best Score:</span>
                        <span className="text-white text-xs font-medium">
                          {partSummary.bestScore > 0 ? partSummary.bestScore.toFixed(2) : "No data"}
                        </span>
                      </div>

                      {/* Net Price (if available) */}
                      {partSummary.lowestCost > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-400 text-xs">Best Price:</span>
                          <span className="text-green-400 text-xs font-medium">
                            ₹{partSummary.lowestCost.toFixed(2)}
                          </span>
                        </div>
                      )}

                      {/* Vendor Count */}
                      <div className="flex items-center justify-between">
                        <span className="text-gray-400 text-xs">Vendors:</span>
                        <span className="text-blue-400 text-xs font-medium">{partSummary.vendorCount}</span>
                      </div>

                      {/* Action Button */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-2 border-gray-600 text-gray-300 hover:bg-gray-700"
                        onClick={() => setSelectedBomItemId(part.bomItemId)}
                      >
                        {selectedBomItemId === part.bomItemId ? "Currently Selected" : "Analyze Part"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* BOM Part Selection for Nomination */}
      {availableBomParts.length > 0 ? (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-white flex items-center gap-2">
                <Package className="h-5 w-5" />
                Select BOM Part for Cost Analysis
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex-1 max-w-md">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  BOM Parts (from this nomination)
                </label>
                <Select value={selectedBomItemId} onValueChange={setSelectedBomItemId}>
                  <SelectTrigger className="w-full bg-gray-700 border-gray-600 text-white">
                    <SelectValue placeholder="Select a BOM part to analyze..." />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-700 border-gray-600">
                    {availableBomParts.map((part) => (
                      <SelectItem
                        key={part.bomItemId}
                        value={part.bomItemId}
                        className="text-white hover:bg-gray-600 focus:bg-gray-600"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{part.bomItemName}</span>
                          <div className="text-xs text-gray-400 space-x-2">
                            {part.partNumber && <span>Part: {part.partNumber}</span>}
                            {part.material && <span>Material: {part.material}</span>}
                            <span>Qty: {part.quantity}</span>
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedBomItemId && (
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <span>Selected:</span>
                  <Badge variant="outline" className="border-green-500 text-green-400">
                    {availableBomParts.find(part => part.bomItemId === selectedBomItemId)?.bomItemName}
                  </Badge>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-8 text-center">
            <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-300 mb-2">No BOMs Available</h3>
            <p className="text-gray-400 mb-4">
              No BOMs found for this project. Create a BOM first to perform part-wise cost analysis.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Cost Competency Analysis Table */}
      {(availableBomParts.length === 0 || selectedBomItemId) ? (
        // Show cost analysis table if no BOMs available (fallback) or when a BOM part is selected
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-white flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                {selectedBomItemId ? (
                  <>
                    Part-wise Cost Analysis - {availableBomParts.find(p => p.bomItemId === selectedBomItemId)?.bomItemName || 'Selected Part'}
                    <Badge variant="secondary" className="ml-2">
                      {availableBomParts.find(p => p.bomItemId === selectedBomItemId)?.partNumber || 'Part'}
                    </Badge>
                  </>
                ) : (
                  'Cost Competency Score & Financial Stability Analysis'
                )}
              </CardTitle>
              {/* Action Buttons - ENTERPRISE BEST PRACTICE */}
              <div className="flex items-center gap-2">
                {isEditingCost ? (
                  <>
                    {Object.keys(editingCostValues).length > 0 && (
                      <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                        {Object.keys(editingCostValues).length} unsaved changes
                      </Badge>
                    )}
                    <Button
                      onClick={saveCostData}
                      disabled={isSavingCost || Object.keys(editingCostValues).length === 0}
                      className="bg-green-600 hover:bg-green-700 text-white"
                      size="sm"
                    >
                      {isSavingCost ? (
                        <>
                          <Save className="h-4 w-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4 mr-2" />
                          Save Changes
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={cancelCostEditing}
                      disabled={isSavingCost}
                      variant="outline"
                      size="sm"
                      className="border-gray-600 text-gray-300 hover:bg-gray-700"
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => setIsEditingCost(true)}
                    variant="outline"
                    size="sm"
                    className="border-gray-600 text-gray-300 hover:bg-gray-700"
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Cost Data
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-700">
                  <TableHead className="text-gray-300 font-medium w-[200px]">Cost Component</TableHead>
                  <TableHead className="text-center text-gray-300 font-medium w-[120px]">Base/Reference</TableHead>
                  {vendors.length > 0 ? vendors.map((vendor, index) => {
                    const colors = ['text-blue-400', 'text-green-400', 'text-yellow-400', 'text-purple-400'];
                    return (
                      <TableHead key={vendor.id} className={`text-center ${colors[index % colors.length]} font-medium w-[100px]`}>
                        {vendor.name}
                      </TableHead>
                    );
                  }) : (
                    <>
                      <TableHead className="text-center text-blue-400 font-medium w-[100px]">Supplier-1</TableHead>
                      <TableHead className="text-center text-green-400 font-medium w-[100px]">Supplier-2</TableHead>
                      <TableHead className="text-center text-yellow-400 font-medium w-[100px]">Supplier-3</TableHead>
                      <TableHead className="text-center text-purple-400 font-medium w-[100px]">Supplier-4</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {costData.map((row) => (
                  <TableRow key={row.id} className="border-gray-700">
                    <TableCell className="text-white font-medium text-left pl-4">{row.costComponent}</TableCell>

                    {/* Base/Reference Value - Edit Mode Pattern */}
                    <TableCell className="text-center text-gray-300">
                      {row.costComponent === "Payment Terms" ? (
                        isEditingCost ? (
                          <Select
                            value={getCurrentBasePaymentTerm()}
                            onValueChange={updateBasePaymentTermLocal}
                          >
                            <SelectTrigger className="w-32 h-8 bg-gray-700 border-gray-600 text-white text-xs">
                              <SelectValue placeholder="Base terms" />
                            </SelectTrigger>
                            <SelectContent className="bg-gray-700 border-gray-600">
                              {paymentTermOptions.map((option) => (
                                <SelectItem
                                  key={option}
                                  value={option}
                                  className="text-white hover:bg-gray-600 focus:bg-gray-600"
                                >
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-white font-medium text-sm px-2 py-1">
                            {getCurrentBasePaymentTerm() || "-"}
                          </span>
                        )
                      ) : row.isRanking ? (
                        <div className="text-xs text-gray-400 px-2 py-1">
                          Auto-calc
                        </div>
                      ) : isEditingCost ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={getCurrentBaseValue(row.id)}
                          onChange={(e) => updateBaseValueLocal(row.id, parseFloat(e.target.value) || 0)}
                          className="w-24 h-8 bg-gray-700 border-gray-600 text-white text-sm text-center"
                          placeholder="0.00"
                        />
                      ) : (
                        <span className="text-white font-medium text-sm">
                          {getCurrentBaseValue(row.id).toFixed(2)}
                        </span>
                      )}
                    </TableCell>

                    {/* Dynamic Supplier Columns - Edit Mode Pattern */}
                    {row.paymentTerms ? (
                      // Payment Terms Row - Edit Mode Pattern
                      row.paymentTerms.map((_, index) => {
                        return (
                          <TableCell key={index} className="text-center">
                            {isEditingCost ? (
                              <Select
                                value={getCurrentPaymentTerm(row.id, index)}
                                onValueChange={(value) => updatePaymentTermLocal(row.id, index, value)}
                              >
                                <SelectTrigger className="w-32 h-8 bg-gray-700 border-gray-600 text-white text-xs">
                                  <SelectValue placeholder="Select terms" />
                                </SelectTrigger>
                                <SelectContent className="bg-gray-700 border-gray-600">
                                  {paymentTermOptions.map((option) => (
                                    <SelectItem
                                      key={option}
                                      value={option}
                                      className="text-white hover:bg-gray-600 focus:bg-gray-600"
                                    >
                                      {option}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-white font-medium text-sm px-2 py-1">
                                {getCurrentPaymentTerm(row.id, index) || "-"}
                              </span>
                            )}
                          </TableCell>
                        );
                      })
                    ) : (
                      // Regular Numeric Values - Edit Mode Pattern  
                      row.supplierValues.map((_, index) => {
                        const colors = ['text-blue-400', 'text-green-400', 'text-yellow-400', 'text-purple-400'];
                        const colorClass = colors[index % colors.length];
                        const currentValue = getCurrentSupplierValue(row.id, index);

                        return (
                          <TableCell key={index} className="text-center">
                            {row.isRanking ? (
                              <Badge className={`${getRankingColor(currentValue)} flex items-center gap-1 justify-center w-12`}>
                                {getRankingIcon(currentValue)}
                                {currentValue || '-'}
                              </Badge>
                            ) : isEditingCost ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={currentValue}
                                onChange={(e) => updateSupplierValueLocal(row.id, index, parseFloat(e.target.value) || 0)}
                                className={`w-20 h-8 bg-gray-700 border-gray-600 text-white text-sm text-center ${colorClass} font-medium`}
                                placeholder="0.00"
                              />
                            ) : (
                              <span className={`${colorClass} font-medium text-sm`}>
                                {currentValue.toFixed(2)}
                              </span>
                            )}
                          </TableCell>
                        );
                      })
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        // Show message when BOM parts are available but none is selected
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-8 text-center">
            <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-300 mb-2">Select a BOM Part</h3>
            <p className="text-gray-400 mb-4">Choose a BOM part from the dropdown above to start part-wise cost analysis</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}