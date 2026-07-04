'use client';

/**
 * MachineSelector — renders the physics-based machine recommendation inside an
 * expanded process-line row: recommended machine + confidence, profile tabs
 * (balanced / cheapest / fastest — re-scored client-side from the same payload,
 * no API round-trip), up to two alternatives, and a full-list override picker.
 * Overrides persist via POST /bom-items/:id/machine-override.
 */

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useMachineOverride } from '@/lib/api/hooks/useBOMItems';
import type {
  MachineCandidate,
  MachineSelectionResult,
  SelectionProfile,
} from '@/lib/api/hooks/useBOMItems';
import { useMHRRecords } from '@/lib/api/hooks/useMHR';

const PROFILE_LABELS: Record<SelectionProfile, string> = {
  balanced: 'Balanced',
  cheapest: 'Cheapest',
  fastest: 'Fastest',
};

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
  location,
}: {
  itemId: string;
  processKey: string;
  selection: MachineSelectionResult;
  currencySymbol: string;
  location: string;
}) {
  const [profile, setProfile] = useState<SelectionProfile>('balanced');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Location-scoped: the override is stored for THIS Digital Factory location only
  const override = useMachineOverride(itemId, location);

  // Full-list picker loads lazily — only when the user opens "Change machine"
  const { data: mhrList } = useMHRRecords(
    { location, limit: 500 },
    { enabled: pickerOpen },
  );

  const active = selection[profile];
  const recommended = active.candidate;
  const fmtRate = (rate: number) => `${currencySymbol}${rate.toLocaleString(undefined, { maximumFractionDigits: 0 })}/hr`;

  const alternativeTag = (c: MachineCandidate): string | null => {
    if (c.machineId === selection.cheapest.candidate.machineId) return 'cheapest';
    if (c.machineId === selection.fastest.candidate.machineId) return 'fastest';
    return null;
  };

  const filteredMachines = useMemo(() => {
    const records = mhrList?.records ?? [];
    const q = search.trim().toLowerCase();
    return (q
      ? records.filter((r) =>
          r.machineName.toLowerCase().includes(q) ||
          (r.machineClass ?? '').toLowerCase().includes(q) ||
          (r.processGroup ?? '').toLowerCase().includes(q))
      : records
    ).slice(0, 50);
  }, [mhrList, search]);

  const applyOverride = (mhrRecordId: string | null) => {
    setPickerOpen(false);
    override.mutate({ processKey, mhrRecordId });
  };

  return (
    <div className="space-y-1.5">
      {/* Header + profile tabs */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Machine</span>
        <div className="flex gap-0.5">
          {(Object.keys(PROFILE_LABELS) as SelectionProfile[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProfile(p)}
              className={cn(
                'px-1.5 py-0.5 text-[10px] rounded transition-colors',
                profile === p
                  ? 'bg-muted text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {PROFILE_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Recommended machine for the active profile */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs text-foreground">
            {selection.overridden && profile === 'balanced' ? '✎ ' : '⭐ '}
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
      {selection.alternatives
        .filter((c) => c.machineId !== recommended.machineId)
        .map((c) => (
          <button
            key={c.machineId ?? c.machineName ?? 'default'}
            type="button"
            disabled={override.isPending || !c.machineId}
            onClick={() => c.machineId && applyOverride(c.machineId)}
            className="w-full flex items-baseline justify-between gap-2 text-left hover:bg-muted/20 rounded px-1 -mx-1 transition-colors disabled:opacity-60"
          >
            <span className="text-xs text-muted-foreground min-w-0">
              ○ {c.machineName ?? 'Class default'}
              {alternativeTag(c) && <span className="text-[10px] ml-1.5 italic">— {alternativeTag(c)}</span>}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{fmtRate(c.hourlyRate)}</span>
          </button>
        ))}

      {/* Why this machine */}
      {active.reasons.length > 0 && (
        <p className="text-[10px] text-muted-foreground leading-snug">
          <span className="font-semibold">Why:</span> {active.reasons.join('; ')}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
        >
          Change machine {pickerOpen ? '▴' : '▾'}
        </button>
        {selection.overridden && (
          <button
            type="button"
            disabled={override.isPending}
            onClick={() => applyOverride(null)}
            className="text-[10px] text-amber-500 hover:text-amber-400 underline underline-offset-2 transition-colors disabled:opacity-60"
          >
            Reset to recommended
          </button>
        )}
        {override.isPending && <span className="text-[10px] text-muted-foreground">Saving…</span>}
        {override.isError && <span className="text-[10px] text-red-500">Failed to save — retry</span>}
      </div>

      {/* Full-list picker — no capability filter; the cost engineer's judgment wins */}
      {pickerOpen && (
        <div className="border border-border/40 rounded-md p-1.5 space-y-1 bg-background">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search machines…"
            className="w-full bg-muted/20 text-xs px-2 py-1 rounded border border-border/30 outline-none focus:border-border text-foreground placeholder:text-muted-foreground"
          />
          <div className="max-h-44 overflow-y-auto space-y-0.5">
            {filteredMachines.length === 0 && (
              <p className="text-[10px] text-muted-foreground px-1 py-2">
                {mhrList ? 'No machines match.' : 'Loading machines…'}
              </p>
            )}
            {filteredMachines.map((r) => {
              const rate = r.fullyBurdenedLocalPerHr ?? r.calculations?.totalMachineHourRate ?? r.manualMHRValue ?? 0;
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={override.isPending}
                  onClick={() => applyOverride(r.id)}
                  className={cn(
                    'w-full flex items-baseline justify-between gap-2 text-left px-1 py-0.5 rounded hover:bg-muted/30 transition-colors disabled:opacity-60',
                    r.id === recommended.machineId && 'bg-muted/20',
                  )}
                >
                  <span className="text-xs text-foreground min-w-0 truncate">
                    {r.machineName}
                    {r.machineClass && <span className="text-[10px] text-muted-foreground ml-1.5">{r.machineClass}</span>}
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{fmtRate(rate)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
