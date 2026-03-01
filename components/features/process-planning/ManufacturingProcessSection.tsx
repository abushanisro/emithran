'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Edit, Trash2, Loader2 } from 'lucide-react';
import { ProcessCostDialog } from './ProcessCostDialog';
import {
  useProcessCosts,
  useCreateProcessCost,
  useUpdateProcessCost,
  useDeleteProcessCost,
} from '@/lib/api/hooks/useProcessCosts';

interface ManufacturingProcessSectionProps {
  bomItemId?: string;
  bomItem?: any;
}

export function ManufacturingProcessSection({ bomItemId, bomItem }: ManufacturingProcessSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProcess, setEditProcess] = useState<any | null>(null);

  // Use the bomItem prop directly instead of fetching
  const bomItemData = bomItem;

  // Fetch process costs from database
  const { data, isLoading } = useProcessCosts({
    bomItemId,
    isActive: true,
    enabled: !!bomItemId,
  });

  // Mutations
  const createMutation = useCreateProcessCost();
  const updateMutation = useUpdateProcessCost();
  const deleteMutation = useDeleteProcessCost();

  const processes = data?.records || [];

  const handleAddProcess = () => {
    setEditProcess(null);
    setDialogOpen(true);
  };

  const handleEditProcess = (process: any) => {
    setEditProcess(process);
    setDialogOpen(true);
  };

  const handleDialogSubmit = async (data: any) => {
    if (!bomItemId) {
      return;
    }

    try {
      if (editProcess?.id) {
        // Update existing process
        await updateMutation.mutateAsync({
          id: editProcess.id,
          data: {
            opNbr: data.opNbr,
            processGroup: data.group,
            processRoute: data.processRoute,
            operation: data.operation,
            directRate: data.directRate || 0,
            indirectRate: data.indirectRate || 0,
            fringeRate: data.fringeRate || 0,
            machineRate: data.machineRate || 0,
            machineValue: data.machineValue || 0,
            laborRate: data.laborRate || 0,
            shiftPatternHoursPerDay: data.shiftPatternHoursPerDay || 8,
            setupManning: data.setupManning,
            setupTime: data.setupTime,
            batchSize: data.batchSize,
            heads: data.heads,
            cycleTime: data.cycleTime,
            partsPerCycle: data.partsPerCycle,
            scrap: data.scrap,
            facilityId: data.facilityId,
            facilityRateId: data.facilityRateId,
            notes: data.notes,
          },
        });
      } else {
        // Create new process
        await createMutation.mutateAsync({
          bomItemId,
          opNbr: data.opNbr,
          processGroup: data.group,
          processRoute: data.processRoute,
          operation: data.operation,
          directRate: data.directRate || 0,
          indirectRate: data.indirectRate || 0,
          fringeRate: data.fringeRate || 0,
          machineRate: data.machineRate || 0,
          machineValue: data.machineValue || 0,
          laborRate: data.laborRate || 0,
          shiftPatternHoursPerDay: data.shiftPatternHoursPerDay || 8,
          setupManning: data.setupManning,
          setupTime: data.setupTime,
          batchSize: data.batchSize,
          heads: data.heads,
          cycleTime: data.cycleTime,
          partsPerCycle: data.partsPerCycle,
          scrap: data.scrap,
          facilityId: data.facilityId,
          facilityRateId: data.facilityRateId,
          isActive: true,
        });
      }

      setDialogOpen(false);
      setEditProcess(null);
    } catch (error) {
      console.error('Error saving process:', error);
    }
  };

  const handleDeleteProcess = async (id: string) => {
    if (!bomItemId) return;

    if (confirm('Are you sure you want to delete this process?')) {
      try {
        await deleteMutation.mutateAsync(id);
      } catch (error) {
        console.error('Error deleting process:', error);
      }
    }
  };

  const calculateTotal = () => {
    return processes.reduce((sum, p) => sum + (p.totalCostPerPart || 0), 0).toFixed(2);
  };

  if (isLoading) {
    return (
      <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
        <div className="bg-primary py-3 px-4">
          <h6 className="m-0 font-semibold text-primary-foreground">Process Costs</h6>
        </div>
        <div className="bg-card p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
          <p className="text-sm text-muted-foreground">Loading process costs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
      <div className="bg-primary py-3 px-4">
        <h6 className="m-0 font-semibold text-primary-foreground">Process Costs</h6>
      </div>
      <div className="bg-card p-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-16">Op#</th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20">Process</th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">Machine Rate</th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">Labor Rate</th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-24">Setup (min)</th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-20">Batch</th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-24">Cycle (s)</th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">Parts/Cycle</th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-20">Scrap %</th>
                <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-32">Total Cost (₹)</th>
                <th className="p-3 text-center text-xs font-semibold w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {processes.length === 0 ? (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-muted-foreground">
                    <p className="text-sm">No manufacturing processes added yet</p>
                    <p className="text-xs mt-1">Click "Add Process" to get started</p>
                  </td>
                </tr>
              ) : (
                <>
                  {processes.map((process) => (
                    <tr key={process.id} className="hover:bg-secondary/50">
                      <td className="p-3 border-r border-border text-xs">{process.opNbr || 0}</td>
                      <td className="p-3 border-r border-border text-xs">
                        <div className="space-y-0.5">
                          {process.processGroup && (
                            <div className="font-semibold text-primary">{process.processGroup}</div>
                          )}
                          {process.processRoute && (
                            <div className="text-muted-foreground">{process.processRoute}</div>
                          )}
                          {process.operation && (
                            <div className="text-xs">{process.operation}</div>
                          )}
                          {!process.processGroup && !process.processRoute && !process.operation && (
                            <span className="text-muted-foreground italic">Not specified</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 border-r border-border text-xs text-right">
                        ₹{(process.machineRate || 0).toFixed(2)}/hr
                      </td>
                      <td className="p-3 border-r border-border text-xs text-right">
                        ₹{(process.laborRate || 0).toFixed(2)}/hr
                      </td>
                      <td className="p-3 border-r border-border text-xs text-right">{process.setupTime || 0}</td>
                      <td className="p-3 border-r border-border text-xs text-right">{process.batchSize || 0}</td>
                      <td className="p-3 border-r border-border text-xs text-right">{process.cycleTime || 0}</td>
                      <td className="p-3 border-r border-border text-xs text-right">{process.partsPerCycle || 0}</td>
                      <td className="p-3 border-r border-border text-xs text-right">{process.scrap || 0}%</td>
                      <td className="p-3 border-r border-border text-xs text-right font-semibold">
                        ₹{(process.totalCostPerPart || 0).toFixed(2)}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => handleEditProcess(process)}
                            title="Edit"
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteProcess(process.id)}
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  <tr className="bg-secondary/30 font-semibold">
                    <td colSpan={9} className="p-3 text-right border-r border-border text-xs">
                      Total Process Cost:
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
          <Button variant="outline" size="sm" onClick={handleAddProcess}>
            <Plus className="h-3 w-3 mr-1" />
            Add Process
          </Button>
        </div>
      </div>

      <ProcessCostDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleDialogSubmit}
        editData={editProcess}
        bomItemData={bomItemData}
      />
    </div>
  );
}
