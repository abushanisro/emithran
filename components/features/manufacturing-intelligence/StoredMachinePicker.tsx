'use client';

/**
 * StoredMachinePicker — the same ⭐ machine dropdown UX as MachineSelector
 * (recommended pick + searchable "Change machine" list, real MHR records and
 * benchmark (★) rates together), adapted for an already-saved process_cost_records
 * row instead of a live route-comparison line. MachineSelector persists via the
 * per-machine-class /machine-override endpoint (a route-engine-wide preference);
 * a stored row has no machineClass-wide "preference" — it IS a specific saved
 * record — so this persists directly to that row via PUT /process-costs/:id.
 */

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useMHRRecords, useMHRBenchmark } from '@/lib/api/hooks/useMHR';
import { useUpdateProcessCost } from '@/lib/api/hooks/useProcessCosts';
import { resolveMhrUsdRate } from '@/lib/api/mhr';

export function StoredMachinePicker({
  procId,
  machineClass,
  machineName,
  machineRateUsd,
  mhrId,
  benchmarkMhrId,
  currencySymbol,
  fromUsd,
  location,
}: {
  procId: string;
  machineClass: string | null | undefined;
  machineName: string | null | undefined;
  machineRateUsd: number;
  mhrId: string | null | undefined;
  benchmarkMhrId: string | number | null | undefined;
  currencySymbol: string;
  fromUsd: number;
  location: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const update = useUpdateProcessCost();

  const { data: mhrList } = useMHRRecords(
    { location, ...(machineClass ? { machineClass } : {}) },
    { enabled: pickerOpen },
  );
  const { data: benchmarkList } = useMHRBenchmark(location, machineClass || undefined, { enabled: pickerOpen });

  const fmtRate = (rate: number) => `${currencySymbol}${(rate * fromUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })}/hr`;

  const isBenchmarkPick = !!benchmarkMhrId;
  const hasIdentity = !!machineName;

  type Row = { id: string; name: string; rate: number; isBenchmark: boolean; machineClass: string | null | undefined };

  const combined = useMemo((): Row[] => {
    const real: Row[] = (mhrList?.records ?? []).map((r) => ({
      id: r.id,
      name: r.machineName,
      rate: resolveMhrUsdRate(r),
      isBenchmark: false,
      machineClass: r.machineClass,
    }));
    const bm: Row[] = (benchmarkList ?? []).map((r) => ({
      id: r.id,
      name: r.machineName,
      rate: r.calculations?.totalMachineHourRate ?? 0,
      isBenchmark: true,
      machineClass: r.machineClass,
    }));
    const all = [...real, ...bm];
    const q = search.trim().toLowerCase();
    return (q
      ? all.filter((r) => r.name.toLowerCase().includes(q) || (r.machineClass ?? '').toLowerCase().includes(q))
      : all
    ).slice(0, 50);
  }, [mhrList, benchmarkList, search]);

  const applyPick = (row: Row) => {
    setPickerOpen(false);
    // mhrId / benchmarkMhrId are mutually exclusive on the row — explicit null
    // (not undefined) on the one NOT picked, so the backend's per-field-present
    // update actually clears the stale reference instead of leaving both set
    // (see process-cost.service.ts's `if (updateDto.X !== undefined)` gating).
    update.mutate({
      id: procId,
      data: {
        mhrId: row.isBenchmark ? null : row.id,
        benchmarkMhrId: row.isBenchmark ? row.id : null,
        machineRate: row.rate,
      } as any,
    });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-foreground min-w-0 truncate">
          {isBenchmarkPick ? '⭐ ' : hasIdentity ? '' : ''}
          {machineName ?? 'Manual rate — not linked to a machine'}
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0">{fmtRate(machineRateUsd)}</span>
      </div>

      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
      >
        Change machine {pickerOpen ? '▴' : '▾'}
      </button>
      {update.isPending && <span className="text-[10px] text-muted-foreground ml-2">Saving…</span>}
      {update.isError && <span className="text-[10px] text-red-500 ml-2">Failed to save — retry</span>}

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
            {combined.length === 0 && (
              <p className="text-[10px] text-muted-foreground px-1 py-2">
                {mhrList && benchmarkList ? 'No machines match.' : 'Loading machines…'}
              </p>
            )}
            {combined.map((r) => {
              const isCurrent = r.isBenchmark ? String(r.id) === String(benchmarkMhrId) : r.id === mhrId;
              return (
                <button
                  key={`${r.isBenchmark ? 'bm' : 'real'}-${r.id}`}
                  type="button"
                  disabled={update.isPending}
                  onClick={() => applyPick(r)}
                  className={cn(
                    'w-full flex items-baseline justify-between gap-2 text-left px-1 py-0.5 rounded hover:bg-muted/30 transition-colors disabled:opacity-60',
                    isCurrent && 'bg-muted/20',
                  )}
                >
                  <span className="text-xs text-foreground min-w-0 truncate">
                    {r.isBenchmark ? '⭐ ' : ''}{r.name}
                    {r.machineClass && <span className="text-[10px] text-muted-foreground ml-1.5">{r.machineClass}</span>}
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{fmtRate(r.rate)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
