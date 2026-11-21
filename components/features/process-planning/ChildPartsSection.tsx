'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Plus, Edit, Trash2 } from '@/components/ui/icons';
import {
  useChildPartCosts,
  useCreateChildPartCost,
  useUpdateChildPartCost,
  useDeleteChildPartCost,
} from '@/lib/api/hooks/useChildPartCost';
import { useAutoRecalculateCost } from '@/lib/hooks/useAutoRecalculateCost';

import { ChildPartDialog } from './ChildPartDialog';


interface ChildPart {
  id: string;
  estimateName: string;
  partNumber?: string;
  supplierLocation: string;
  makeBuy: 'make' | 'buy';
  unitCost?: number;
  freight?: number;
  duty?: number;
  overhead?: number;
  rawMaterialCost?: number;
  processCost?: number;
  quantity: number;
  scrap: number;
  defectRate?: number;
  moq?: number;
  totalCost: number;
  extendedCost: number;
  calculatedCost?: any;
}

interface ChildPartsSectionProps {
  bomItemId: string;
  bomId: string;
}

export function ChildPartsSection({ bomItemId, bomId }: ChildPartsSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editPart, setEditPart] = useState<ChildPart | null>(null);

  // API hooks
  const { data: childPartsData, refetch } = useChildPartCosts({ bomItemId });
  const createChildPartCost = useCreateChildPartCost();
  const updateChildPartCost = useUpdateChildPartCost();
  const deleteChildPartCost = useDeleteChildPartCost();

  // Auto-recalculate hook
  const { triggerRecalculation } = useAutoRecalculateCost({ bomId, bomItemId });

  // Transform API data to local format
  const childParts: ChildPart[] = (childPartsData?.childPartCosts || []).map((record: any) => ({
    id: record.id,
    estimateName: record.partName,
    partNumber: record.partNumber,
    supplierLocation: record.supplierLocation,
    makeBuy: record.makeBuy,
    unitCost: record.baseCost,
    freight: record.freightPercentage,
    duty: record.dutyPercentage,
    overhead: record.overheadPercentage,
    rawMaterialCost: record.rawMaterialCost,
    processCost: record.processCost,
    quantity: record.quantity,
    scrap: record.scrapPercentage,
    defectRate: record.defectRatePercentage,
    moq: record.moq,
    totalCost: record.totalCostPerPart,
    extendedCost: record.extendedCost,
    calculatedCost: record.calculationBreakdown,
  }));

  const handleAddChildPart = () => {
    setEditPart(null);
    setDialogOpen(true);
  };

  const handleEditChildPart = (part: ChildPart) => {
    setEditPart(part);
    setDialogOpen(true);
  };

  const handleDialogSubmit = async (data: any) => {
    try {
      if (data.id) {
        // Update existing part
        toast.loading('Updating child part...', { id: 'child-part-update' });
        await updateChildPartCost.mutateAsync({
          id: data.id,
          data: {
            bomItemId,
            partNumber: data.partNumber,
            partName: data.estimateName,
            makeBuy: data.makeBuy,
            unitCost: data.unitCost,
            freight: data.freight,
            duty: data.duty,
            overhead: data.overhead,
            rawMaterialCost: data.rawMaterialCost,
            processCost: data.processCost,
            quantity: data.quantity,
            scrap: data.scrap,
            defectRate: data.defectRate,
            moq: data.moq,
            supplierLocation: data.supplierLocation,
            currency: 'INR',
            isActive: true,
          },
        });
        toast.success('Child part updated successfully', { id: 'child-part-update' });
      } else {
        // Create new part
        toast.loading('Adding child part...', { id: 'child-part-create' });
        await createChildPartCost.mutateAsync({
          bomItemId,
          partNumber: data.partNumber,
          partName: data.estimateName,
          makeBuy: data.makeBuy,
          unitCost: data.unitCost,
          freight: data.freight,
          duty: data.duty,
          overhead: data.overhead,
          rawMaterialCost: data.rawMaterialCost,
          processCost: data.processCost,
          quantity: data.quantity,
          scrap: data.scrap,
          defectRate: data.defectRate,
          moq: data.moq,
          supplierLocation: data.supplierLocation,
          currency: 'INR',
          isActive: true,
        });
        toast.success('Child part added successfully', { id: 'child-part-create' });
      }

      // Refetch to show updated data
      refetch();

      // Auto-recalculate BOM costs
      await triggerRecalculation();

      setDialogOpen(false);
      setEditPart(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to save child part');
    }
  };

  const handleDeleteChildPart = async (id: string) => {
    if (!confirm('Are you sure you want to delete this child part?')) {
      return;
    }

    try {
      toast.loading('Deleting child part...', { id: 'child-part-delete' });
      await deleteChildPartCost.mutateAsync(id);
      toast.success('Child part deleted successfully', { id: 'child-part-delete' });
      refetch();

      // Auto-recalculate BOM costs
      await triggerRecalculation();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete child part');
    }
  };

  const calculateTotal = () => {
    return childParts.reduce((sum, p) => sum + p.extendedCost, 0).toFixed(2);
  };

  return (
    <div className="rounded-lg border bg-card shadow-xs mb-4 mt-4 overflow-hidden">
      <div className="border-b bg-muted/40 py-3 px-4">
        <h6 className="m-0 text-sm font-semibold text-foreground">Child Parts</h6>
      </div>
      <div className="bg-card p-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-muted/40 text-muted-foreground">
                <th className="p-3 text-left text-xs font-semibold">
                  Part Name
                </th>
                <th className="p-3 text-left text-xs font-semibold">
                  Make/Buy
                </th>
                <th className="p-3 text-left text-xs font-semibold">
                  Supplier
                </th>
                <th className="p-3 text-left text-xs font-semibold">
                  Qty
                </th>
                <th className="p-3 text-left text-xs font-semibold">
                  Unit Cost
                </th>
                <th className="p-3 text-left text-xs font-semibold">
                  Scrap %
                </th>
                <th className="p-3 text-left text-xs font-semibold">
                  Cost/Part
                </th>
                <th className="p-3 text-left text-xs font-semibold">
                  Extended Cost
                </th>
                <th className="p-3 text-center text-xs font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {childParts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-sm text-muted-foreground">
                    No child parts added yet. Click "Add Child Part" to get started.
                  </td>
                </tr>
              ) : (
                <>
                  {childParts.map((part) => (
                    <tr key={part.id} className="hover:bg-muted/40">
                      <td className="p-3 text-xs font-medium">
                        <div>{part.estimateName}</div>
                        {part.partNumber && (
                          <div className="text-muted-foreground text-xs">{part.partNumber}</div>
                        )}
                      </td>
                      <td className="p-3 text-xs">
                        <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${part.makeBuy === 'buy'
                            ? 'bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary'
                            : 'bg-success/10 text-success'
                          }`}>
                          {part.makeBuy === 'buy' ? 'Buy' : 'Make'}
                        </span>
                      </td>
                      <td className="p-3 text-xs">
                        {part.supplierLocation}
                      </td>
                      <td className="p-3 text-xs text-right">
                        {part.quantity}
                      </td>
                      <td className="p-3 text-xs text-right">
                        {part.makeBuy === 'buy'
                          ? `$${(part.unitCost || 0).toFixed(2)}`
                          : `$${((part.rawMaterialCost || 0) + (part.processCost || 0)).toFixed(2)}`
                        }
                      </td>
                      <td className="p-3 text-xs text-right">
                        {part.scrap}%
                      </td>
                      <td className="p-3 text-xs text-right font-semibold text-primary">
                        ${part.totalCost.toFixed(2)}
                      </td>
                      <td className="p-3 text-xs text-right font-semibold">
                        ${part.extendedCost.toFixed(2)}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => handleEditChildPart(part)}
                            title="Edit"
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteChildPart(part.id)}
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/40 font-semibold">
                    <td colSpan={7} className="p-3 text-right text-xs">
                      Total Extended Cost:
                    </td>
                    <td className="p-3 text-xs text-right">
                      ${calculateTotal()}
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
            onClick={handleAddChildPart}
            variant="outline"
            size="sm"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Child Part
          </Button>
        </div>
      </div>

      <ChildPartDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleDialogSubmit}
        editData={editPart}
      />
    </div>
  );
}
