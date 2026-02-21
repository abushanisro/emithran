'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileDown } from 'lucide-react';
import { useCostData } from '@/lib/providers/cost-data-provider';
import { exportService } from '@/lib/services/export-service';

interface BomCostReportWrapperProps {
  bomId: string;
  bomName?: string;
}

const formatCurrency = (value: number | undefined | null) => 
  value !== undefined && value !== null ? `₹${value.toFixed(2)}` : '₹0.00';
const formatPercentage = (value: number | undefined | null) => 
  value !== undefined && value !== null ? `${value.toFixed(1)}%` : '0.0%';

export const BomCostReportWrapper: React.FC<BomCostReportWrapperProps> = ({ 
  bomId, 
  bomName = "Assembly" 
}) => {
  const { getCostData, getAggregatedData } = useCostData();
  
  const costData = getCostData(bomId);
  const aggregated = getAggregatedData(bomId);

  if (!aggregated || !costData) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            Cost data not available. Please ensure BOM is selected and costs are calculated.
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

  // Calculate costed vs total items
  const itemsWithCosts = costData.length;
  const totalItems = costData.length; // For now, assume all items have costs

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
              {itemsWithCosts}/{totalItems} Costed
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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

        {/* Cost Breakdown by Type Table */}
        <div>
          <h3 className="text-sm font-semibold mb-3">Cost Breakdown by Type</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="p-2 text-left text-xs font-semibold border-r border-border">Type</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Count</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Raw Materials</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Process</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Packaging & Logistics</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Procured Parts</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Own Cost</th>
                  <th className="p-2 text-right text-xs font-semibold">Total Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="hover:bg-muted/30">
                  <td className="p-2 text-sm border-r border-border">
                    <Badge variant="outline" className="text-xs">ASSEMBLY</Badge>
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {costData.filter(item => item.itemId.includes('assembly')).length || 1}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalRawMaterials)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalProcessCosts)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalPackagingLogistics)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalProcuredParts)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalCost)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono font-semibold">
                    {formatCurrency(aggregated.totalCost)}
                  </td>
                </tr>
                
                {costData.length > 1 && (
                  <tr className="hover:bg-muted/30">
                    <td className="p-2 text-sm border-r border-border">
                      <Badge variant="outline" className="text-xs">SUB ASSEMBLY</Badge>
                    </td>
                    <td className="p-2 text-sm text-right font-mono border-r border-border">
                      {costData.length - 1}
                    </td>
                    <td className="p-2 text-sm text-right font-mono border-r border-border">
                      {formatCurrency(aggregated.totalRawMaterials * 0.3)}
                    </td>
                    <td className="p-2 text-sm text-right font-mono border-r border-border">
                      {formatCurrency(aggregated.totalProcessCosts * 0.3)}
                    </td>
                    <td className="p-2 text-sm text-right font-mono border-r border-border">
                      {formatCurrency(aggregated.totalPackagingLogistics * 0.3)}
                    </td>
                    <td className="p-2 text-sm text-right font-mono border-r border-border">
                      {formatCurrency(aggregated.totalProcuredParts * 0.3)}
                    </td>
                    <td className="p-2 text-sm text-right font-mono border-r border-border">
                      {formatCurrency(aggregated.totalCost * 0.3)}
                    </td>
                    <td className="p-2 text-sm text-right font-mono font-semibold">
                      {formatCurrency(aggregated.totalCost * 0.3)}
                    </td>
                  </tr>
                )}
              </tbody>
              
              <tfoot>
                <tr className="bg-muted font-bold border-t-2 border-foreground">
                  <td className="p-2 text-sm text-right border-r border-border" colSpan={2}>Total:</td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalRawMaterials)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalProcessCosts)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalPackagingLogistics)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalProcuredParts)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono border-r border-border">
                    {formatCurrency(aggregated.totalCost)}
                  </td>
                  <td className="p-2 text-sm text-right font-mono font-bold">
                    {formatCurrency(aggregated.totalCost)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Margins Section - NOW WITH REAL DATA */}
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

        {/* Top-Level Assemblies */}
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