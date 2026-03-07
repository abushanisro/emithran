'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Edit, Trash2, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ToolingCostDialog } from './ToolingCostDialog';
import {
  useToolingCosts,
  useCreateToolingCost,
  useUpdateToolingCost,
  useDeleteToolingCost,
} from '@/lib/api/hooks/useToolingCosts';

interface ToolingSectionProps {
  bomItemId?: string;
  bomItem?: any;
}

export function ToolingSection({ bomItemId, bomItem }: ToolingSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTooling, setEditTooling] = useState<any | null>(null);

  if (!bomItemId) {
    return (
      <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
        <div className="bg-primary py-3 px-4">
          <h6 className="m-0 font-semibold text-primary-foreground">Tooling & Fixtures</h6>
        </div>
        <div className="bg-card p-8 text-center text-muted-foreground">
          <p className="text-sm">Please select a BOM item to manage tooling & fixtures</p>
        </div>
      </div>
    );
  }

  // Fetch tooling costs from database
  const { data, isLoading, error } = useToolingCosts({
    bomItemId,
    enabled: !!bomItemId,
  });

  // Mutations
  const createMutation = useCreateToolingCost();
  const updateMutation = useUpdateToolingCost();
  const deleteMutation = useDeleteToolingCost();

  const tooling = data?.records || [];

  const handleAddTooling = () => {
    setEditTooling(null);
    setDialogOpen(true);
  };

  const handleEditTooling = (toolingItem: any) => {
    setEditTooling(toolingItem);
    setDialogOpen(true);
  };

  const handleDialogSubmit = async (data: any) => {
    if (!bomItemId) return;

    try {
      if (editTooling?.id) {
        // Update existing tooling
        await updateMutation.mutateAsync({
          id: editTooling.id,
          data: {
            toolingType: data.toolingType,
            description: data.description,
            specifications: data.specifications,
            unitCost: data.unitCost,
            quantity: data.quantity,
            amortizationParts: data.amortizationParts,
            usagePercentage: data.usagePercentage,
            isCustom: data.isCustom,
            supplier: data.supplier,
            leadTime: data.leadTime,
            notes: data.notes,
            isActive: true,
          },
        });
      } else {
        // Create new tooling
        await createMutation.mutateAsync({
          bomItemId,
          toolingType: data.toolingType,
          description: data.description,
          specifications: data.specifications,
          unitCost: data.unitCost,
          quantity: data.quantity,
          amortizationParts: data.amortizationParts,
          usagePercentage: data.usagePercentage,
          isCustom: data.isCustom,
          supplier: data.supplier,
          leadTime: data.leadTime,
          notes: data.notes,
          isActive: true,
        });
      }
      setDialogOpen(false);
    } catch (error) {
      // Error is handled by the mutations
    }
  };

  const handleDeleteTooling = async (toolingId: string) => {
    if (!bomItemId) return;
    
    if (confirm('Are you sure you want to delete this tooling item?')) {
      try {
        await deleteMutation.mutateAsync({ id: toolingId, bomItemId });
      } catch (error) {
        // Error is handled by the mutation
      }
    }
  };

  const calculateTotal = () => {
    return tooling.reduce((sum, item) => sum + (item.totalCost || 0), 0).toFixed(2);
  };

  return (
    <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
      <div className="bg-primary py-3 px-4">
        <h6 className="m-0 font-semibold text-primary-foreground">Tooling & Fixtures</h6>
      </div>
      <div className="bg-card p-4">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Loading tooling...</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-destructive">
            <p className="text-sm">Error loading tooling data. Please try again.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-primary text-primary-foreground">
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 min-w-[150px]">
                      Tooling
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">
                      Unit Cost (₹)
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">
                      Quantity
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-32">
                      Amortization
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-24">
                      Usage %
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
                  {tooling.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">
                        <p className="text-sm">No tooling items added yet</p>
                        <p className="text-xs mt-1">Click "Add Tooling Item" to get started</p>
                      </td>
                    </tr>
                  ) : (
                    <>
                      {tooling.map((item: any) => (
                        <tr key={item.id} className="hover:bg-secondary/50">
                          <td className="p-3 border-r border-border text-xs font-medium">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{item.toolingType?.replace('_', ' ') || 'Tooling'}</span>
                                {item.isCustom && (
                                  <Badge variant="secondary" className="text-xs">Custom</Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">{item.description}</p>
                              {item.specifications && (
                                <p className="text-xs text-muted-foreground">{item.specifications}</p>
                              )}
                            </div>
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right">
                            ₹{item.unitCost.toFixed(2)}
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right">
                            {item.quantity.toFixed(2)}
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right">
                            {item.amortizationParts ? `${item.amortizationParts.toLocaleString()} pcs` : '—'}
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right">
                            {item.usagePercentage}%
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
                                onClick={() => handleEditTooling(item)}
                                title="Edit"
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteTooling(item.id)}
                                title="Delete"
                                disabled={deleteMutation.isPending}
                              >
                                {deleteMutation.isPending ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
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
                onClick={handleAddTooling}
                variant="outline"
                size="sm"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3 mr-1" />
                    Add Tooling Item
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Tooling Dialog */}
      <ToolingCostDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleDialogSubmit}
        initialData={editTooling}
        bomItem={bomItem}
      />
    </div>
  );
}