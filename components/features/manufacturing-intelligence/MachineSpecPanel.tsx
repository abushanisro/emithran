'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { useMHRReferenceDetail } from '@/lib/api/hooks/useMHR';
import { cn } from '@/lib/utils';
import { groupMachineLibraryDetail } from '@/lib/utils/machineLibraryDetail';

// The full, real machine specification behind one costed process line.
//
// Deliberately built from the two pieces that already existed rather than a
// third copy of either: `useMHRReferenceDetail` (GET /mhr/:id/reference-detail,
// which matches an mhr_records row to its staged sm_reference_data machine row
// by benchmark_source_key) and `groupMachineLibraryDetail` (the labeller/grouper
// the MHR admin form already uses). Nothing here re-derives, re-labels or
// re-groups machine data — a new field appearing in the staged library shows up
// on this panel with no change to this file.
//
// The one thing it asks for that the MHR form does not is `includeCoreFields`:
// that form renders rates/labour/ownership as its own editable inputs, so the
// grouper suppresses them; on a cost surface nothing else shows them, and they
// are exactly the factors the quote is built from.

export interface MachineSpecPanelProps {
  /** mhr_records id for the machine this line was costed on. */
  mhrId: string | null | undefined;
  machineName?: string | null;
  /** Real values already displayed on the process row, so they are not repeated. */
  alreadyShown?: Record<string, number | string | undefined>;
  /** Only fetches once opened — one request per expanded row, not per rendered row. */
  defaultOpen?: boolean;
}

export function MachineSpecPanel({ mhrId, machineName, alreadyShown, defaultOpen = false }: MachineSpecPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Gated on `open`: a quote can carry a dozen process lines, and each one
  // fetching its machine spec on render would be a dozen requests for data
  // nobody has asked to see yet.
  const { data, isLoading, error } = useMHRReferenceDetail(mhrId, { enabled: open && !!mhrId });

  const groups = open ? groupMachineLibraryDetail(data?.raw, alreadyShown, { includeCoreFields: true }) : [];
  const fieldCount = groups.reduce((n, g) => n + g.entries.length, 0);

  if (!mhrId) {
    return (
      <p className="pl-[26px] text-[11px] italic text-muted-foreground/60">
        No machine linked to this line — no specification to show.
      </p>
    );
  }

  return (
    <div className="pl-[26px]">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); }}
        aria-expanded={open}
        className="flex min-h-6 items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Machine specification
        {open && fieldCount > 0 && (
          <span className="font-normal text-muted-foreground/60">· {fieldCount} fields</span>
        )}
      </button>

      {open && (
        <div className="mt-1.5 space-y-2">
          {isLoading && <p className="text-[11px] text-muted-foreground/60">Loading machine specification…</p>}

          {/* An absent reference row is a real, reportable data state — the
              machine exists in mhr_records but has no staged library match, so
              say that rather than rendering an empty panel. */}
          {!isLoading && !error && data && !data.found && (
            <p className="text-[11px] leading-snug text-amber-500/90">
              No staged machine-library record matches {machineName ?? 'this machine'}, so only the rate on file is known for it.
            </p>
          )}

          {!isLoading && Boolean(error) && (
            <p className="text-[11px] text-red-400/90">Machine specification could not be loaded.</p>
          )}

          {data?.found && data.sourceKey && (
            <p className="text-[10px] text-muted-foreground/60">
              Source: <span className="font-mono">{data.sourceKey}</span>
            </p>
          )}

          {groups.map((group) => (
            <div key={group.title}>
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {group.title}
              </div>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
                {group.entries.map((entry) => (
                  <div
                    key={entry.key}
                    className={cn('flex items-baseline justify-between gap-2 border-b border-dashed border-border/30 py-0.5')}
                  >
                    <dt className="truncate text-[11px] text-muted-foreground" title={entry.key}>{entry.label}</dt>
                    <dd className="shrink-0 text-[11px] tabular-nums">{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
