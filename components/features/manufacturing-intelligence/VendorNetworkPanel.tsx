"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useVendorMatch, type RankedVendor, type RankedProcessGroup } from "@/lib/api/hooks/useVendors";
import { useCreateRfq } from "@/lib/api/hooks/useRfq";
import { useCreateSupplierNomination, supplierNominationKeys } from "@/lib/api/hooks/useSupplierNominations";
import { NominationType } from "@/lib/api/supplier-nominations";
import { createSupplierEvaluationGroup } from "@/lib/api/supplier-evaluation-groups";
import { type HeatmapLayerType } from "@/lib/heatmap/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface VendorNetworkPanelProps {
  projectId: string;
  itemId: string;
  itemName: string;
  batchSize?: number;
  processNames: string[];
  material?: string;
  hotspotContext?: { layer: HeatmapLayerType; riskLevel: string } | null;
}

// Layers that map to specific process categories for hotspot filtering
const LAYER_PROCESS_HINT: Partial<Record<HeatmapLayerType, string[]>> = {
  manufacturing_risk: ['Sheet Metal Fabrication', 'CNC Machining', 'Casting', 'Forging', 'Injection Moulding'],
  thermal:            ['Sheet Metal Fabrication', 'Injection Moulding', 'Heat Treatment'],
  tool_wear:          ['CNC Machining', 'Sheet Metal Fabrication', 'Injection Moulding'],
  cost_density:       ['Sheet Metal Fabrication', 'CNC Machining', 'Surface Treatment'],
  tolerance_risk:     ['CNC Machining', 'Quality'],
  sustainability:     ['Surface Treatment', 'Heat Treatment'],
  sink_mark:          ['Injection Moulding'],
};

function confidenceDots(score: number): { filled: number; label: string } {
  if (score >= 70) return { filled: 3, label: 'High confidence' };
  if (score >= 40) return { filled: 2, label: 'Medium confidence' };
  return { filled: 1, label: 'Low confidence' };
}

