'use client';

import React from 'react';
import { useBomCostReport } from '@/lib/api/hooks/useBomItemCosts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileDown } from 'lucide-react';

interface BomCostReportProps {
  bomId: string | null;
}

const formatCurrency = (value: number) => `₹${value.toFixed(2)}`;
const formatPercentage = (value: number) => `${value.toFixed(1)}%`;

export const BomCostReport: React.FC<BomCostReportProps> = ({ bomId }) => {
  const { data: report, isLoading, error } = useBomCostReport(bomId);

  const handleExportToDraft = () => {
    
  };

  if (!bomId) return null;

  if (isLoading) {
    return (
      <div className="card border-l-4 border-l-primary shadow-md rounded-lg overflow-hidden">
        <div className="bg-primary py-3 px-4">
          <h6 className="m-0 font-semibold text-primary-foreground">
            Cost Report
          </h6>
        </div>
        <div className="bg-card p-8 text-center text-muted-foreground">
          Loading cost report...
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="card border-l-4 border-l-destructive shadow-md rounded-lg overflow-hidden">
        <div className="bg-destructive py-3 px-4">
          <h6 className="m-0 font-semibold text-destructive-foreground">
            Cost Report Error
          </h6>
        </div>
        <div className="bg-card p-4 text-center text-destructive">
          Failed to load cost report. Please try again.
        </div>
      </div>
    );
  }

  const { breakdown, costByType, topLevelAssemblies, bomName, totalItems, itemsWithCosts, staleCosts } = report;

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
            {staleCosts > 0 && (
              <Badge variant="destructive" className="text-xs">
                {staleCosts} Stale
              </Badge>
            )}
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
        {/* Summary Cards Row - HackerRank Style */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          {/* Raw Materials */}
          <div className="bg-background p-3 rounded border border-border">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Raw Materials</span>
            </div>
            <div className="text-lg font-mono font-semibold">
              {formatCurrency(breakdown.totalRawMaterialCost)}
            </div>
          </div>

          {/* Process Costs */}
          <div className="bg-background p-3 rounded border border-border">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Process Costs</span>
            </div>
            <div className="text-lg font-mono font-semibold">
              {formatCurrency(breakdown.totalProcessCost)}
            </div>
          </div>

          {/* Tooling Costs */}
          <div className="bg-background p-3 rounded border border-border">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Tooling Costs</span>
            </div>
            <div className="text-lg font-mono font-semibold">
              {formatCurrency(breakdown.totalToolingCost)}
            </div>
          </div>

          {/* Packaging & Logistics */}
          <div className="bg-background p-3 rounded border border-border">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Packaging & Logistics</span>
            </div>
            <div className="text-lg font-mono font-semibold">
              {formatCurrency(breakdown.totalPackagingLogisticsCost)}
            </div>
          </div>

          {/* Procured Parts */}
          <div className="bg-background p-3 rounded border border-border">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Procured Parts</span>
            </div>
            <div className="text-lg font-mono font-semibold">
              {formatCurrency(breakdown.totalProcuredPartsCost)}
            </div>
          </div>

          {/* Total Cost */}
          <div className="bg-background p-3 rounded border-2 border-foreground">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Total Cost</span>
            </div>
            <div className="text-lg font-mono font-bold">
              {formatCurrency(breakdown.overallTotalCost)}
            </div>
          </div>

          {/* Selling Price */}
          <div className="bg-background p-3 rounded border-2 border-foreground">
            <div className="mb-1">
              <span className="text-xs font-medium text-muted-foreground">Selling Price</span>
            </div>
            <div className="text-lg font-mono font-bold">
              {formatCurrency(breakdown.totalSellingPrice)}
            </div>
          </div>
        </div>

        {/* Cost Breakdown by Type */}
        <div>
          <h3 className="text-sm font-semibold mb-3">
            Cost Breakdown by Type
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="p-2 text-left text-xs font-semibold border-r border-border">Type</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Count</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Raw Materials</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Process</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Tooling</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Packaging & Logistics</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Procured Parts</th>
                  <th className="p-2 text-right text-xs font-semibold border-r border-border">Own Cost</th>
                  <th className="p-2 text-right text-xs font-semibold">Total Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {costByType.length > 0 ? (
                  costByType.map((type) => (
                    <tr key={type.itemType} className="hover:bg-muted/30">
                      <td className="p-2 text-sm border-r border-border">
                        <Badge variant="outline">
                          {type.itemType.replace('_', ' ').toUpperCase()}
                        </Badge>
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">{type.count}</td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(type.rawMaterialCost)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(type.processCost)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(type.toolingCost)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(type.packagingLogisticsCost)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(type.procuredPartsCost)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono border-r border-border">
                        {formatCurrency(type.ownCost)}
                      </td>
                      <td className="p-2 text-sm text-right font-mono font-semibold">
                        {formatCurrency(type.totalCost)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-muted-foreground">
                      No cost data available
                    </td>
                  </tr>
                )}
              </tbody>
              {costByType.length > 0 && (
                <tfoot>
                  <tr className="bg-muted font-bold border-t-2 border-foreground">
                    <td className="p-2 text-sm text-right border-r border-border" colSpan={2}>
                      Total:
                    </td>
                    <td className="p-2 text-sm text-right font-mono border-r border-border">
                      {formatCurrency(breakdown.totalRawMaterialCost)}
                    </td>
                    <td className="p-2 text-sm text-right font-mono border-r border-border">
                      {formatCurrency(breakdown.totalProcessCost)}
                    </td>
                    <td className="p-2 text-sm text-right font-mono border-r border-border">
                      {formatCurrency(breakdown.totalToolingCost)}
                    </td>
                    <td className="p-2 text-sm text-right font-mono border-r border-border">
                      {formatCurrency(breakdown.totalPackagingLogisticsCost)}
                    </td>
                    <td className="p-2 text-sm text-right font-mono border-r border-border">
                      {formatCurrency(breakdown.totalProcuredPartsCost)}
                    </td>
                    <td className="p-2 text-sm text-right font-mono border-r border-border">
                      {formatCurrency(
                        breakdown.totalRawMaterialCost +
                        breakdown.totalProcessCost +
                        breakdown.totalToolingCost +
                        breakdown.totalPackagingLogisticsCost +
                        breakdown.totalProcuredPartsCost
                      )}
                    </td>
                    <td className="p-2 text-sm text-right font-mono font-bold">
                      {formatCurrency(breakdown.overallTotalCost)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Margins Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border border-border rounded">
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">Average SGA</div>
            <div className="text-lg font-mono font-semibold">{formatPercentage(breakdown.averageSgaPercentage)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">Average Profit</div>
            <div className="text-lg font-mono font-semibold">{formatPercentage(breakdown.averageProfitPercentage)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">Total Margin</div>
            <div className="text-lg font-mono font-bold">
              {formatCurrency(breakdown.totalSellingPrice - breakdown.overallTotalCost)}
            </div>
          </div>
        </div>

        {/* Top-Level Assemblies */}
        {topLevelAssemblies.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3">
              Top-Level Assemblies
            </h3>
            <div className="space-y-2">
              {topLevelAssemblies.map((assembly) => (
                <div
                  key={assembly.id}
                  className="flex items-center justify-between p-3 border border-border rounded hover:bg-muted/30"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{assembly.itemType.replace('_', ' ')}</Badge>
                    <span className="font-medium text-sm">{assembly.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Cost</div>
                      <div className="font-mono font-semibold">{formatCurrency(assembly.totalCost)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Selling</div>
                      <div className="font-mono font-bold">
                        {formatCurrency(assembly.sellingPrice)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BomCostReport;
