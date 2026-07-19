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
  compact?: boolean;
  currencySymbol?: string; // e.g. '₹', '$', '€' — default '$'
  conversionRate?: number; // multiply stored USD values by this to get factory currency — default 1
}

export function ProcuredPartsSection({ bomItemId, compact, currencySymbol = '$', conversionRate = 1 }: ProcuredPartsSectionProps) {
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

  const computePartCost = (p: any): number => {
    const unit     = Number(p.unitCost || 0);
    const qty      = Number(p.quantity || 1);
    const scrap    = Number(p.scrapPercentage || 0);
    const overhead = Number(p.overheadPercentage || 0);
    const base = unit * qty;
    return base * (1 + scrap / 100 + overhead / 100);
  };

  const calculateTotal = () => {
    return procuredParts.reduce((sum, p) => sum + computePartCost(p), 0).toFixed(2);
  };

  if (compact) {
    return (
      <div>
        <div className="divide-y divide-border">
          {isLoading ? (
            <div className="px-3 py-3 text-center text-xs text-muted-foreground">Loading…</div>
          ) : procuredParts.length === 0 ? (
            <div className="px-3 py-3 text-center">
              <p className="text-xs text-muted-foreground">No procured parts</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Add bought-in components with unit cost, quantity, and overhead</p>
            </div>
          ) : (
            <>
              {procuredParts.map((part) => (
                <div key={part.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{part.partName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      qty {part.quantity} · {currencySymbol}{(part.unitCost * conversionRate).toFixed(2)}/ea
                      {part.scrapPercentage ? ` · ${part.scrapPercentage}% scrap` : ''}
                      {part.overheadPercentage ? ` · ${part.overheadPercentage}% OH` : ''}
                    </p>
                  </div>
                  <span className="text-xs font-semibold tabular-nums shrink-0">{currencySymbol}{(computePartCost(part) * conversionRate).toFixed(4)}</span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleEditProcuredPart(part.id)} title="Edit">
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteProcuredPart(part.id)} title="Delete">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex justify-between items-center px-3 py-1.5 bg-muted/20">
                <span className="text-[11px] font-semibold text-muted-foreground">Total</span>
                <span className="text-xs font-bold tabular-nums">{currencySymbol}{(Number(calculateTotal()) * conversionRate).toFixed(2)}</span>
              </div>
            </>
          )}
        </div>
        <div className="px-3 pt-2 pb-1">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAddProcuredPart}>
            <Plus className="h-3 w-3 mr-1" /> Add Procured Part
          </Button>
        </div>
        <ProcuredPartDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={handleDialogSubmit}
          editData={editItem ? { ...editItem, part: editItem.partName, noOff: editItem.quantity } : null}
        />
      </div>
    );
  }

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
                  Unit Cost ($)
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
                  Total Cost ($)
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
                        {currencySymbol}{(part.unitCost * conversionRate).toFixed(2)}
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
                        {currencySymbol}{(computePartCost(part) * conversionRate).toFixed(2)}
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
                      {currencySymbol}{(Number(calculateTotal()) * conversionRate).toFixed(2)}
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
