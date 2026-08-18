'use client';

/**
 * MachineSelector — renders the physics-based machine recommendation inside an
 * expanded process-line row: recommended (balanced) machine + confidence, up
 * to two alternatives, and a full-list override picker. Overrides persist via
 * POST /bom-items/:id/machine-override.
 */

import { useMachineOverride } from '@/lib/api/hooks/useBOMItems';
import { cn } from '@/lib/utils';
import type {
  CapabilityCheck,
  MachineCandidate,
  MachineSelectionResult,
} from '@/lib/api/hooks/useBOMItems';

export function confidenceColor(confidence: number): string {
  if (confidence >= 80) return 'text-emerald-500';
  if (confidence >= 60) return 'text-amber-500';
  return 'text-red-500';
}

function AvailabilityChip({ candidate }: { candidate: MachineCandidate }) {
  const status = candidate.availabilityStatus;
  if (status === 'down' || status === 'retired' || status === 'maintenance') {
    return <span className="text-[10px] text-red-500">{status === 'maintenance' ? 'Maintenance' : 'Down'}</span>;
  }
  if (status === 'commissioning') {
    return <span className="text-[10px] text-amber-500">Commissioning</span>;
  }
  const load = candidate.scheduledLoadPct;
  if (load != null && load >= 80) {
    return <span className="text-[10px] text-amber-500">Booked {Math.round(load)}%</span>;
  }
  return (
    <span className="text-[10px] text-emerald-500">
      Available now{load != null ? ` (${Math.round(load)}% load)` : ''}
    </span>
  );
}