function classificationChip(cls: string) {
  const map: Record<string, { label: string; cls: string }> = {
    preferred:   { label: 'PREFERRED',   cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' },
    approved:    { label: 'APPROVED',    cls: 'bg-blue-500/20 text-blue-400 border-blue-500/40' },
    conditional: { label: 'CONDITIONAL', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/40' },
    restricted:  { label: 'RESTRICTED',  cls: 'bg-red-500/20 text-red-400 border-red-500/40' },
    unrated:     { label: 'UNRATED',     cls: 'bg-slate-500/20 text-slate-400 border-slate-500/40' },
  };
  const entry = map[cls.toLowerCase()] ?? map['unrated']!;
  return (
    <span className={cn('text-[8px] font-bold px-1 py-0.5 rounded border tracking-wide', entry.cls)}>
      {entry.label}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#eab308' : '#f97316';
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="flex-1 h-1 rounded-full bg-slate-700 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color }}>{score}</span>
    </div>
  );
}

function RatingTrio({ q, d, c }: { q: number | null; d: number | null; c: number | null }) {
  const fmt = (v: number | null) => v != null ? v.toFixed(1) : '—';
  return (
    <span className="text-[9px] text-slate-400 tabular-nums font-mono">
      Q:{fmt(q)} D:{fmt(d)} C:{fmt(c)}
    </span>
  );
}

function VendorCard({
  vendor,
  selected,
  onToggle,
  totalCategories,
}: {
  vendor: RankedVendor;
  selected: boolean;
  onToggle: (id: string) => void;
  totalCategories: number;
}) {
  const dots = confidenceDots(vendor.confidenceScore);

  return (
    <div className={cn(
      'rounded border p-2 mb-1.5 text-[10px] transition-colors',
      selected ? 'border-violet-500/60 bg-violet-900/20' : 'border-slate-700/60 bg-slate-900/40',
    )}>
      {/* Row 1: name + code + classification */}
      <div className="flex items-center gap-1.5 mb-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(vendor.id)}
          className="accent-violet-500 shrink-0"
        />
        <span className="font-semibold text-slate-200 truncate flex-1 text-[10px]">{vendor.name}</span>
        {vendor.supplierCode && (
          <span className="text-[8px] text-slate-500 bg-slate-800 rounded px-1 shrink-0">{vendor.supplierCode}</span>
        )}
        {classificationChip(vendor.classification)}
      </div>

      {/* Row 2: score bar + confidence dots + coverage */}
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-1 min-w-0">
          <ScoreBar score={vendor.overallScore} />
        </div>
        <div className="flex items-center gap-0.5 shrink-0" title={`${dots.label} (${vendor.confidenceScore}%)`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={cn('text-[8px]', i < dots.filled ? 'text-violet-400' : 'text-slate-600')}>●</span>
          ))}
        </div>
        {totalCategories > 1 && (
          <span
            className={cn(
              'text-[7px] font-bold px-1 rounded shrink-0',
              vendor.coveredCategoriesCount >= totalCategories
                ? 'bg-emerald-500/20 text-emerald-400'
                : vendor.coveredCategoriesCount > 1
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-slate-700/60 text-slate-500',
            )}
            title={`Covers ${vendor.coveredCategoriesCount} of ${totalCategories} operation types`}
          >
            {vendor.coveredCategoriesCount}/{totalCategories} ops
          </span>
        )}
      </div>

      {/* Row 3: why best bullets */}
      {vendor.whyBest.length > 0 && (
        <div className="flex flex-col gap-0.5 mb-1">
          {vendor.whyBest.slice(0, 3).map((why, i) => (
            <span key={i} className="text-[9px] text-slate-400">✓ {why}</span>
          ))}
        </div>
      )}

      {/* Row 4: ratings + location + view link */}
      <div className="flex items-center justify-between gap-1">
        <RatingTrio q={vendor.qualityRating} d={vendor.deliveryRating} c={vendor.costRating} />
        {(vendor.city || vendor.country) && (
          <span className="text-[9px] text-slate-500 truncate mx-1">{vendor.city || vendor.country}</span>
        )}
        <a
          href={`/vendors/${vendor.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[9px] text-violet-400 hover:text-violet-300 shrink-0"
        >
          ↗ View
        </a>
      </div>
    </div>
  );
}

function ProcessGroup({
  group,
  selectedIds,
  onToggle,
  hotspotCategories,
  totalCategories,
}: {
  group: RankedProcessGroup;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  hotspotCategories: string[] | null;
  totalCategories: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const highlighted = hotspotCategories?.includes(group.categoryLabel);
  const visible = showAll ? group.vendors : group.vendors.slice(0, 4);

  return (
    <div className={cn('mb-3', highlighted && 'ring-1 ring-amber-500/30 rounded-md p-1.5 -mx-1')}>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {highlighted && <span className="text-[8px] text-amber-400 font-semibold shrink-0">● hotspot</span>}
          <span className="text-[10px] font-semibold text-slate-200 shrink-0">{group.categoryLabel}</span>
          <span className="text-[9px] text-slate-500 tabular-nums shrink-0">{group.totalFound} vendors</span>
        </div>
      </div>
      {/* Show all merged operation names */}
      {group.mergedProcessNames.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {group.mergedProcessNames.map((op) => (
            <span key={op} className="text-[8px] bg-slate-800 text-slate-400 border border-slate-700/60 rounded px-1 py-0.5">
              {op}
            </span>
          ))}
        </div>
      )}

      {group.vendors.length === 0 ? (
        <div className="text-[9px] text-slate-500 italic py-1">
          No vendors in your network handle this process.{' '}
          <a href="/vendors" className="text-violet-400 hover:underline">Import vendors →</a>
        </div>
      ) : (
        <>
          {visible.map((v) => (
            <VendorCard
              key={v.id}
              vendor={v}
              selected={selectedIds.has(v.id)}
              onToggle={onToggle}
              totalCategories={totalCategories}
            />
          ))}
          {group.vendors.length > 4 && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="text-[9px] text-violet-400 hover:text-violet-300 py-0.5"
            >
              Show all {group.vendors.length} vendors →
            </button>
          )}
        </>
      )}
    </div>
  );
}

function SkeletonGroup() {
  return (
    <div className="mb-3 animate-pulse">
      <div className="h-3 w-32 bg-slate-700 rounded mb-2" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded border border-slate-700/60 p-2 mb-1.5 space-y-1.5">
          <div className="h-2.5 w-3/4 bg-slate-700 rounded" />
          <div className="h-1.5 w-full bg-slate-800 rounded" />
          <div className="h-2 w-1/2 bg-slate-800 rounded" />
        </div>
      ))}
    </div>
  );
}

function buildRfqEmailBody(itemName: string, processNames: string[], material?: string, batchSize?: number): string {
  const lines = [
    `Dear Supplier,`,
    ``,
    `We request a quotation for the following part:`,
    ``,
    `  Part Name:  ${itemName}`,
    material ? `  Material:   ${material}` : null,
    `  Processes:  ${processNames.join(', ')}`,
    batchSize ? `  Quantity:   ${batchSize} pcs` : null,
    ``,
    `Please confirm:`,
    `  - Unit price at the above quantity`,
    `  - Tooling/setup cost (if applicable)`,
    `  - Lead time (calendar days from PO)`,
    `  - Payment terms`,
    `  - Validity period of this quote`,
    ``,
    `Response needed within 14 days.`,
    ``,
    `Regards,`,
    `Mithran Procurement`,
  ].filter((l): l is string => l !== null);
  return lines.join('\n');
}

export function VendorNetworkPanel({
  projectId,
  itemId,
  itemName,
  batchSize,
  processNames,
  material,
  hotspotContext,
}: VendorNetworkPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [nominationName, setNominationName] = useState('');
  const [rfqDeadline, setRfqDeadline] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });

  const { data: groups, isLoading, error } = useVendorMatch(processNames, material);
  const createRfq = useCreateRfq();
  const createNomination = useCreateSupplierNomination();
  const createEvaluationGroup = useMutation({
    mutationFn: createSupplierEvaluationGroup,
  });

  const hotspotCategories = hotspotContext
    ? (LAYER_PROCESS_HINT[hotspotContext.layer] ?? null)
    : null;

  const isSending = createEvaluationGroup.isPending || createNomination.isPending || createRfq.isPending;

  const toggleVendor = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openConfirm = () => {
    setNominationName(`Nomination – ${itemName} – ${new Date().toISOString().slice(0, 10)}`);
    setConfirmOpen(true);
  };

  const handleConfirmSend = async () => {
    setConfirmOpen(false);
    const vendorIds = [...selectedIds];
    const today = new Date().toISOString().slice(0, 10);
    let step: 'evaluation' | 'nomination' | 'rfq' = 'evaluation';
    try {
      // Step 1: create evaluation group — gives vendors a workspace to manage the RFQ
      const evalGroup = await createEvaluationGroup.mutateAsync({
        projectId,
        name: `${itemName} – Evaluation – ${today}`,
        description: nominationName,
        bomItems: [{
          id: itemId,
          name: itemName,
          quantity: batchSize || 1,
          ...(material ? { material } : {}),
        }],
        processes: [], // user adds processes from the evaluation group page
      });
      step = 'nomination';

      // Step 2: create nomination linked to the evaluation group
      await createNomination.mutateAsync({
        nominationName,
        nominationType: NominationType.MANUFACTURER,
        projectId,
        evaluationGroupId: evalGroup.id,
        vendorIds,
        bomParts: [{
          bomItemId: itemId,
          bomItemName: itemName,
          quantity: batchSize || 1,
          ...(material ? { material } : {}),
          vendorIds,
        }],
      });
      step = 'rfq';

      // Step 3: create RFQ
      await createRfq.mutateAsync({
        rfqName: `RFQ – ${itemName} – ${today}`,
        projectId,
        bomItemIds: [itemId],
        vendorIds,
        selectionType: 'competitive',
        quoteDeadline: new Date(rfqDeadline),
        emailBody: buildRfqEmailBody(itemName, processNames, material, batchSize),
      });

      // Force-refresh both lists so data is ready when user navigates
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: supplierNominationKeys.list(projectId),
          refetchType: 'all',
        }),
        queryClient.invalidateQueries({
          queryKey: ['supplier-evaluation-groups', 'project', projectId],
          refetchType: 'all',
        }),
      ]);

      toast.success(`Evaluation group + nomination + RFQ sent to ${vendorIds.length} vendor${vendorIds.length !== 1 ? 's' : ''}`, {
        action: {
          label: 'View Evaluation',
          onClick: () => router.push(`/projects/${projectId}/supplier-evaluation`),
        },
      });
      setSelectedIds(new Set());
    } catch (err: any) {
      const descriptions: Record<typeof step, string> = {
        evaluation: 'Could not create the evaluation group. No nomination or RFQ was sent.',
        nomination: 'Evaluation group was created but the nomination failed. No RFQ was sent.',
        rfq: 'Evaluation group and nomination were created but the RFQ could not be sent.',
      };
      toast.error(`${step.charAt(0).toUpperCase() + step.slice(1)} creation failed`, {
        description: err?.message ?? descriptions[step],
        action: step !== 'evaluation' ? {
          label: 'View Evaluation',
          onClick: () => router.push(`/projects/${projectId}/supplier-evaluation`),
        } : undefined,
      });
    }
  };

  // Show all unique process names as chips at the top
  const processChips = useMemo(() => [...new Set(processNames)], [processNames]);

  if (processNames.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground p-4">
        <p className="text-[10px] text-center text-slate-400">
          Generate a process route first — vendor matching uses the route operations to find qualified suppliers.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* Hotspot banner */}
      {hotspotContext && (
        <div className="mx-2 mt-2 mb-1 rounded border border-amber-500/40 bg-amber-900/20 px-2 py-1 text-[9px] text-amber-300 flex items-center justify-between">
          <span>
            Vendors relevant to{' '}
            <span className="font-semibold capitalize">{hotspotContext.layer.replace(/_/g, ' ')}</span>{' '}
            {hotspotContext.riskLevel} risk are highlighted
          </span>
        </div>
      )}

      {/* Process chips */}
      <div className="flex flex-wrap gap-1 px-2 pt-2 pb-1.5">
        {processChips.map((p) => (
          <span key={p} className="text-[8px] bg-slate-800 text-slate-300 border border-slate-700 rounded px-1.5 py-0.5">
            {p}
          </span>
        ))}
        {material && (
          <span className="text-[8px] bg-violet-900/30 text-violet-300 border border-violet-700/40 rounded px-1.5 py-0.5">
            {material}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-20">
        {isLoading && (
          <>
            <SkeletonGroup />
            <SkeletonGroup />
          </>
        )}

        {error && (
          <div className="text-[10px] text-red-400 p-2">
            Unable to load vendor suggestions. Please try again.
          </div>
        )}

        {groups && groups.length === 0 && (
          <div className="text-[10px] text-slate-400 p-2 text-center">
            No vendors found for these processes.{' '}
            <a href="/vendors" className="text-violet-400 hover:underline">Import vendors →</a>
          </div>
        )}

        {groups?.map((group) => (
          <ProcessGroup
            key={group.categoryLabel}
            group={group}
            selectedIds={selectedIds}
            onToggle={toggleVendor}
            hotspotCategories={hotspotCategories}
            totalCategories={groups.length}
          />
        ))}
      </div>

      {/* Sticky RFQ footer */}
      <div className="shrink-0 border-t border-slate-700/60 bg-background px-2 py-2">
        <div className="text-[9px] text-slate-500 mb-1.5">
          {itemName} · {material ?? 'material TBD'} · {processChips.length} operation{processChips.length !== 1 ? 's' : ''}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 flex-1">
            {selectedIds.size > 0
              ? `${selectedIds.size} vendor${selectedIds.size > 1 ? 's' : ''} selected`
              : 'Select vendors to RFQ'}
          </span>
          <button
            onClick={openConfirm}
            disabled={selectedIds.size === 0 || isSending}
            className={cn(
              'text-[10px] font-medium px-3 py-1 rounded transition-colors',
              selectedIds.size > 0 && !isSending
                ? 'bg-violet-600 hover:bg-violet-700 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed',
            )}
          >
            {isSending ? 'Sending…' : `Send RFQ (${selectedIds.size})`}
          </button>
        </div>
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Send RFQ to {selectedIds.size} vendor{selectedIds.size !== 1 ? 's' : ''}
            </DialogTitle>
            <DialogDescription>
              Creates an <strong>Evaluation Group</strong>, a Supplier Nomination, and an RFQ for <strong>{itemName}</strong>.
              Manage vendor responses and scoring from the Evaluation Group page.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div className="grid gap-1">
              <Label>Nomination name</Label>
              <Input
                value={nominationName}
                onChange={(e) => setNominationName(e.target.value)}
                placeholder="e.g. Q3 Shortlist – Motor Bracket"
              />
            </div>
            <div className="grid gap-1">
              <Label>Quote deadline</Label>
              <Input
                type="date"
                value={rfqDeadline}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setRfqDeadline(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Processes: {processChips.slice(0, 3).join(' · ')}
              {processChips.length > 3 ? ` +${processChips.length - 3} more` : ''}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!nominationName.trim() || isSending}
              onClick={handleConfirmSend}
            >
              Confirm &amp; Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
