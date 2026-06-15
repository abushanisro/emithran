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

// Manufacturing Process Hierarchy (simplified version)
const MANUFACTURING_PROCESSES = {
  machining: {
    label: 'Machining',
    subProcesses: ['turning', 'milling', 'drilling', 'grinding', 'boring', 'threading']
  },
  injection_molding: {
    label: 'Injection Molding',
    subProcesses: ['mold_making', 'injection', 'cooling', 'ejection']
  },
  sheet_metal: {
    label: 'Sheet Metal',
    subProcesses: ['cutting', 'bending', 'punching', 'stamping', 'welding', 'forming']
  },
  casting: {
    label: 'Casting',
    subProcesses: ['sand_casting', 'investment_casting', 'die_casting', 'permanent_mold', 'pattern_making']
  },
  forging: {
    label: 'Forging',
    subProcesses: ['hot_forging', 'cold_forging', 'upset_forging', 'drop_forging', 'press_forging']
  },
  assembly: {
    label: 'Assembly',
    subProcesses: ['mechanical_assembly', 'welded_assembly', 'fastened_assembly', 'bonded_assembly']
  },
  finishing: {
    label: 'Finishing',
    subProcesses: ['surface_treatment', 'painting', 'plating', 'heat_treatment']
  },
  inspection: {
    label: 'Quality Control & Inspection',
    subProcesses: ['dimensional_inspection', 'functional_testing', 'visual_inspection', 'material_testing']
  }
};

export function ToolingSection({ bomItemId, bomItem }: ToolingSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTooling, setEditTooling] = useState<any | null>(null);
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
  const [selectedSubProcess, setSelectedSubProcess] = useState<string | null>(null);

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


  const handleAddTooling = (processKey?: string, subProcessKey?: string) => {
    setEditTooling(null);
    setSelectedProcess(processKey || null);
    setSelectedSubProcess(subProcessKey || null);
    setDialogOpen(true);
  };

  const handleEditTooling = (toolingItem: any) => {
    setEditTooling(toolingItem);
    setSelectedProcess(null);
    setSelectedSubProcess(null);
    setDialogOpen(true);
  };

  const handleDialogSubmit = async (data: any) => {
    if (!bomItemId) return;

    try {
      const submitData = {
        manufacturingProcess: data.manufacturingProcess,
        subProcess: data.subProcess,
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
        totalCost: data.totalCost,
        totalToolingInvestment: data.totalToolingInvestment,
        isActive: true,
      };

      if (editTooling?.id) {
        // Update existing tooling
        await updateMutation.mutateAsync({
          id: editTooling.id,
          data: submitData,
        });
      } else {
        // Create new tooling
        await createMutation.mutateAsync({
          bomItemId,
          ...submitData,
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


  const computeToolCost = (item: any): number => {
    const unit  = Number(item.unitCost || 0);
    const qty   = Number(item.quantity || 1);
    const usage = Number(item.usagePercentage || 100);
    const amort = Math.max(Number(item.amortizationParts || 1), 1);
    const computed = (unit * qty * (usage / 100)) / amort;
    return item.totalCost || computed;
  };

  const calculateTotal = () => {
    return tooling.reduce((sum, item) => sum + computeToolCost(item), 0);
  };


  return (
    <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
      <div className="bg-primary py-3 px-4">
        <div className="flex items-center justify-between">
          <h6 className="m-0 font-semibold text-primary-foreground">
            Tooling & Fixtures
          </h6>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="bg-primary-foreground/20 text-primary-foreground">
              Total: ₹{calculateTotal().toFixed(2)}
            </Badge>
          </div>
        </div>
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
          <div className="space-y-4">
            {/* Table View Only */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-primary text-primary-foreground">
                        <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 min-w-[150px]">
                          Tooling
                        </th>
                        <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-32">
                          Process
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
                          <td colSpan={8} className="p-8 text-center text-muted-foreground">
                            <p className="text-sm">No tooling items added yet</p>
                            <p className="text-xs mt-1">Click "Add Tooling Item" to get started</p>
                          </td>
                        </tr>
                      ) : (
                        <>
                          {tooling.map((item: any) => {
                            const processData = item.manufacturingProcess ? MANUFACTURING_PROCESSES[item.manufacturingProcess as keyof typeof MANUFACTURING_PROCESSES] : null;
                            const subProcessLabel = item.subProcess ? item.subProcess.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) : '';
                            
                            // Check if this tool is recommended for the sub-process
                            const isRecommended = processData?.subProcesses?.some((sp: string) => sp === item.subProcess) && 
                              processData?.subProcesses?.includes(item.subProcess);
                            
                            return (
                              <tr key={item.id} className="hover:bg-secondary/50">
                                <td className="p-3 border-r border-border text-xs font-medium">
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">{item.toolingType?.replace('_', ' ') || 'Tooling'}</span>
                                      {item.isCustom && (
                                        <Badge variant="secondary" className="text-xs">Custom</Badge>
                                      )}
                                      {isRecommended && (
                                        <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                                          Recommended
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">{item.description}</p>
                                    {item.specifications && (
                                      <p className="text-xs text-muted-foreground">{item.specifications}</p>
                                    )}
                                  </div>
                                </td>
                                <td className="p-3 border-r border-border text-xs">
                                  <div>
                                    {processData ? (
                                      <div>
                                        <div className="font-medium text-xs">{processData.label}</div>
                                        {subProcessLabel && (
                                          <div className="text-xs text-muted-foreground">{subProcessLabel}</div>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-muted-foreground">Unassigned</span>
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
                                  ₹{computeToolCost(item).toFixed(2)}
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
                            );
                          })}

                          <tr className="bg-secondary/30 font-semibold">
                            <td colSpan={6} className="p-3 text-right border-r border-border text-xs">
                              Total:
                            </td>
                            <td className="p-3 border-r border-border text-xs text-right">
                              ₹{calculateTotal().toFixed(2)}
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
                    onClick={() => handleAddTooling()}
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
          </div>
        )}
      </div>

      {/* Tooling Dialog */}
      <ToolingCostDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleDialogSubmit}
        initialData={editTooling}
        bomItem={bomItem}
        selectedProcess={selectedProcess}
        selectedSubProcess={selectedSubProcess}
      />
    </div>
  );
}