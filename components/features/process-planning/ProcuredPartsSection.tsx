'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { ProcuredPartDialog } from './ProcuredPartDialog';
import {
  useProcuredPartsCosts,
  useCreateProcuredPartsCost,
  useUpdateProcuredPartsCost,
  useDeleteProcuredPartsCost,
} from '@/lib/api/hooks/useProcuredPartsCosts';

interface ProcuredPartsSectionProps {
  bomItemId: string;
}

export function ProcuredPartsSection({ bomItemId }: ProcuredPartsSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItemId, setEditItemId] = useState<string | null>(null);

  // Fetch data from database
  const { data, isLoading } = useProcuredPartsCosts({
    bomItemId,
    isActive: true,
    limit: 100,
  });

  // Mutations
  const createMutation = useCreateProcuredPartsCost();
  const updateMutation = useUpdateProcuredPartsCost();
  const deleteMutation = useDeleteProcuredPartsCost();

  const procuredParts = data?.items || [];
  const editItem = editItemId ? procuredParts.find(item => item.id === editItemId) : null;

  const handleAddProcuredPart = () => {
    setEditItemId(null);
    setDialogOpen(true);
  };

  const handleEditProcuredPart = (id: string) => {
    setEditItemId(id);
    setDialogOpen(true);
  };

  const handleDialogSubmit = async (formData: any) => {
    try {
      if (editItemId) {
        // Update existing part
        await updateMutation.mutateAsync({
          id: editItemId,
          data: {
            partName: formData.part,
            unitCost: formData.unitCost,
            quantity: formData.noOff,
            scrapPercentage: formData.scrapPercentage,
            overheadPercentage: formData.overheadPercentage,
          },
        });
      } else {
        // Create new part
        await createMutation.mutateAsync({
          bomItemId,
          partName: formData.part,
          unitCost: formData.unitCost,
          quantity: formData.noOff,
          scrapPercentage: formData.scrapPercentage,
          overheadPercentage: formData.overheadPercentage,
        });
      }

      setDialogOpen(false);
      setEditItemId(null);
    } catch (error) {
    }
  };

  const handleDeleteProcuredPart = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this procured part?')) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const calculateTotal = () => {
    return procuredParts.reduce((sum, p) => sum + p.totalCost, 0).toFixed(2);
  };

  if (isLoading) {
    return (
      <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
        <div className="bg-primary py-3 px-4">
          <h6 className="m-0 font-semibold text-primary-foreground">Procured Parts</h6>
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
        <h6 className="m-0 font-semibold text-primary-foreground">Procured Parts</h6>
      </div>
      <div className="bg-card p-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20">
                  Part
                </th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20">
                  Unit Cost (₹)
                </th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20">
                  Quantity
                </th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20">
                  Scrap %
                </th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20">
                  Overhead %
                </th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20">
                  Total Cost (₹)
                </th>
                <th className="p-3 text-center text-xs font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {procuredParts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    <p className="text-sm">No procured parts added yet</p>
                    <p className="text-xs mt-1">Click "Add Procured Part" to get started</p>
                  </td>
                </tr>
              ) : (
                <>
                  {procuredParts.map((part) => (
                    <tr key={part.id} className="hover:bg-secondary/50">
                      <td className="p-3 border-r border-border text-xs font-medium">
                        {part.partName}
                      </td>
                      <td className="p-3 border-r border-border text-xs text-right">
                        ₹{part.unitCost.toFixed(2)}
                      </td>
                      <td className="p-3 border-r border-border text-xs text-right">
                        {part.quantity}
                      </td>
                      <td className="p-3 border-r border-border text-xs text-right">
                        {part.scrapPercentage}%
                      </td>
                      <td className="p-3 border-r border-border text-xs text-right">
                        {part.overheadPercentage}%
                      </td>
                      <td className="p-3 border-r border-border text-xs text-right font-semibold">
                        ₹{part.totalCost.toFixed(2)}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => handleEditProcuredPart(part.id)}
                            title="Edit"
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteProcuredPart(part.id)}
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-secondary/30 font-semibold">
                    <td colSpan={5} className="p-3 text-right border-r border-border text-xs">
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
            onClick={handleAddProcuredPart}
            variant="outline"
            size="sm"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Procured Part
          </Button>
        </div>
      </div>

      <ProcuredPartDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleDialogSubmit}
        editData={editItem ? {
          ...editItem,
          part: editItem.partName,
          noOff: editItem.quantity,
        } : null}
      />
    </div>
  );
}
