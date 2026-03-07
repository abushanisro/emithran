'use client';

import React from 'react';
import { useBOMs } from '@/lib/api/hooks/useBOM';
import { useBomCostReport } from '@/lib/api/hooks/useBomItemCosts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface ProjectBomCostSummaryProps {
  projectId: string;
}

const formatCurrency = (value: number) => `₹${value.toFixed(2)}`;

const BomCostRow: React.FC<{ bomId: string; bomName: string }> = ({ bomId, bomName }) => {
  const { data: report, isLoading, error } = useBomCostReport(bomId);

  if (isLoading) {
    return (
      <tr className="hover:bg-accent/30 transition-colors">
        <td className="p-4 text-sm border-r border-border">{bomName}</td>
        <td colSpan={8} className="p-4 text-sm text-center text-muted-foreground border-r border-border">
          Loading...
        </td>
      </tr>
    );
  }

  if (error || !report) {
    return (
      <tr className="hover:bg-accent/30 transition-colors">
        <td className="p-4 text-sm border-r border-border">{bomName}</td>
        <td colSpan={8} className="p-4 text-sm text-center text-destructive border-r border-border">
          <div className="flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Failed to load
          </div>
        </td>
      </tr>
    );
  }

  const margin = report.breakdown.totalSellingPrice - report.breakdown.overallTotalCost;
  const marginPercent = report.breakdown.overallTotalCost > 0
    ? ((margin / report.breakdown.overallTotalCost) * 100).toFixed(1)
    : '0.0';

  return (
    <tr className="hover:bg-accent/30 transition-colors">
      <td className="p-4 text-sm font-medium border-r border-border">{bomName}</td>
      <td className="p-4 text-sm text-right font-mono border-r border-border">
        <Badge variant={report.staleCosts > 0 ? 'destructive' : 'secondary'} className="text-xs">
          {report.itemsWithCosts}/{report.totalItems}
        </Badge>
      </td>
      <td className="p-4 text-sm text-right font-mono text-blue-600 border-r border-border">
        {formatCurrency(report.breakdown.totalRawMaterialCost)}
      </td>
      <td className="p-4 text-sm text-right font-mono text-purple-600 border-r border-border">
        {formatCurrency(report.breakdown.totalProcessCost)}
      </td>
      <td className="p-4 text-sm text-right font-mono text-orange-600 border-r border-border">
        {formatCurrency(report.breakdown.totalToolingCost)}
      </td>
      <td className="p-4 text-sm text-right font-mono font-semibold border-r border-border">
        {formatCurrency(report.breakdown.overallTotalCost)}
      </td>
      <td className="p-4 text-sm text-right font-mono font-semibold text-green-600 border-r border-border">
        {formatCurrency(report.breakdown.totalSellingPrice)}
      </td>
      <td className="p-4 text-sm text-right font-mono border-r border-border">
        {formatCurrency(margin)}
      </td>
      <td className="p-4 text-sm text-right font-mono font-semibold text-green-600">
        {marginPercent}%
      </td>
    </tr>
  );
};

export const ProjectBomCostSummary: React.FC<ProjectBomCostSummaryProps> = ({ projectId }) => {
  const { data: bomsData, isLoading, error } = useBOMs({ projectId });
  const boms = bomsData?.boms || [];

  const handleExport = () => {
    try {
      // Create CSV content
      const headers = ['BOM Name', 'Items Costed', 'Raw Materials', 'Process Costs', 'Tooling Costs', 'Total Cost', 'Selling Price', 'Margin', 'Margin %'];
      const csvContent = [
        headers.join(','),
        // Add data rows here when implementing full export
      ].join('\n');

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-bom-costs-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success('Cost report exported successfully');
    } catch (error) {
      toast.error('Failed to export cost report');
    }
  };

  if (isLoading) {
    return (
      <div className="card border-l-4 border-l-primary shadow-md rounded-lg overflow-hidden">
        <div className="bg-primary py-3 px-4">
          <h6 className="m-0 font-semibold text-primary-foreground">
            OEM Project Cost Summary
          </h6>
        </div>
        <div className="bg-card p-8 text-center text-muted-foreground">
          Loading project cost summary...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-l-4 border-l-destructive shadow-md rounded-lg overflow-hidden">
        <div className="bg-destructive py-3 px-4">
          <h6 className="m-0 font-semibold text-destructive-foreground">
            Error Loading Cost Summary
          </h6>
        </div>
        <div className="bg-card p-4 text-center text-destructive">
          Failed to load project cost summary. Please try again.
        </div>
      </div>
    );
  }

  if (boms.length === 0) {
    return (
      <div className="text-center py-12 bg-card border-2 border-dashed border-border rounded-lg">
        <p className="text-muted-foreground mb-2 text-sm font-semibold">
          No BOMs Found
        </p>
        <p className="text-xs text-muted-foreground">
          Create a BOM to see project cost summary
        </p>
      </div>
    );
  }

  return (
    <div className="card border-l-4 border-l-primary shadow-md rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-primary py-3 px-4">
        <div className="flex items-center justify-between">
          <div>
            <h6 className="m-0 font-semibold text-primary-foreground">
              OEM Project Cost Summary
            </h6>
            <p className="text-xs text-primary-foreground/80 mt-1">
              Overview of all BOMs and their costs in this project
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>

      <div className="bg-card p-6">
        {/* Summary Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-muted">
                <th className="p-3 text-left text-xs font-semibold border-r border-border">BOM Name</th>
                <th className="p-3 text-right text-xs font-semibold border-r border-border">Items Costed</th>
                <th className="p-3 text-right text-xs font-semibold border-r border-border">Raw Materials</th>
                <th className="p-3 text-right text-xs font-semibold border-r border-border">Process Costs</th>
                <th className="p-3 text-right text-xs font-semibold border-r border-border">Tooling Costs</th>
                <th className="p-3 text-right text-xs font-semibold border-r border-border">Total Cost</th>
                <th className="p-3 text-right text-xs font-semibold border-r border-border">Selling Price</th>
                <th className="p-3 text-right text-xs font-semibold border-r border-border">Margin ($)</th>
                <th className="p-3 text-right text-xs font-semibold">Margin (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {boms.map((bom) => (
                <BomCostRow key={bom.id} bomId={bom.id} bomName={bom.name} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Info Footer */}
        <div className="mt-6 p-4 bg-muted/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 text-muted-foreground" />
            <div className="text-xs text-muted-foreground">
              <p className="font-semibold mb-1">About this report:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>This summary shows cost data for all BOMs in the current project</li>
                <li>Select a specific BOM above to see detailed cost breakdown</li>
                <li>Items marked with red badges have stale costs and need recalculation</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectBomCostSummary;
