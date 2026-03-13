'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Edit, Trash2, Loader2, Target } from 'lucide-react';
import { ProcessCostDialog } from './ProcessCostDialog';
import ManufacturingAnalysisPanel from '@/components/features/bom/ManufacturingAnalysisPanel';
import {
  useProcessCosts,
  useCreateProcessCost,
  useUpdateProcessCost,
  useDeleteProcessCost,
} from '@/lib/api/hooks/useProcessCosts';

interface ManufacturingFeature {
  id: string;
  type: 'hole' | 'pocket' | 'slot' | 'boss' | 'rib' | 'thin_wall' | 'overhang' | 'undercut';
  position: { x: number; y: number; z: number };
  dimensions: { length?: number; width?: number; diameter?: number; depth?: number };
  manufacturingProcess: string;
  cycleTime: number;
  tooling: string[];
  warnings: string[];
  aiRecommendations: string[];
}

interface ManufacturingProcessSectionProps {
  bomItemId?: string;
  bomItem?: any;
  onFeatureSelect?: (feature: ManufacturingFeature | null) => void;
  onFeaturesUpdate?: (features: ManufacturingFeature[]) => void;
  selectedFeature?: ManufacturingFeature | null;
  manufacturingFeatures?: ManufacturingFeature[];
}

export function ManufacturingProcessSection({ 
  bomItemId, 
  bomItem, 
  onFeatureSelect,
  onFeaturesUpdate,
  selectedFeature,
  manufacturingFeatures
}: ManufacturingProcessSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProcess, setEditProcess] = useState<any | null>(null);
  const [showDFMAnalysis, setShowDFMAnalysis] = useState(false);
  const [selectedProcessForAnalysis, setSelectedProcessForAnalysis] = useState<string | null>(null);

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
    }
  };

  const handleDeleteProcess = async (id: string) => {
    if (!bomItemId) return;

    if (confirm('Are you sure you want to delete this process?')) {
      try {
        await deleteMutation.mutateAsync(id);
      } catch (error) {
      }
    }
  };

  const calculateTotal = () => {
    return processes.reduce((sum, p) => sum + (p.totalCostPerPart || 0), 0).toFixed(2);
  };

  const handleProcessAnalysis = (process: any) => {
    setSelectedProcessForAnalysis(process.processGroup || process.operation || 'Selected Process');
    setShowDFMAnalysis(true);
  };

  const toggleDFMAnalysis = () => {
    setShowDFMAnalysis(!showDFMAnalysis);
  };

  if (isLoading) {
    return (
      <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
        <div className="bg-primary py-3 px-4">
          <h6 className="m-0 font-semibold text-primary-foreground">Manufacturing Processes</h6>
        </div>
        <div className="bg-card p-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
          <p className="text-sm text-muted-foreground">Loading manufacturing processes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
        <div className="bg-primary py-3 px-4">
          <div className="flex items-center justify-between">
            <h6 className="m-0 font-semibold text-primary-foreground">Manufacturing Processes</h6>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleDFMAnalysis}
                className="text-primary-foreground hover:bg-primary-foreground/20"
              >
                <Target className="h-4 w-4 mr-1" />
                {showDFMAnalysis ? 'Hide' : 'Show'} DFM Analysis
              </Button>
            </div>
          </div>
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
                <th className="p-3 text-center text-xs font-semibold w-32">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {processes.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-muted-foreground">
                    <p className="text-sm">No manufacturing processes added yet</p>
                    <p className="text-xs mt-1">Click "Add Process" to get started</p>
                  </td>
                </tr>
              ) : (
                <>
                  {processes.map((process) => {
                    const isSelected = selectedProcessForAnalysis === (process.processGroup || process.operation || 'Selected Process');
                    
                    return (
                      <tr key={process.id} 
                          className={`hover:bg-secondary/50 transition-all duration-200 ${
                            isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                          }`}
                      >
                        <td className="p-3 border-r border-border text-xs">{process.opNbr || 0}</td>
                        <td className="p-3 border-r border-border text-xs">
                          <div className="space-y-0.5">
                            {process.processGroup && (
                              <div className={`font-semibold ${isSelected ? 'text-blue-700' : 'text-primary'}`}>
                                {process.processGroup}
                              </div>
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
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-7 w-7 p-0 ${isSelected ? 'bg-blue-100 text-blue-600 hover:bg-blue-200' : ''}`}
                              onClick={() => handleProcessAnalysis(process)}
                              title="Analyze DFM"
                            >
                              <Target className="h-3 w-3" />
                            </Button>
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
                    );
                  })}

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
      </div>

      {/* DFM Analysis Panel */}
      {showDFMAnalysis && (
        <ManufacturingAnalysisPanel 
          bomItemId={bomItemId || ''}
          bomItem={bomItemData}
          selectedProcess={selectedProcessForAnalysis}
          onFeatureSelect={onFeatureSelect}
          onFeaturesUpdate={onFeaturesUpdate}
          selectedFeature={selectedFeature}
          manufacturingFeatures={manufacturingFeatures}
        />
      )}

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
