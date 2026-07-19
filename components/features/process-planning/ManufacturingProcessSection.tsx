'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';

import { Plus, Edit, Trash2, Loader2, Eye, Calculator, Database, FlaskConical, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ProcessCostDialog } from './ProcessCostDialog';
import { apiClient } from '@/lib/api/client';
import {
  useProcessCosts,
  useCreateProcessCost,
  useUpdateProcessCost,
  useDeleteProcessCost,
} from '@/lib/api/hooks/useProcessCosts';
import { featureMetaFromGroup } from '@/lib/utils/feature-colors';
import type { FeatureGroup } from '@/lib/utils/feature-colors';
import {
  useLatestDraftGeneration,
  useApplyGeneration,
} from '@/lib/api/hooks/useProcessPlanGenerate';

interface ManufacturingProcessSectionProps {
  bomItemId?: string;
  bomItem?: any;
  location?: string;
  compact?: boolean;
  currencySymbol?: string;
  conversionRate?: number;
  onFeatureHighlight?: (feature: any | null, group: FeatureGroup | null) => void;
  onFeatureFocus?: (feature: any | null, group: FeatureGroup | null) => void;
}

// ─── Breakdown helpers ────────────────────────────────────────────────────────

function BRow({ label, value, sub, highlight, icon }: {
  label: string; value: string; sub?: string; highlight?: boolean;
  icon?: 'db' | 'calc' | 'formula';
}) {
  const ico =
    icon === 'db'      ? <Database    className="h-2.5 w-2.5 text-blue-500 inline mr-1" /> :
    icon === 'calc'    ? <Calculator  className="h-2.5 w-2.5 text-violet-500 inline mr-1" /> :
    icon === 'formula' ? <FlaskConical className="h-2.5 w-2.5 text-amber-500 inline mr-1" /> : null;
  return (
    <div className={`flex items-start justify-between py-0.5 ${highlight ? 'font-semibold text-foreground border-t border-border mt-0.5 pt-1' : 'text-muted-foreground'}`}>
      <span className="text-[10px] leading-tight pr-2">
        {ico}{label}
        {sub && <span className="block text-[9px] font-mono text-muted-foreground/70 mt-0.5">{sub}</span>}
      </span>
      <span className={`text-[10px] tabular-nums font-mono whitespace-nowrap ${highlight ? 'text-primary' : ''}`}>{value}</span>
    </div>
  );
}

function Divider() { return <div className="border-t border-dashed border-border/60 my-1" />; }

