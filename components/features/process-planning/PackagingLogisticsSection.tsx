'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { LogisticsDialog } from './LogisticsDialog';
import {
  usePackagingLogisticsCosts,
  useCreatePackagingLogisticsCost,
  useUpdatePackagingLogisticsCost,
  useDeletePackagingLogisticsCost,
  LogisticsType,
  CostBasis,
} from '@/lib/api/hooks/usePackagingLogisticsCosts';

interface PackagingLogisticsSectionProps {
  bomItemId: string;
}

export function PackagingLogisticsSection({ bomItemId }: PackagingLogisticsSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItemId, setEditItemId] = useState<string | null>(null);

  // Fetch data from database
  const { data, isLoading } = usePackagingLogisticsCosts({
    bomItemId,
    isActive: true,
    limit: 100,
  });

  // Mutations
  const createMutation = useCreatePackagingLogisticsCost();
  const updateMutation = useUpdatePackagingLogisticsCost();
  const deleteMutation = useDeletePackagingLogisticsCost();

  const logisticsItems = data?.items || [];
  const editItem = editItemId ? logisticsItems.find(item => item.id === editItemId) : null;

  const handleAddLogisticsItem = () => {
    setEditItemId(null);
    setDialogOpen(true);
  };

  const handleEditLogisticsItem = (id: string) => {
    setEditItemId(id);
    setDialogOpen(true);
  };

  const handleDialogSubmit = async (formData: any) => {
    try {
      if (editItemId) {
        // Update existing item
        await updateMutation.mutateAsync({
          id: editItemId,
          data: {
            costName: formData.costName,
            logisticsType: formData.logisticsType as LogisticsType,
            modeOfTransport: formData.modeOfTransport,
            calculatorName: formData.calculator,
            costBasis: formData.costBasis as CostBasis,
            parameters: formData.parameters ? { raw: formData.parameters } : {},
            unitCost: formData.unitCost,
            quantity: formData.quantity,
          },
        });
      } else {
        // Create new item
        await createMutation.mutateAsync({
          bomItemId,
          costName: formData.costName,
          logisticsType: formData.logisticsType as LogisticsType,
          modeOfTransport: formData.modeOfTransport,
          calculatorName: formData.calculator,
          costBasis: formData.costBasis as CostBasis,
          parameters: formData.parameters ? { raw: formData.parameters } : {},
          unitCost: formData.unitCost,
          quantity: formData.quantity,
        });
      }

      setDialogOpen(false);
      setEditItemId(null);
    } catch (error) {
    }
  };

  const handleDeleteLogisticsItem = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this logistics item?')) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const calculateTotal = () => {
    return logisticsItems.reduce((sum, item) => sum + item.totalCost, 0).toFixed(2);
  };

  // Convert logistics type enum to display text
  const formatLogisticsType = (type: LogisticsType) => {
    const typeMap: Record<LogisticsType, string> = {
      [LogisticsType.PACKAGING]: 'Packaging',
      [LogisticsType.INBOUND]: 'Inbound',
      [LogisticsType.OUTBOUND]: 'Outbound',
      [LogisticsType.STORAGE]: 'Storage',
    };
    return typeMap[type] || type;
  };

  // Convert cost basis enum to display text
  const formatCostBasis = (basis: CostBasis) => {
    const basisMap: Record<CostBasis, string> = {
      [CostBasis.PER_UNIT]: 'Per Unit',
      [CostBasis.PER_BATCH]: 'Per Batch',
      [CostBasis.PER_KG]: 'Per Kg',
      [CostBasis.PER_KM]: 'Per Km',
    };
    return basisMap[basis] || basis;
  };

  if (isLoading) {
    return (
      <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
        <div className="bg-primary py-3 px-4">
          <h6 className="m-0 font-semibold text-primary-foreground">Packaging & Logistics</h6>
        </div>
        <div className="bg-card p-4">
          <p className="text-center text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
      <div className="bg-primary py-3 px-4">
        <h6 className="m-0 font-semibold text-primary-foreground">Packaging & Logistics</h6>
      </div>
      <div className="bg-card p-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 min-w-[120px]">
                  Cost Name
                </th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 min-w-[120px]">
                  Logistics Type
                </th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 min-w-[120px]">
                  Mode of Transport
                </th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 min-w-[120px]">
                  Calculator
                </th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">
                  Cost Basis
                </th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">
                  Unit Cost (₹)
                </th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-24">
                  Quantity
                </th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-32">
                  Total Cost (₹)
                </th>
                <th className="p-3 text-center text-xs font-semibold w-24">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logisticsItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    <p className="text-sm">No packaging or logistics items added yet</p>
                    <p className="text-xs mt-1">Click "Add Logistics Item" to get started</p>
                  </td>
                </tr>
              ) : (
                <>
                  {logisticsItems.map((item) => (
                    <tr key={item.id} className="hover:bg-secondary/50">
                      <td className="p-3 border-r border-border text-xs font-medium">
                        {item.costName}
                      </td>
                      <td className="p-3 border-r border-border text-xs">
                        {formatLogisticsType(item.logisticsType)}
                      </td>
                      <td className="p-3 border-r border-border text-xs">
                        {item.modeOfTransport || '-'}
                      </td>
                      <td className="p-3 border-r border-border text-xs">
                        {item.calculatorName || '-'}
                      </td>
                      <td className="p-3 border-r border-border text-xs">
                        {formatCostBasis(item.costBasis)}
                      </td>
                      <td className="p-3 border-r border-border text-xs text-right">
                        ₹{item.unitCost.toFixed(2)}
                      </td>
                      <td className="p-3 border-r border-border text-xs text-right">
                        {item.quantity}
                      </td>
                      <td className="p-3 border-r border-border text-xs text-right font-semibold">
                        ₹{item.totalCost.toFixed(2)}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => handleEditLogisticsItem(item.id)}
                            title="Edit"
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteLogisticsItem(item.id)}
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  <tr className="bg-secondary/30 font-semibold">
                    <td colSpan={7} className="p-3 text-right border-r border-border text-xs">
                      Total:
                    </td>
                    <td className="p-3 border-r border-border text-xs text-right">
                      ₹{calculateTotal()}
                    </td>
                    <td className="p-3"></td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <Button
            onClick={handleAddLogisticsItem}
            variant="outline"
            size="sm"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Logistics Item
          </Button>
        </div>
      </div>

      <LogisticsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleDialogSubmit}
        editData={editItem}
      />
    </div>
  );
}
