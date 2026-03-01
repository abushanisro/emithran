'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Edit, Trash2, Loader2 } from 'lucide-react';
import { RawMaterialDialog } from './RawMaterialDialog';
import {
  useRawMaterialCosts,
  useCreateRawMaterialCost,
  useUpdateRawMaterialCost,
  useDeleteRawMaterialCost,
} from '@/lib/api/hooks/useRawMaterialCosts';

interface RawMaterialsSectionProps {
  bomItemId?: string;
  bomItem?: any;
}

export function RawMaterialsSection({ bomItemId, bomItem }: RawMaterialsSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMaterial, setEditMaterial] = useState<any | null>(null);

  // Fetch materials from database
  const { data, isLoading, error } = useRawMaterialCosts({
    bomItemId,
    isActive: true,
    enabled: !!bomItemId,
  });

  // Mutations
  const createMutation = useCreateRawMaterialCost();
  const updateMutation = useUpdateRawMaterialCost();
  const deleteMutation = useDeleteRawMaterialCost();

  const materials = data?.records || [];

  const handleAddMaterial = () => {
    setEditMaterial(null);
    setDialogOpen(true);
  };

  const handleEditMaterial = (material: any) => {
    setEditMaterial(material);
    setDialogOpen(true);
  };

  const handleDialogSubmit = async (data: any) => {
    if (!bomItemId) {
      return;
    }

    try {
      if (editMaterial?.id) {
        // Update existing material
        await updateMutation.mutateAsync({
          id: editMaterial.id,
          data: {
            materialId: data.materialId,
            materialName: data.materialName,
            materialGroup: data.materialGroup,
            materialGrade: data.materialGrade,
            location: data.location,
            quarter: data.quarter,
            unitCost: data.unitCost,
            grossUsage: data.grossUsage,
            netUsage: data.netUsage,
            scrap: data.scrap,
            overhead: data.overhead,
            notes: data.notes,
          },
        });
      } else {
        // Create new material
        await createMutation.mutateAsync({
          bomItemId,
          materialId: data.materialId,
          materialName: data.materialName,
          materialGroup: data.materialGroup,
          materialGrade: data.materialGrade,
          location: data.location,
          quarter: data.quarter,
          unitCost: data.unitCost,
          grossUsage: data.grossUsage,
          netUsage: data.netUsage,
          scrap: data.scrap,
          overhead: data.overhead,
          notes: data.notes,
          isActive: true,
        });
      }

      setDialogOpen(false);
      setEditMaterial(null);
    } catch (error) {
      console.error('Error saving material:', error);
    }
  };

  const handleDeleteMaterial = async (id: string) => {
    if (!bomItemId) return;

    if (confirm('Are you sure you want to delete this material?')) {
      try {
        await deleteMutation.mutateAsync({ id, bomItemId });
      } catch (error) {
        console.error('Error deleting material:', error);
      }
    }
  };

  const calculateTotal = () => {
    return materials.reduce((sum, m) => sum + (m.totalCost || 0), 0).toFixed(2);
  };

  // Show message if no BOM item selected
  if (!bomItemId) {
    return (
      <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
        <div className="bg-primary py-3 px-4">
          <h6 className="m-0 font-semibold text-primary-foreground">Raw Materials</h6>
        </div>
        <div className="bg-card p-8 text-center text-muted-foreground">
          <p className="text-sm">Please select a BOM item to manage raw materials</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
      <div className="bg-primary py-3 px-4">
        <h6 className="m-0 font-semibold text-primary-foreground">Raw Materials</h6>
      </div>
      <div className="bg-card p-4">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Loading materials...</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-destructive">
            <p className="text-sm">Error loading materials</p>
            <p className="text-xs mt-1">{error.message}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-primary text-primary-foreground">
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 min-w-[150px]">
                      Material
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">
                      Unit Cost (₹)
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">
                      Gross Usage
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">
                      Net Usage
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-24">
                      Scrap %
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">
                      Overhead %
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
                  {materials.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-muted-foreground">
                        <p className="text-sm">No raw materials added yet</p>
                        <p className="text-xs mt-1">Click "Add Material" to get started</p>
                      </td>
                    </tr>
                  ) : (
                    <>
                      {materials.map((material) => (
                        <tr key={material.id} className="hover:bg-secondary/50">
                          <td className="p-3 border-r border-border text-xs font-medium">
                            {material.materialName}
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right">
                            ₹{material.unitCost.toFixed(2)}
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right">
                            {material.grossUsage.toFixed(2)}
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right">
                            {material.netUsage.toFixed(2)}
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right">
                            {material.scrap}%
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right">
                            {material.overhead}%
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right font-semibold">
                            ₹{material.totalCost.toFixed(2)}
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => handleEditMaterial(material)}
                                title="Edit"
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteMaterial(material.id)}
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
                        <td colSpan={6} className="p-3 text-right border-r border-border text-xs">
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
                onClick={handleAddMaterial}
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
                    Add Material
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>

      <RawMaterialDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleDialogSubmit}
        editData={editMaterial}
        bomItemData={bomItem}
      />
    </div>
  );
}