function ProcessCostBreakdown({ p, sym = '$', rate = 1 }: { p: any; sym?: string; rate?: number }) {
  const machineRate   = Number(p.machineRate  || 0);
  const laborRate     = Number(p.laborRate    || 0);
  const setupMin      = Number(p.setupTime    || 0);
  const setupManning  = Number(p.setupManning || 1);
  const batch         = Math.max(Number(p.batchSize     || 1), 1);
  const cycleSec      = Number(p.cycleTime    || 0);
  const heads         = Math.max(Number(p.heads || 1), 1);
  const ppc           = Math.max(Number(p.partsPerCycle || 1), 1);
  const scrap         = Number(p.scrap        || 0);

  const setupHrs          = setupMin / 60;
  const combinedSetupRate = machineRate + laborRate * setupManning;
  const setupTotal        = setupHrs * combinedSetupRate;
  const setupPerPart      = setupTotal / batch;

  const cycleHrs          = cycleSec / 3600;
  const combinedCycleRate = machineRate + laborRate * heads;
  const cyclePerPart      = (cycleHrs * combinedCycleRate) / ppc;

  const subtotal = setupPerPart + cyclePerPart;
  const scrapAmt = subtotal * (scrap / 100);
  const total    = subtotal + scrapAmt;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Calculator path + inputs */}
      <div>
        {(p.processGroup || p.processRoute || p.operation) && (
          <>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1">
              <Calculator className="h-2.5 w-2.5" /> Calculator Assigned
            </p>
            {p.processGroup && <BRow label="Group"     value={p.processGroup} icon="calc" />}
            {p.processRoute && <BRow label="Route"     value={p.processRoute} icon="calc" />}
            {p.operation    && <BRow label="Operation" value={p.operation}    icon="calc" />}
            <Divider />
          </>
        )}
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Inputs</p>
        <BRow label={`Machine Rate (${sym}/hr)`} value={(machineRate * rate).toFixed(2)} icon="db" />
        <BRow label={`Labor Rate (${sym}/hr)`}   value={(laborRate * rate).toFixed(2)}   icon="db" />
        <BRow label="Setup Time (min)"     value={String(setupMin)} />
        <BRow label="Setup Manning"        value={String(setupManning)} />
        <BRow label="Batch Size"           value={String(batch)} />
        <BRow label="Cycle Time (secs)"    value={String(cycleSec)} />
        <BRow label="Heads"                value={String(heads)} />
        <BRow label="Parts/Cycle"          value={String(ppc)} />
        <BRow label="Scrap %"              value={String(scrap)} />
      </div>

      {/* Setup formula */}
      <div>
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Setup Cost / Part</p>
        <BRow label="Setup time"            value={`${setupMin} min = ${setupHrs.toFixed(4)} hr`} />
        <BRow label="Manning"               value={`${setupManning} operator(s)`} />
        <BRow
          label="Combined setup rate"
          value={`${sym}${(combinedSetupRate * rate).toFixed(2)}/hr`}
          sub={`${sym}${(machineRate * rate).toFixed(2)} + ${sym}${(laborRate * rate).toFixed(2)} × ${setupManning}`}
          icon="formula"
        />
        <BRow
          label="Setup cost (total)"
          value={`${sym}${(setupTotal * rate).toFixed(4)}`}
          sub={`${setupHrs.toFixed(4)} hr × ${sym}${(combinedSetupRate * rate).toFixed(2)}`}
          icon="formula"
        />
        <BRow
          label={`Amortised over batch (${batch} pcs)`}
          value={`${sym}${(setupPerPart * rate).toFixed(4)}/part`}
          sub={`${sym}${(setupTotal * rate).toFixed(4)} ÷ ${batch}`}
          icon="formula"
        />

        <Divider />
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Cycle Cost / Part</p>
        <BRow label="Cycle time"            value={`${cycleSec} s = ${cycleHrs.toFixed(6)} hr`} />
        <BRow label="Heads"                 value={`${heads} operator(s)`} />
        <BRow label="Parts per cycle"       value={String(ppc)} />
        <BRow
          label="Combined cycle rate"
          value={`${sym}${(combinedCycleRate * rate).toFixed(2)}/hr`}
          sub={`${sym}${(machineRate * rate).toFixed(2)} + ${sym}${(laborRate * rate).toFixed(2)} × ${heads}`}
          icon="formula"
        />
        <BRow
          label="Cycle cost / part"
          value={`${sym}${(cyclePerPart * rate).toFixed(4)}`}
          sub={`(${cycleHrs.toFixed(6)} × ${sym}${(combinedCycleRate * rate).toFixed(2)}) ÷ ${ppc}`}
          icon="formula"
        />
      </div>

      {/* Totals */}
      <div>
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Summary</p>
        <BRow
          label="Subtotal (setup + cycle)"
          value={`${sym}${(subtotal * rate).toFixed(4)}`}
          sub={`${sym}${(setupPerPart * rate).toFixed(4)} + ${sym}${(cyclePerPart * rate).toFixed(4)}`}
          icon="formula"
        />
        <BRow
          label={`Scrap allowance (${scrap}%)`}
          value={`${sym}${(scrapAmt * rate).toFixed(4)}`}
          icon="formula"
        />
        <BRow label="Total per part" value={`${sym}${(total * rate).toFixed(4)}`} highlight />
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ManufacturingProcessSection({
  bomItemId,
  bomItem,
  location,
  compact,
  currencySymbol = '$',
  conversionRate = 1,
  onFeatureHighlight,
  onFeatureFocus,
}: ManufacturingProcessSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProcess, setEditProcess] = useState<any | null>(null);
  const [openBreakdownId, setOpenBreakdownId] = useState<string | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const bomItemData = bomItem;
  const queryClient = useQueryClient();

  const { data, isLoading } = useProcessCosts({
    ...(bomItemId ? { bomItemId } : {}),
    isActive: true,
    enabled: !!bomItemId,
  });

  const createMutation = useCreateProcessCost();
  const updateMutation = useUpdateProcessCost();
  const deleteMutation = useDeleteProcessCost();

  // Regenerate from Manufacturing Intelligence — checks for existing draft_ready generation
  const { data: latestDraft } = useLatestDraftGeneration(bomItemId ?? null);
  const applyGeneration = useApplyGeneration();

  const processes = data?.records || [];

  const handleRegenerate = async () => {
    if (!bomItemId) return;
    if (latestDraft?.status !== 'draft_ready') {
      toast.info('No draft ready. Generate a process plan in the Manufacturing Intelligence tab first, then come back to apply it here.');
      return;
    }
    setIsRegenerating(true);
    try {
      await applyGeneration.mutateAsync({ generationId: latestDraft.id, body: {}, bomItemId });
      toast.success('Process plan regenerated from Manufacturing Intelligence.');
    } catch {
      // error toast is handled by useApplyGeneration
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleAddProcess = () => {
    const lastOpNbr = sortedProcesses.length > 0
      ? (sortedProcesses[sortedProcesses.length - 1]?.opNbr || 0)
      : 0;
    // No id → dialog stays in create mode; opNbr pre-fills as next in sequence
    setEditProcess({ opNbr: lastOpNbr + 10 });
    setDialogOpen(true);
  };

  const handleEditProcess = (process: any) => {
    setEditProcess(process);
    setDialogOpen(true);
  };

  const sortedProcesses = [...processes].sort((a, b) => (a.opNbr || 0) - (b.opNbr || 0));

  const handleDialogSubmit = async (data: any) => {
    if (!bomItemId) return;
    try {
      if (editProcess?.id) {
        await updateMutation.mutateAsync({
          id: editProcess.id,
          data: {
            opNbr: data.opNbr,
            processGroup: data.group,
            processRoute: data.processRoute,
            operation: data.operation,
            mhrId: data.mhrId || undefined,
            lhrId: data.lhrId || undefined,
            directRate: data.directRate || data.laborRate || 0,
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
        await createMutation.mutateAsync({
          bomItemId,
          opNbr: data.opNbr,
          processGroup: data.group,
          processRoute: data.processRoute,
          operation: data.operation,
          mhrId: data.mhrId || undefined,
          lhrId: data.lhrId || undefined,
          directRate: data.directRate || data.laborRate || 0,
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
      } catch (error) {}
    }
  };

  const handleDeleteAll = async () => {
    if (!bomItemId || sortedProcesses.length === 0) return;
    if (!confirm(`Delete all ${sortedProcesses.length} process record${sortedProcesses.length > 1 ? 's' : ''}? This cannot be undone.`)) return;

    setIsDeletingAll(true);
    try {
      await Promise.allSettled(
        sortedProcesses.map((p) => apiClient.delete(`/process-costs/${p.id}`)),
      );
      queryClient.invalidateQueries({ queryKey: ['process-costs'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['bom-item-costs'], exact: false });
      toast.success(`Deleted ${sortedProcesses.length} process record${sortedProcesses.length > 1 ? 's' : ''}`);
    } catch {
      toast.error('Some records could not be deleted. Please refresh and try again.');
    } finally {
      setIsDeletingAll(false);
    }
  };

  const computeProcCost = (p: any): number => {
    const machineRate  = Number(p.machineRate  || 0);
    const laborRate    = Number(p.laborRate    || 0);
    const setupMin     = Number(p.setupTime    || 0);
    const setupManning = Number(p.setupManning || 1);
    const batch        = Math.max(Number(p.batchSize     || 1), 1);
    const cycleSec     = Number(p.cycleTime    || 0);
    const heads        = Math.max(Number(p.heads || 1), 1);
    const ppc          = Math.max(Number(p.partsPerCycle || 1), 1);
    const scrap        = Number(p.scrap        || 0);
    const setupPerPart = ((setupMin / 60) * (machineRate + laborRate * setupManning)) / batch;
    const cyclePerPart = ((cycleSec / 3600) * (machineRate + laborRate * heads)) / ppc;
    const subtotal     = setupPerPart + cyclePerPart;
    return subtotal * (1 + scrap / 100);
  };

  const calculateTotal = () =>
    sortedProcesses.reduce((sum, p) => sum + computeProcCost(p), 0).toFixed(2);

  if (compact) {
    return (
      <div>
        <div className="divide-y divide-border">
          {sortedProcesses.length > 0 && (
            <>
              {sortedProcesses.map((proc) => {
                const cost = computeProcCost(proc);
                const isBreakdown = openBreakdownId === proc.id;
                const cycleMin = proc.cycleTime ? (Number(proc.cycleTime) / 60).toFixed(1) : null;
                return (
                  <React.Fragment key={proc.id}>
                    <div className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {proc.opNbr != null && (
                            <span className="text-[9px] tabular-nums text-muted-foreground/50 font-mono w-5 shrink-0">{proc.opNbr}</span>
                          )}
                          <p className="text-xs font-medium truncate">{proc.operation || proc.processGroup || 'Process'}</p>
                          {proc.timingSource && proc.timingSource !== 'default' && (
                            <span className={`text-[9px] px-1 rounded font-mono shrink-0 ${
                              proc.timingSource === 'feature_geometry' || proc.timingSource === 'machining_rules'
                                ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400'
                                : proc.timingSource === 'calculator'
                                ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            }`}>
                              {proc.timingSource === 'feature_geometry' ? 'CAD'
                               : proc.timingSource === 'machining_rules' ? 'Physics'
                               : proc.timingSource === 'calculator' ? 'Calc'
                               : proc.timingSource === 'ai_hint' ? 'AI' : 'Est'}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground tabular-nums pl-[26px]">
                          {[
                            proc.machineName || proc.processRoute || proc.processGroup,
                            cycleMin ? `${cycleMin} min` : null,
                            proc.batchSize ? `batch ${proc.batchSize}` : null,
                          ].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <span className="text-xs font-semibold tabular-nums shrink-0">{currencySymbol}{(cost * conversionRate).toFixed(4)}</span>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          title="Show breakdown"
                          onClick={() => setOpenBreakdownId(isBreakdown ? null : proc.id)}
                          className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${
                            isBreakdown ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                          }`}
                        >
                          <Eye className="h-3 w-3" />
                        </button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleEditProcess(proc)} title="Edit">
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteProcess(proc.id)} title="Delete">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {isBreakdown && (
                      <div className="px-3 py-2 bg-muted/10 border-b border-border">
                        <ProcessCostBreakdown p={proc} sym={currencySymbol} rate={conversionRate} />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
              <div className="flex justify-between items-center px-3 py-1.5 bg-muted/20">
                <span className="text-[11px] font-semibold text-muted-foreground">Total</span>
                <span className="text-xs font-bold tabular-nums">{currencySymbol}{(Number(calculateTotal()) * conversionRate).toFixed(2)}</span>
              </div>
            </>
          )}
        </div>
        <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 flex-wrap">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAddProcess}>
            <Plus className="h-3 w-3 mr-1" /> Add Process
          </Button>
          {latestDraft && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-primary/40 text-primary hover:bg-primary/10"
              onClick={handleRegenerate}
              disabled={isRegenerating}
            >
              {isRegenerating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Zap className="h-3 w-3 mr-1" />}
              {latestDraft.status === 'draft_ready' ? 'Apply MI Plan' : 'Regen'}
            </Button>
          )}
          {sortedProcesses.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive ml-auto"
              onClick={handleDeleteAll}
              disabled={isDeletingAll}
            >
              {isDeletingAll ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Trash2 className="h-3 w-3 mr-1" />}
              Clear
            </Button>
          )}
        </div>
        <ProcessCostDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={handleDialogSubmit}
          editData={editProcess}
          bomItemData={bomItemData}
          existingProcesses={processes}
          defaultLocation={location}
        />
      </div>
    );
  }

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

  const innerContent = (
    <div className="bg-card p-4">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-primary text-primary-foreground">
                  <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-16">Op#</th>
                  <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20">Process / Machine</th>
                  <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">Machine Rate</th>
                  <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">Labor Rate</th>
                  <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-24">Setup (min)</th>
                  <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-20">Batch</th>
                  <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">Cycle (s)</th>
                  <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">Parts/Cycle</th>
                  <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-20">Scrap %</th>
                  <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-36">Total Cost ({currencySymbol})</th>
                  <th className="p-3 text-center text-xs font-semibold border-r border-primary-foreground/20 w-24">Source</th>
                  <th className="p-3 text-center text-xs font-semibold w-28">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedProcesses.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="p-8 text-center text-muted-foreground">
                      <p className="text-sm">No manufacturing processes added yet</p>
                      <p className="text-xs mt-1">
                        {latestDraft?.status === 'draft_ready'
                          ? 'A process plan is ready — click "Regenerate from MI" to apply it.'
                          : 'Use "Add Process" to add manually, or generate a plan in Manufacturing Intelligence.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  <>
                    {sortedProcesses.map((process) => (
                      <React.Fragment key={process.id}>
                        <tr className="hover:bg-secondary/50">
                          <td className="p-3 border-r border-border text-xs">{process.opNbr || 0}</td>
                          <td className="p-3 border-r border-border text-xs">
                            <div className="flex items-start gap-1.5">
                              <div className="space-y-0.5 flex-1 min-w-0">
                                {process.processGroup && (
                                  <div className="font-semibold text-primary">{process.processGroup}</div>
                                )}
                                {process.processRoute && (
                                  <div className="text-muted-foreground">{process.processRoute}</div>
                                )}
                                {process.operation && (
                                  <div className="text-xs">{process.operation}</div>
                                )}
                                {/* Machine / Labour names from MI */}
                                {process.machineName && (
                                  <div className="text-[10px] text-muted-foreground/70 font-mono">{process.machineName}</div>
                                )}
                                {!process.processGroup && !process.processRoute && !process.operation && (
                                  <div className="text-muted-foreground italic text-xs">No process assigned</div>
                                )}
                              </div>
                              {process.featureGroup && (() => {
                                const meta = featureMetaFromGroup(process.featureGroup as FeatureGroup);
                                if (!meta) return null;
                                const syntheticFeat = process.featureType
                                  ? { type: process.featureType }
                                  : { type: process.featureGroup };
                                return (
                                  <button
                                    title={`View in 3D: ${meta.label}${process.featureType ? ` (${process.featureType})` : ''}`}
                                    className="shrink-0 h-5 w-5 flex items-center justify-center rounded hover:opacity-80 transition-opacity mt-0.5"
                                    style={{ color: meta.hexColor }}
                                    onMouseEnter={() => onFeatureHighlight?.(syntheticFeat, process.featureGroup as FeatureGroup)}
                                    onMouseLeave={() => onFeatureHighlight?.(null, null)}
                                    onClick={() => onFeatureFocus?.(syntheticFeat, process.featureGroup as FeatureGroup)}
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </button>
                                );
                              })()}
                            </div>
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right">
                            {currencySymbol}{((process.machineRate || 0) * conversionRate).toFixed(2)}/hr
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right">
                            {currencySymbol}{((process.laborRate || 0) * conversionRate).toFixed(2)}/hr
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right">{process.setupTime || 0}</td>
                          <td className="p-3 border-r border-border text-xs text-right">{process.batchSize || 0}</td>
                          <td className="p-3 border-r border-border text-xs text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              <span>{process.cycleTime || 0}</span>
                              {process.timingSource && process.timingSource !== 'default' && (
                                <span className={`text-[9px] px-1 rounded font-mono ${
                                  process.timingSource === 'feature_geometry' || process.timingSource === 'machining_rules' ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400' :
                                  process.timingSource === 'calculator' ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400' :
                                  'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                }`}>
                                  {process.timingSource === 'feature_geometry' ? 'CAD' :
                                   process.timingSource === 'machining_rules' ? 'Physics' :
                                   process.timingSource === 'calculator' ? 'Calc' :
                                   process.timingSource === 'ai_hint' ? 'AI' : 'Est'}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 border-r border-border text-xs text-right">{process.partsPerCycle || 0}</td>
                          <td className="p-3 border-r border-border text-xs text-right">{process.scrap || 0}%</td>
                          <td className="p-3 border-r border-border text-xs text-right font-semibold">
                            <div className="flex items-center justify-end gap-1.5">
                              <span>{currencySymbol}{(computeProcCost(process) * conversionRate).toFixed(2)}</span>
                              <button
                                title="Show calculation"
                                onClick={() => setOpenBreakdownId(openBreakdownId === process.id ? null : process.id)}
                                className={`rounded p-0.5 transition-colors ${
                                  openBreakdownId === process.id
                                    ? 'text-primary bg-primary/10'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                }`}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                          {/* Auto / Override status chip */}
                          <td className="p-3 border-r border-border text-center">
                            {process.isOverride ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                Override
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                                Auto
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1">
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

                        {/* Breakdown row */}
                        {openBreakdownId === process.id && (
                          <tr>
                            <td colSpan={12} className="px-4 py-3 bg-muted/20 border-b border-border">
                              <ProcessCostBreakdown p={process} sym={currencySymbol} rate={conversionRate} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}

                    <tr className="bg-secondary/30 font-semibold">
                      <td colSpan={9} className="p-3 text-right border-r border-border text-xs">
                        Total Process Cost:
                      </td>
                      <td className="p-3 border-r border-border text-xs text-right">
                        {currencySymbol}{(Number(calculateTotal()) * conversionRate).toFixed(2)}
                      </td>
                      <td className="p-3 border-r border-border"></td>
                      <td className="p-3"></td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleAddProcess}>
              <Plus className="h-3 w-3 mr-1" />
              Add Process
            </Button>
            {latestDraft && (
              <Button
                variant="outline"
                size="sm"
                className="border-primary/40 text-primary hover:bg-primary/10"
                onClick={handleRegenerate}
                disabled={isRegenerating}
              >
                {isRegenerating
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : <Zap className="h-3 w-3 mr-1" />}
                {latestDraft.status === 'draft_ready' ? 'Apply MI Plan' : 'Regenerate from MI'}
              </Button>
            )}
            {sortedProcesses.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                onClick={handleDeleteAll}
                disabled={isDeletingAll}
              >
                {isDeletingAll
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : <Trash2 className="h-3 w-3 mr-1" />}
                Delete All
              </Button>
            )}
          </div>
        </div>
  );

  return (
    <div className="space-y-4">
      <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
        <div className="bg-primary py-3 px-4">
          <h6 className="m-0 font-semibold text-primary-foreground">Manufacturing Processes</h6>
        </div>
        {innerContent}
      </div>

      <ProcessCostDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleDialogSubmit}
        editData={editProcess}
        bomItemData={bomItemData}
        existingProcesses={processes}
        defaultLocation={location}
      />
    </div>
  );
}
