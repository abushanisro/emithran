'use client';

import React, { useEffect } from 'react';
import { useBomCostSummary, BomItemCostSummary } from '@/lib/api/hooks/useBomItemCosts';
import { Badge } from '@/components/ui/badge';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RealTimeParentEstimatesProps {
  bomId: string;
  currentBomItemId?: string;
}

interface CostTreeNodeProps {
  item: BomItemCostSummary;
  depth: number;
  isCurrentItem?: boolean;
  currentBomItemId?: string;
}

const CostTreeNode: React.FC<CostTreeNodeProps> = ({ item, depth, isCurrentItem = false, currentBomItemId }) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const hasChildren = item.children && item.children.length > 0;

  // Check if item needs direct cost calculation (has children cost but no direct costs)
  const needsDirectCostCalculation = (
    item.directChildrenCost > 0 &&
    item.rawMaterialCost === 0 &&
    item.processCost === 0 &&
    item.packagingLogisticsCost === 0 &&
    item.procuredPartsCost === 0
  );

  // Check if item has no cost data at all
  const hasNoCostData = (
    item.totalCost === 0 &&
    item.directChildrenCost === 0
  );

  // Determine border color based on item type
  const getBorderColor = () => {
    switch (item.itemType) {
      case 'assembly':
        return 'border-l-emerald-500';
      case 'sub_assembly':
        return 'border-l-blue-500';
      case 'child_part':
        return 'border-l-amber-500';
      default:
        return 'border-l-gray-500';
    }
  };

  // Determine badge color
  const getBadgeClass = () => {
    switch (item.itemType) {
      case 'assembly':
        return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 hover:bg-emerald-500/20';
      case 'sub_assembly':
        return 'bg-blue-500/10 text-blue-700 border-blue-500/20 hover:bg-blue-500/20';
      case 'child_part':
        return 'bg-amber-500/10 text-amber-700 border-amber-500/20 hover:bg-amber-500/20';
      default:
        return 'bg-gray-500/10 text-gray-700 border-gray-500/20';
    }
  };

  const getTypeLabel = () => {
    switch (item.itemType) {
      case 'assembly':
        return 'Assembly';
      case 'sub_assembly':
        return 'Sub-Assembly';
      case 'child_part':
        return 'Child Part';
      default:
        return item.itemType;
    }
  };

  return (
    <div className={depth > 0 ? '' : 'mb-2'}>
      <div
        className={cn(
          'rounded-md border bg-card text-card-foreground shadow-sm border-l-4',
          getBorderColor(),
          isCurrentItem && 'ring-2 ring-primary'
        )}
      >
        <div className="p-4">
          <div className="flex flex-col md:flex-row items-start justify-between gap-3">
            <div className="flex-1 min-w-0 w-full">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {hasChildren && (
                  <button
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent hover:text-accent-foreground h-6 w-6 p-0 rounded-full border"
                    onClick={() => setIsExpanded(!isExpanded)}
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                <h3 className="text-base font-semibold text-foreground truncate max-w-[200px] md:max-w-none">
                  {item.name}
                </h3>
                <Badge className={cn('font-medium text-xs', getBadgeClass())}>
                  {getTypeLabel()}
                </Badge>
                {needsDirectCostCalculation && (
                  <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-700 border-orange-500/20">
                    Needs Direct Costs
                  </Badge>
                )}
                {hasNoCostData && (
                  <Badge variant="outline" className="text-xs bg-gray-500/10 text-gray-600 border-gray-500/20">
                    No Cost Data
                  </Badge>
                )}
              </div>

              {/* Cost Breakdown Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-1.5 text-xs">
                <div>
                  <span className="text-muted-foreground">Raw Material: </span>
                  <span className={cn(
                    "font-medium font-mono",
                    item.rawMaterialCost === 0 ? "text-muted-foreground" : "text-foreground"
                  )}>${item.rawMaterialCost.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Process: </span>
                  <span className={cn(
                    "font-medium font-mono",
                    item.processCost === 0 ? "text-muted-foreground" : "text-foreground"
                  )}>${item.processCost.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Packaging: </span>
                  <span className={cn(
                    "font-medium font-mono",
                    item.packagingLogisticsCost === 0 ? "text-muted-foreground" : "text-foreground"
                  )}>${item.packagingLogisticsCost.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Procured: </span>
                  <span className={cn(
                    "font-medium font-mono",
                    item.procuredPartsCost === 0 ? "text-muted-foreground" : "text-foreground"
                  )}>${item.procuredPartsCost.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Children: </span>
                  <span className={cn(
                    "font-medium font-mono",
                    item.directChildrenCost === 0 ? "text-muted-foreground" : "text-blue-600 font-semibold"
                  )}>${item.directChildrenCost.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Cost: </span>
                  <span className={cn(
                    "font-semibold font-mono text-sm",
                    item.totalCost > 0 ? "text-green-600" : "text-muted-foreground"
                  )}>${item.totalCost.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Children - Nested inside parent card */}
        {isExpanded && hasChildren && (
          <div className="px-4 pb-4 space-y-2">
            {item.children?.map((child) => (
              <CostTreeNode
                key={child.bomItemId}
                item={child}
                depth={depth + 1}
                isCurrentItem={child.bomItemId === currentBomItemId}
                currentBomItemId={currentBomItemId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const RealTimeParentEstimates: React.FC<RealTimeParentEstimatesProps> = ({
  bomId,
  currentBomItemId,
}) => {
  const { data: costSummary, isLoading, error, refetch } = useBomCostSummary(bomId);

  // Auto-refresh when currentBomItemId changes (indicates potential cost update)
  useEffect(() => {
    if (currentBomItemId) {
      refetch();
    }
  }, [currentBomItemId, refetch]);

  // Auto-refresh every 3 seconds to pick up cost changes
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 3000);

    return () => clearInterval(interval);
  }, [refetch]);

  const totalBomCost = costSummary?.reduce((sum, item) => sum + item.totalCost, 0) || 0;

  return (
    <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-primary py-3 px-4 flex items-center justify-between">
        <h6 className="m-0 font-semibold text-primary-foreground">
          Cost Hierarchy
        </h6>
        <div className="text-primary-foreground/90 text-sm font-mono">
          Total: ${totalBomCost.toFixed(2)}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            Loading cost data...
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-8 text-destructive">
            <span>Error loading costs: {error.message}</span>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {costSummary && costSummary.length > 0 ? (
              <div className="space-y-2">
                {costSummary.map((item) => (
                  <CostTreeNode
                    key={item.bomItemId}
                    item={item}
                    depth={0}
                    isCurrentItem={item.bomItemId === currentBomItemId}
                    currentBomItemId={currentBomItemId}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No cost data available yet</p>
                <p className="text-xs mt-1">
                  Add items to the BOM and calculate costs to see the hierarchy
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default RealTimeParentEstimates;
