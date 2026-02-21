'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  DollarSign, 
  TrendingUp, 
  Package, 
  Cog, 
  Target, 
  Calculator,
  FileDown,
  RefreshCw,
  Zap
} from 'lucide-react';
import { useCostData } from '@/lib/providers/cost-data-provider';
import { exportService } from '@/lib/services/export-service';

interface CostAnalysisEngineProps {
  bomId: string;
  bomName?: string;
  itemCount?: number;
}

const CustomPieChart = ({ data, colors }: { data: any[], colors: string[] }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let currentAngle = 0;
  
  return (
    <div className="relative w-48 h-48 mx-auto">
      <svg width="192" height="192" className="transform -rotate-90">
        {data.map((item, index) => {
          const percentage = item.value / total;
          const angle = percentage * 360;
          const startAngle = currentAngle;
          const endAngle = currentAngle + angle;
          
          const startX = 96 + 80 * Math.cos((startAngle - 90) * Math.PI / 180);
          const startY = 96 + 80 * Math.sin((startAngle - 90) * Math.PI / 180);
          const endX = 96 + 80 * Math.cos((endAngle - 90) * Math.PI / 180);
          const endY = 96 + 80 * Math.sin((endAngle - 90) * Math.PI / 180);
          
          const largeArcFlag = angle > 180 ? 1 : 0;
          
          const pathData = [
            `M 96 96`,
            `L ${startX} ${startY}`,
            `A 80 80 0 ${largeArcFlag} 1 ${endX} ${endY}`,
            'Z'
          ].join(' ');
          
          currentAngle += angle;
          
          return (
            <path
              key={index}
              d={pathData}
              fill={colors[index % colors.length]}
              className="hover:opacity-80 transition-opacity"
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-bold">₹{(total || 0).toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
      </div>
    </div>
  );
};

const CustomBarChart = ({ data, colors }: { data: any[], colors: string[] }) => {
  const maxValue = Math.max(...data.map(item => item.value));
  
  return (
    <div className="space-y-3">
      {data.map((item, index) => (
        <div key={index} className="flex items-center gap-3">
          <div className="w-24 text-xs font-medium truncate">{item.name}</div>
          <div className="flex-1 relative">
            <div className="bg-muted rounded-full h-6 relative overflow-hidden">
              <div 
                className="h-full rounded-full transition-all duration-300 flex items-center justify-end pr-2"
                style={{ 
                  width: `${(item.value / maxValue) * 100}%`,
                  backgroundColor: colors[index % colors.length]
                }}
              >
                <span className="text-xs font-medium text-white">
                  ₹{(item.value || 0).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
          <div className="w-16 text-xs text-right">
            {(((item.value || 0) / (maxValue || 1)) * 100).toFixed(1)}%
          </div>
        </div>
      ))}
    </div>
  );
};

export const CostAnalysisEngine: React.FC<CostAnalysisEngineProps> = ({ 
  bomId, 
  bomName = "Assembly",
  itemCount = 2 
}) => {
  const { calculateBomCosts, getCostData, getAggregatedData, isCalculating } = useCostData();
  const [isInitialized, setIsInitialized] = useState(false);
  
  const costData = getCostData(bomId);
  const aggregated = getAggregatedData(bomId);

  useEffect(() => {
    if (bomId && !costData && !isInitialized) {
      calculateBomCosts(bomId, itemCount);
      setIsInitialized(true);
    }
  }, [bomId, costData, isInitialized, calculateBomCosts, itemCount]);

  const handleRecalculate = () => {
    calculateBomCosts(bomId, itemCount);
  };

  const handleExport = async () => {
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
          costData
        );
        await exportService.exportCostAnalysis(exportData, format);
      }
    } catch (error) {
      console.error('Export failed:', error);
      }
  };

  const formatCurrency = (value: number | undefined | null) => 
    value !== undefined && value !== null ? `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '₹0.00';
  const formatPercentage = (value: number | undefined | null) => 
    value !== undefined && value !== null ? `${value.toFixed(1)}%` : '0.0%';

  if (isCalculating) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <RefreshCw className="w-12 h-12 mx-auto text-primary mb-4 animate-spin" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Calculating Costs...</h3>
              <p className="text-sm text-muted-foreground">
                Running cost analysis engine for {bomName}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!aggregated || !costData) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Calculator className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No Cost Data Available</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Click the button below to calculate comprehensive cost analysis
              </p>
              <Button onClick={handleRecalculate} className="mx-auto">
                <Zap className="w-4 h-4 mr-2" />
                Calculate Costs
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const chartData = [
    { name: 'Raw Materials', value: aggregated.totalRawMaterials },
    { name: 'Process Costs', value: aggregated.totalProcessCosts },
    { name: 'Packaging & Logistics', value: aggregated.totalPackagingLogistics },
    { name: 'Procured Parts', value: aggregated.totalProcuredParts }
  ];

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Cost Analysis Engine</h2>
          <p className="text-sm text-muted-foreground">AI-powered cost calculation for {bomName}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            Engine Active
          </Badge>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <FileDown className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card className="border-l-4 border-l-primary">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Total Cost</p>
                <p className="text-lg font-bold text-primary">{formatCurrency(aggregated.totalCost)}</p>
              </div>
              <DollarSign className="w-6 h-6 text-primary opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Selling Price</p>
                <p className="text-lg font-bold text-green-600">{formatCurrency(aggregated.totalSellingPrice)}</p>
              </div>
              <Target className="w-6 h-6 text-green-500 opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Raw Materials</p>
                <p className="text-sm font-semibold">{formatCurrency(aggregated.totalRawMaterials)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatPercentage((aggregated.totalRawMaterials / aggregated.totalCost) * 100)}
                </p>
              </div>
              <Package className="w-6 h-6 text-orange-500 opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Process Costs</p>
                <p className="text-sm font-semibold">{formatCurrency(aggregated.totalProcessCosts)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatPercentage((aggregated.totalProcessCosts / aggregated.totalCost) * 100)}
                </p>
              </div>
              <Cog className="w-6 h-6 text-blue-500 opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Total Margin</p>
                <p className="text-sm font-semibold">{formatCurrency(aggregated.totalMargin)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatPercentage((aggregated.totalMargin / aggregated.totalSellingPrice) * 100)}
                </p>
              </div>
              <TrendingUp className="w-6 h-6 text-purple-500 opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">SGA Average</p>
                <p className="text-sm font-semibold">{formatPercentage(aggregated.averageSgaPercentage)}</p>
                <p className="text-xs text-muted-foreground">{formatCurrency(aggregated.totalSgaCost)}</p>
              </div>
              <Calculator className="w-6 h-6 text-yellow-500 opacity-60" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Comprehensive Cost Analysis - All in One View */}
      <div className="space-y-6">
        {/* Cost Visualizations Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Cost Distribution Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Cost Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomPieChart 
                data={chartData}
                colors={['#f97316', '#3b82f6', '#eab308', '#ef4444']}
              />
              <div className="grid grid-cols-2 gap-3 mt-4">
                {chartData.map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded"
                      style={{ backgroundColor: ['#f97316', '#3b82f6', '#eab308', '#ef4444'][index] }}
                    ></div>
                    <span className="text-xs">
                      {item.name} ({formatPercentage((item.value / aggregated.totalCost) * 100)})
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Cost Category Breakdown Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Cost Category Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomBarChart
                data={chartData}
                colors={['#f97316', '#3b82f6', '#eab308', '#ef4444']}
              />
            </CardContent>
          </Card>
        </div>

        {/* Performance Metrics and Trends Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Performance Metrics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Performance Metrics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted p-3 rounded-lg">
                  <p className="text-xs font-medium text-muted-foreground">Average SGA</p>
                  <p className="text-lg font-bold">{formatPercentage(aggregated.averageSgaPercentage)}</p>
                </div>
                <div className="bg-muted p-3 rounded-lg">
                  <p className="text-xs font-medium text-muted-foreground">Average Profit</p>
                  <p className="text-lg font-bold text-green-600">{formatPercentage(aggregated.averageProfitPercentage)}</p>
                </div>
                <div className="bg-muted p-3 rounded-lg">
                  <p className="text-xs font-medium text-muted-foreground">Material %</p>
                  <p className="text-lg font-bold text-orange-600">
                    {formatPercentage((aggregated.totalRawMaterials / aggregated.totalCost) * 100)}
                  </p>
                </div>
                <div className="bg-muted p-3 rounded-lg">
                  <p className="text-xs font-medium text-muted-foreground">Processing %</p>
                  <p className="text-lg font-bold text-blue-600">
                    {formatPercentage((aggregated.totalProcessCosts / aggregated.totalCost) * 100)}
                  </p>
                </div>
              </div>

              {/* Cost Efficiency Indicators */}
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Material Efficiency</span>
                    <span>{formatPercentage((aggregated.totalRawMaterials / aggregated.totalCost) * 100)}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-orange-500 h-2 rounded-full" 
                      style={{ width: `${(aggregated.totalRawMaterials / aggregated.totalCost) * 100}%` }} 
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Process Efficiency</span>
                    <span>{formatPercentage((aggregated.totalProcessCosts / aggregated.totalCost) * 100)}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full" 
                      style={{ width: `${(aggregated.totalProcessCosts / aggregated.totalCost) * 100}%` }} 
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Detailed Breakdown Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Cost Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                  <span className="text-sm font-medium">Total Manufacturing Cost</span>
                  <span className="font-bold">{formatCurrency(aggregated.totalCost)}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                  <span className="text-sm font-medium">Total SGA Cost</span>
                  <span className="font-bold text-yellow-600">{formatCurrency(aggregated.totalSgaCost)}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                  <span className="text-sm font-medium">Total Profit</span>
                  <span className="font-bold text-green-600">{formatCurrency(aggregated.totalProfitAmount)}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-primary text-primary-foreground rounded-lg">
                  <span className="text-sm font-semibold">Total Selling Price</span>
                  <span className="text-lg font-bold">{formatCurrency(aggregated.totalSellingPrice)}</span>
                </div>
                <div className="text-center pt-2">
                  <p className="text-xs text-muted-foreground">
                    Calculated for {aggregated.itemCount} BOM items
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};