export function MachineSelector({
  itemId,
  processKey,
  selection,
  currencySymbol,
  conversionRate = 1,
  location,
  onApply,
  applyPending,
  applyError,
  currentMachine,
  savedExplanation,
}: {
  itemId: string;
  processKey: string;
  selection: MachineSelectionResult;
  currencySymbol: string;
  // amount_usd × conversionRate = amount in `currencySymbol`'s currency.
  // Applied ONLY to currentMachine.machineRate below (a raw, always-USD
  // process_cost_records column) — `selection`'s own candidates are already
  // converted server-side (see bom-items.service.ts's convertMachineSelectionCost),
  // so applying this rate to them again would double-convert.
  conversionRate?: number;
  location: string;
  // When provided, a pick persists via this callback instead of the
  // location+processKey-scoped /machine-override endpoint — used when this
  // selector is rendering for one specific SAVED process_cost_records row
  // (its own mhrId/machineRate columns) rather than the live route-comparison
  // preference for this machine class as a whole.
  onApply?: (candidate: MachineCandidate | null) => void;
  applyPending?: boolean;
  applyError?: boolean;
  // This saved row's own machine link (process_cost_records.mhrId/machineName/
  // machineRate) — a deliberate choice made through the Edit Process Cost
  // dialog. When it differs from the live ⭐ recommendation below, IT is shown
  // as the current pick instead of being silently swapped for the algorithm's
  // own suggestion. Only used when onApply is provided (stored row mode) — the
  // live route-comparison mode has no per-row saved machine.
  currentMachine?: { mhrId?: string | null; machineName?: string | null; machineRate?: number | null } | null;
  // Server-computed reasons/capabilityCheck for THIS saved machine specifically
  // (backend's savedMachineExplanations, keyed by mhrId), used only when the
  // saved pick differs from the live recommendation — showing the live pick's
  // reasoning under a different machine would misattribute it, so this is the
  // honest substitute rather than showing nothing.
  savedExplanation?: { reasons: string[]; capabilityCheck: CapabilityCheck | null } | null;
}) {
  // Location-scoped: the override is stored for THIS Digital Factory location only.
  // Unused (but still called — hooks can't be conditional) when onApply is provided.
  const override = useMachineOverride(itemId, location);

  const active = selection.balanced;
  const liveRecommended = active.candidate;
  // Root cause of the "$0.25/hr shows as $0/hr" bug: this was the only one of
  // 8 rate-display call sites in the app using maximumFractionDigits: 0 (a
  // 0-decimal rate display is lossy for any rate under $1) — every other real
  // rate display in this codebase (ProcessCostDialog, DraftLineCard,
  // DatabaseRecordPicker, MHRFormDialog, ManufacturingProcessSection) already
  // uses .toFixed(2), which is the actual established convention here. Match
  // it exactly rather than inventing a magnitude threshold.
  const fmtRate = (rate: number) => `${currencySymbol}${rate.toFixed(2)}/hr`;

  const hasSavedMachine = !!(currentMachine?.mhrId || currentMachine?.machineName);
  const differsFromLive = hasSavedMachine && currentMachine?.mhrId !== liveRecommended.machineId;

  // The saved machine, shaped as a MachineCandidate so it can reuse the same
  // rendering as the live one — availability/utilization aren't tracked for a
  // saved pick, so those default to "available"/unknown rather than guessing.
  const recommended: MachineCandidate = differsFromLive
    ? {
        machineId: currentMachine?.mhrId ?? null,
        machineName: currentMachine?.machineName ?? null,
        commodityCode: null,
        machineClass: liveRecommended.machineClass,
        hourlyRate: Number(currentMachine?.machineRate ?? 0) * conversionRate,
        utilizationPct: 0,
        scheduledLoadPct: null,
        availabilityStatus: 'available',
        nextAvailableAt: null,
        maintenanceWindowStart: null,
        maintenanceWindowEnd: null,
        capability: liveRecommended.capability,
        capabilitySource: 'imported',
        capabilityVersion: null,
      }
    : liveRecommended;

  // Reasoning to display: the live balanced pick's own reasons/capabilityCheck
  // when that's what's shown above, or the server-computed explanation for
  // THIS specific saved machine when the saved pick differs from live — never
  // the live pick's reasoning misattributed to a different machine.
  const explanation: { reasons: string[]; capabilityCheck: CapabilityCheck | null } | null = differsFromLive
    ? (savedExplanation ?? null)
    : { reasons: active.reasons, capabilityCheck: active.capabilityCheck ?? null };

  const alternativeTag = (c: MachineCandidate): string | null => {
    if (c.machineId === selection.cheapest.candidate.machineId) return 'cheapest';
    if (c.machineId === selection.fastest.candidate.machineId) return 'fastest';
    return null;
  };

  const alternativeCandidates = selection.alternatives.filter((c) => c.machineId !== recommended.machineId);

  const isPending = onApply ? !!applyPending : override.isPending;
  const isError = onApply ? !!applyError : override.isError;

  const applyOverride = (mhrRecordId: string | null, candidate?: MachineCandidate) => {
    if (onApply) {
      onApply(candidate ?? null);
    } else {
      override.mutate({ processKey, mhrRecordId });
    }
  };

  return (
    <div className="space-y-1.5">
      {/* Recommended machine */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs text-foreground">
            {differsFromLive || selection.overridden ? '✎ ' : '⭐ '}
            {recommended.machineName ?? `Class default (${recommended.machineClass.replace(/_/g, ' ')})`}
          </span>
          <span className="text-[10px] text-muted-foreground ml-1.5">{fmtRate(recommended.hourlyRate)}</span>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <AvailabilityChip candidate={recommended} />
        </div>
      </div>

      {selection.availabilityWarning && (
        <p className="text-[10px] text-amber-500">⚠ {selection.availabilityWarning}</p>
      )}

      {/* Alternatives */}
      {alternativeCandidates.map((c) => (
        <button
          key={c.machineId ?? c.machineName ?? 'default'}
          type="button"
          disabled={isPending || !c.machineId}
          onClick={() => c.machineId && applyOverride(c.machineId, c)}
          className="w-full flex items-baseline justify-between gap-2 text-left hover:bg-muted/20 rounded px-1 -mx-1 transition-colors disabled:opacity-60"
        >
          <span className="text-xs text-muted-foreground min-w-0">
            ○ {c.machineName ?? 'Class default'}
            {alternativeTag(c) && <span className="text-[10px] ml-1.5 italic">— {alternativeTag(c)}</span>}
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{fmtRate(c.hourlyRate)}</span>
        </button>
      ))}

      {/* Capability check — structured Material/Thickness/Capacity/Status
          table instead of parsing a flat "MS 1.5 mm ≤ 12 mm limit" string.
          Uses the saved machine's own explanation when the saved pick differs
          from live (see `explanation` above) so this never misattributes the
          live candidate's numbers to a different displayed machine. */}
      {explanation?.capabilityCheck && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
          {explanation.capabilityCheck.materialGrade && (
            <>
              <span className="text-muted-foreground">Material</span>
              <span className="text-foreground text-right">{explanation.capabilityCheck.materialGrade}</span>
            </>
          )}
          <span className="text-muted-foreground">{explanation.capabilityCheck.parameter}</span>
          <span className="text-foreground text-right tabular-nums">
            {explanation.capabilityCheck.value} {explanation.capabilityCheck.unit}
          </span>
          <span className="text-muted-foreground">Machine Capacity</span>
          <span className="text-foreground text-right tabular-nums">
            {explanation.capabilityCheck.limit != null ? `${explanation.capabilityCheck.limit} ${explanation.capabilityCheck.unit}` : 'unknown'}
          </span>
          <span className="text-muted-foreground">Status</span>
          <span className={cn('text-right', explanation.capabilityCheck.supported ? 'text-emerald-500' : 'text-red-500')}>
            {explanation.capabilityCheck.supported ? '✓ Supported' : '✗ Not Supported'}
          </span>
        </div>
      )}

      {/* Why this machine — describes whichever candidate is actually shown
          above (live balanced pick, or the saved pick's own server-computed
          explanation when it differs from live). Never the live pick's
          reasoning under a different machine's name. */}
      {explanation && explanation.reasons.length > 0 && (
        <p className="text-[10px] text-muted-foreground leading-snug">
          <span className="font-semibold">Why:</span> {explanation.reasons.join('; ')}
        </p>
      )}
      {differsFromLive && !savedExplanation && (
        <p className="text-[10px] text-muted-foreground/60 italic">
          Manually selected — differs from the current algorithm recommendation
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        {!onApply && selection.overridden && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => applyOverride(null)}
            className="text-[10px] text-amber-500 hover:text-amber-400 underline underline-offset-2 transition-colors disabled:opacity-60"
          >
            Reset to recommended
          </button>
        )}
        {isPending && <span className="text-[10px] text-muted-foreground">Saving…</span>}
        {isError && <span className="text-[10px] text-red-500">Failed to save — retry</span>}
      </div>
    </div>
  );
}
