'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileDown, RefreshCw } from 'lucide-react';
import { useCostData } from '@/lib/providers/cost-data-provider';
import { exportService } from '@/lib/services/export-service';
import { apiClient } from '@/lib/api/client';
import type { BOMItem } from '@/lib/api/hooks/useBOMItems';

interface BomCostReportWrapperProps {
  bomId: string;
  bomName?: string;
}

const formatCurrency = (value: number | undefined | null) => {
  if (value === undefined || value === null || isNaN(value)) return '$0.00';
  return `$${value.toFixed(2)}`;
};
const formatPercentage = (value: number | undefined | null) => {
  if (value === undefined || value === null || isNaN(value)) return '0.0%';
  return `${value.toFixed(1)}%`;
};

export const BomCostReportWrapper: React.FC<BomCostReportWrapperProps> = ({ 
  bomId, 
  bomName = "Assembly" 
}) => {
  // Use the cost data provider to get aggregated cost data
  const { getCostData, getAggregatedData, calculateBomCosts, isCalculating } = useCostData();
  const [bomItems, setBomItems] = useState<BOMItem[]>([]);
  
  const costData = getCostData(bomId);
  const aggregated = getAggregatedData(bomId);

  // Fetch BOM items for detailed part information
  useEffect(() => {
    const fetchBomItems = async () => {
      try {
        const response = await apiClient.get(`/boms/${bomId}/items`);
        const items: BOMItem[] = response.items || response.data || [];
        setBomItems(items);
      } catch (error) {
        console.error('Error fetching BOM items:', error);
        setBomItems([]);
      }
    };

    if (bomId) {
      fetchBomItems();
    }
  }, [bomId]);

  // Trigger calculation only once when BOM is first loaded and no data exists
  useEffect(() => {
    if (bomId && !costData && !isCalculating) {
      calculateBomCosts(bomId);
    }
  }, [bomId, costData, isCalculating, calculateBomCosts]);

  // Loading state
  if (isCalculating) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center gap-3">
            <RefreshCw className="w-5 h-5 animate-spin text-primary" />
            <span className="text-muted-foreground">Calculating cost report...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No data state
  if (!aggregated || !costData) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center">
            <p className="text-muted-foreground mb-3">No cost data available for this BOM.</p>
            <Button variant="outline" size="sm" onClick={() => calculateBomCosts(bomId)}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Calculate Costs
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleExportToDraft = async () => {
    if (!aggregated || !costData) {
      return;
    }

    try {
      const format = await exportService.showExportDialog();
      if (format) {
        const exportData = exportService.prepareExportData(
          bomId,
          bomName,
          aggregated,
          costData,
          'Manufacturing Project'
        );
        await exportService.exportCostAnalysis(exportData, format);
      }
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  return (
    <div className="card border-l-4 border-l-primary shadow-md rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-primary py-3 px-4">
        <div className="flex items-center justify-between">
          <h6 className="m-0 font-semibold text-primary-foreground">
            Comprehensive Cost Report: {bomName}
          </h6>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {costData.length}/{bomItems.length > 0 ? bomItems.length : costData.length} Costed
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportToDraft}
              className="flex items-center gap-1 text-xs h-7"
            >
              <FileDown className="w-3 h-3" />
              Export Draft
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-card p-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          <div className="bg-background p-3 rounded border border-border">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Raw Materials</span>
            </div>
            <div className="text-lg font-mono font-semibold">
              {formatCurrency(aggregated.totalRawMaterials)}
            </div>
          </div>
          
          <div className="bg-background p-3 rounded border border-border">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Process Costs</span>
            </div>
            <div className="text-lg font-mono font-semibold">
              {formatCurrency(aggregated.totalProcessCosts)}
            </div>
          </div>

          <div className="bg-background p-3 rounded border border-border">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Tooling & Fixtures</span>
            </div>
            <div className="text-lg font-mono font-semibold">
              {formatCurrency(aggregated.totalToolingCosts || 0)}
            </div>
          </div>
          
          <div className="bg-background p-3 rounded border border-border">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Packaging & Logistics</span>
            </div>
            <div className="text-lg font-mono font-semibold">
              {formatCurrency(aggregated.totalPackagingLogistics)}
            </div>
          </div>
          
          <div className="bg-background p-3 rounded border border-border">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Procured Parts</span>
            </div>
            <div className="text-lg font-mono font-semibold">
              {formatCurrency(aggregated.totalProcuredParts)}
            </div>
          </div>
          
          <div className="bg-background p-3 rounded border-2 border-foreground">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Total Cost</span>
            </div>
            <div className="text-lg font-mono font-bold">
              {formatCurrency(aggregated.totalCost)}
            </div>
          </div>
          
          <div className="bg-background p-3 rounded border-2 border-foreground">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Selling Price</span>
            </div>
            <div className="text-lg font-mono font-bold">
              {formatCurrency(aggregated.totalSellingPrice)}
            </div>
          </div>
        </div>

        {/* Detailed Part-wise Cost Breakdown Table */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Detailed Part-wise Cost Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="p-2 text-left text-xs font-semibold border-r border-border">Part Details</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Qty</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Raw Materials</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Process</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Tooling</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Packaging & Logistics</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Procured Parts</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">SGA</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Profit</th>
                  <th className="p-2 text-right text-xs font-semibold">Total Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {/* Show all BOM items, even if cost data is missing */}
                {bomItems.length > 0 ? bomItems.map((bomItem, index) => {
                  // Find corresponding cost data for this BOM item
                  const costItem = costData.find(ci => ci.itemId === bomItem.id);
                  const breakdown = costItem?.breakdown || {};
                  
                  const getItemTypeColor = (type: string) => {
                    switch (type) {
                      case 'assembly': return 'bg-blue-100 text-blue-800';
                      case 'sub_assembly': return 'bg-purple-100 text-purple-800';
                      case 'child_part': return 'bg-green-100 text-green-800';
                      default: return 'bg-gray-100 text-gray-800';
                    }
                  };
                  
                  return (
                    <tr key={index} className="hover:bg-muted/30">
                      <td className="p-2 text-sm border-r border-border">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge className={`text-xs ${getItemTypeColor(bomItem.itemType || 'unknown')}`}>
                              {bomItem.itemType?.replace('_', ' ').toUpperCase() || 'UNKNOWN'}
                            </Badge>
                            <span className="font-medium">#{index + 1}</span>
                          </div>
                          {bomItem.partNumber && (
                            <div className="text-xs font-mono text-foreground">
                              PN: {bomItem.partNumber}
                            </div>
                          )}
                          <div className="text-xs font-medium text-foreground">
                            {bomItem.name || `Item ${index + 1}`}
                          </div>
                          {bomItem.description && (
                            <div className="text-xs text-muted-foreground max-w-xs truncate" title={bomItem.description}>
                              {bomItem.description}
                            </div>
                          )}
                          {bomItem.material && (
                            <div className="text-xs text-blue-600 font-mono">
                              Material: {bomItem.material}
                            </div>
                          )}
                          {bomItem.makeBuy && (
                            <Badge variant="outline" className={`text-xs ${bomItem.makeBuy === 'make' ? 'bg-orange-50 text-orange-700' : 'bg-indigo-50 text-indigo-700'}`}>
                              {bomItem.makeBuy.toUpperCase()}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {bomItem.quantity || 1} {bomItem.unit ? bomItem.unit : 'pcs'}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.rawMaterialCost || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.processCost || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.toolingCost || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.packagingLogisticsCost || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.procuredPartsCost || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.sgaCost || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.profitAmount || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono font-semibold">
                        {formatCurrency(breakdown.totalCost || 0)}
                      </td>
                    </tr>
                  );
                }) : 
                // Fallback: show cost data items if BOM items are not loaded yet
                costData.map((item, index) => {
                  const breakdown = item.breakdown || {};
                  
                  return (
                    <tr key={index} className="hover:bg-muted/30">
                      <td className="p-2 text-sm border-r border-border">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge className="text-xs bg-gray-100 text-gray-800">
                              UNKNOWN
                            </Badge>
                            <span className="font-medium">#{index + 1}</span>
                          </div>
                          <div className="text-xs font-medium text-foreground">
                            Item {index + 1}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            ID: {item.itemId}
                          </div>
                        </div>
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">1 pcs</td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.rawMaterialCost || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.processCost || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.toolingCost || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.packagingLogisticsCost || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.procuredPartsCost || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.sgaCost || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(breakdown.profitAmount || 0)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono font-semibold">
                        {formatCurrency(breakdown.totalCost || 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              
              <tfoot>
                <tr className="bg-muted font-bold border-t-2 border-foreground">
                  <td className="p-2 text-sm text-right border-r border-border" colSpan={2}>Total ({bomItems.length > 0 ? bomItems.length : costData.length} parts):</td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalRawMaterials)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalProcessCosts)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalToolingCosts || 0)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalPackagingLogistics)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalProcuredParts)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalSgaCost)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalProfitAmount)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono font-bold">
                    {formatCurrency(aggregated.totalSellingPrice)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Hierarchical Cost Summary by Item Type */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Hierarchical Cost Summary by Item Type</h3>
          <div className="space-y-4">
            {/* Calculate costs by item type */}
            {(() => {
              // Group BOM items and their costs by type
              const assemblies = bomItems.filter(item => item.itemType === 'assembly');
              const subAssemblies = bomItems.filter(item => item.itemType === 'sub_assembly');
              const childParts = bomItems.filter(item => item.itemType === 'child_part');

              // Calculate totals for each type
              const calculateTypeTotal = (items: typeof bomItems) => {
                return items.reduce((total, item) => {
                  const costItem = costData.find(ci => ci.itemId === item.id);
                  const cost = costItem?.breakdown?.totalCost || 0;
                  return total + (isNaN(cost) ? 0 : cost);
                }, 0);
              };

              const assemblyCost = calculateTypeTotal(assemblies);
              const subAssemblyCost = calculateTypeTotal(subAssemblies);
              const childPartCost = calculateTypeTotal(childParts);

              return (
                <div className="space-y-3">
                  {/* Assemblies */}
                  {assemblies.length > 0 && (
                    <div className="border border-primary/30 rounded-lg p-4 bg-primary/5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-primary/20 text-primary font-medium">
                            ASSEMBLIES
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            ({assemblies.length} items)
                          </span>
                        </div>
                        <div className="text-lg font-bold text-primary">
                          {formatCurrency(assemblyCost)}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {assemblies.map((item, index) => {
                          const costItem = costData.find(ci => ci.itemId === item.id);
                          const itemCost = isNaN(costItem?.breakdown?.totalCost) ? 0 : (costItem?.breakdown?.totalCost || 0);
                          return (
                            <div key={index} className="flex items-center justify-between p-2 bg-background/50 rounded border border-border/50">
                              <div className="flex flex-col">
                                <span className="text-sm font-medium">{item.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {item.partNumber && `PN: ${item.partNumber} • `}
                                  {item.material && `Material: ${item.material} • `}
                                  Qty: {item.quantity} {item.unit || 'pcs'}
                                </span>
                              </div>
                              <span className="font-mono font-medium">
                                {formatCurrency(itemCost)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Sub-Assemblies */}
                  {subAssemblies.length > 0 && (
                    <div className="border border-secondary/30 rounded-lg p-4 bg-secondary/5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-secondary/20 text-secondary-foreground font-medium">
                            SUB-ASSEMBLIES
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            ({subAssemblies.length} items)
                          </span>
                        </div>
                        <div className="text-lg font-bold text-secondary-foreground">
                          {formatCurrency(subAssemblyCost)}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {subAssemblies.map((item, index) => {
                          const costItem = costData.find(ci => ci.itemId === item.id);
                          const itemCost = isNaN(costItem?.breakdown?.totalCost) ? 0 : (costItem?.breakdown?.totalCost || 0);
                          return (
                            <div key={index} className="flex items-center justify-between p-2 bg-background/50 rounded border border-border/50">
                              <div className="flex flex-col">
                                <span className="text-sm font-medium">{item.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {item.partNumber && `PN: ${item.partNumber} • `}
                                  {item.material && `Material: ${item.material} • `}
                                  Qty: {item.quantity} {item.unit || 'pcs'}
                                </span>
                              </div>
                              <span className="font-mono font-medium">
                                {formatCurrency(itemCost)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Child Parts */}
                  {childParts.length > 0 && (
                    <div className="border border-primary/30 rounded-lg p-4 bg-primary/5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-primary/20 text-primary font-medium">
                            CHILD PARTS
                          </Badge>
                          <span className="text-sm text-primary/70">
                            ({childParts.length} items)
                          </span>
                        </div>
                        <div className="text-lg font-bold text-primary">
                          {formatCurrency(childPartCost)}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {childParts.map((item, index) => {
                          const costItem = costData.find(ci => ci.itemId === item.id);
                          const itemCost = isNaN(costItem?.breakdown?.totalCost) ? 0 : (costItem?.breakdown?.totalCost || 0);
                          return (
                            <div key={index} className="flex items-center justify-between p-2 bg-primary/10 rounded border border-primary/20">
                              <div className="flex flex-col">
                                <span className="text-sm font-medium text-primary">{item.name}</span>
                                <span className="text-xs text-primary/70">
                                  {item.partNumber && `PN: ${item.partNumber} • `}
                                  {item.material && `Material: ${item.material} • `}
                                  Qty: {item.quantity} {item.unit || 'pcs'}
                                </span>
                              </div>
                              <span className="font-mono font-medium text-primary">
                                {formatCurrency(itemCost)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Total Summary */}
                  <div className="border-2 border-foreground rounded-lg p-4 bg-muted">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-lg font-bold">Total BOM Cost</span>
                        <span className="text-sm text-muted-foreground">
                          {assemblies.length} Assembly + {subAssemblies.length} Sub-Assembly + {childParts.length} Child Parts = {bomItems.length} Total Items
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold">
                          {formatCurrency(assemblyCost + subAssemblyCost + childPartCost)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {((assemblyCost + subAssemblyCost + childPartCost) === (aggregated?.totalCost || 0)) 
                            ? '✓ Matches aggregated total' 
                            : `⚠ Difference: ${formatCurrency(Math.abs((assemblyCost + subAssemblyCost + childPartCost) - (aggregated?.totalCost || 0)))}`
                          }
                        </div>
                      </div>
                    </div>

                    {/* Breakdown by type percentages */}
                    <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                      <div className="p-3 bg-primary/15 border border-primary/30 rounded-lg">
                        <div className="text-sm font-medium text-primary">Assembly</div>
                        <div className="text-lg font-bold text-primary">
                          {formatPercentage((assemblyCost / (assemblyCost + subAssemblyCost + childPartCost || 1)) * 100)}
                        </div>
                        <div className="text-xs text-primary/90">{formatCurrency(assemblyCost)}</div>
                      </div>
                      <div className="p-3 bg-primary/15 border border-primary/30 rounded-lg">
                        <div className="text-sm font-medium text-primary">Sub-Assembly</div>
                        <div className="text-lg font-bold text-primary">
                          {formatPercentage((subAssemblyCost / (assemblyCost + subAssemblyCost + childPartCost || 1)) * 100)}
                        </div>
                        <div className="text-xs text-primary/90">{formatCurrency(subAssemblyCost)}</div>
                      </div>
                      <div className="p-3 bg-primary/15 border border-primary/30 rounded-lg">
                        <div className="text-sm font-medium text-primary">Child Parts</div>
                        <div className="text-lg font-bold text-primary">
                          {formatPercentage((childPartCost / (assemblyCost + subAssemblyCost + childPartCost || 1)) * 100)}
                        </div>
                        <div className="text-xs text-primary/90">{formatCurrency(childPartCost)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Margins Section - Real API Data */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border border-border rounded">
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">Average SGA</div>
            <div className="text-lg font-mono font-semibold">
              {formatPercentage(aggregated.averageSgaPercentage)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">Average Profit</div>
            <div className="text-lg font-mono font-semibold">
              {formatPercentage(aggregated.averageProfitPercentage)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">Total Margin</div>
            <div className="text-lg font-mono font-bold">
              {formatCurrency(aggregated.totalMargin)}
            </div>
          </div>
        </div>

        {/* Top-Level Assemblies - Real API Data */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Top-Level Assemblies</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 border border-border rounded hover:bg-muted/30">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-xs">assembly</Badge>
                <span className="font-medium text-sm">{bomName}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Cost</div>
                  <div className="font-mono font-semibold">
                    {formatCurrency(aggregated.totalCost)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Selling</div>
                  <div className="font-mono font-bold">
                    {formatCurrency(aggregated.totalSellingPrice)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};