'use client';

import type { SecondaryOperationsDto, SecondaryOptionDto } from '@/lib/api/hooks/useBOMItems';

type Group = 'heat' | 'surface' | 'other';
const GROUPS: { key: Group; label: string }[] = [
  { key: 'heat', label: 'Heat Treatment' },
  { key: 'surface', label: 'Surface Treatment' },
  { key: 'other', label: 'Other Secondary' },
];

/**
 * Heat treatment, surface treatment and other secondary processes for any part
 * family, in Auto and Manual routing alike. Every option and its cost per part
 * comes from the cost summary (backend secondary-operations.ts); a pick is
 * saved on the scenario as secondaryOperations and priced live. Until a pick
 * is saved, the drawing callouts are the selection ("from drawing").
 */
export function SecondaryOperationsPicker({
  ops, currencySymbol, onChange, disabled,
}: {
  ops: SecondaryOperationsDto;
  currencySymbol: string;
  onChange: (selection: Record<Group, string[]>) => void;
  disabled?: boolean;
}) {
  const selected = (g: Group) => ops[g].filter((o) => o.selected).map((o) => o.process);
  const toggle = (g: Group, process: string) => {
    const next = { heat: selected('heat'), surface: selected('surface'), other: selected('other') };
    next[g] = next[g].includes(process) ? next[g].filter((p) => p !== process) : [...next[g], process];
    onChange(next);
  };
  const cost = (o: SecondaryOptionDto) =>
    o.costPerPart != null ? `${currencySymbol}${o.costPerPart.toFixed(2)}` : o.status === 'not_applicable' ? 'n/a' : 'not costed';
  const picked = GROUPS.flatMap(({ key }) => ops[key].filter((o) => o.selected));
  const total = picked.reduce((sum, o) => sum + (o.costPerPart ?? 0), 0);
  const uncosted = picked.filter((o) => o.costPerPart == null).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/60 px-4 py-3">
        <h4 className="text-sm font-semibold">Secondary operations</h4>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {ops.source === 'drawing' ? 'Pre-selected from the drawing callouts.' : 'Your selection.'} Each tick is a line on the quote and is saved at once.
        </p>
      </div>

      {/* Every group is open: nothing is hidden behind a click, and a group with no pick says so in its header. */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {GROUPS.map(({ key, label }) => {
          const count = ops[key].filter((o) => o.selected).length;
          return (
            <section key={key} aria-label={label}>
              <div className="mb-1 flex items-baseline justify-between">
                <h5 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</h5>
                <span className="text-[10px] text-muted-foreground">{count === 0 ? 'None' : `${count} selected`}</span>
              </div>
              {ops[key].length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No processes on file.</p>
              ) : (
                <ul className="max-h-48 divide-y divide-border/40 overflow-y-auto rounded border border-border/60">
                  {ops[key].map((o) => (
                    <li key={o.process}>
                      <label
                        title={o.reason}
                        className={`flex cursor-pointer items-start gap-2 px-2 py-1.5 text-xs hover:bg-muted/40 ${o.selected ? 'bg-brand-50/40 dark:bg-brand-950/20' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={o.selected}
                          disabled={disabled}
                          onChange={() => { toggle(key, o.process); }}
                          className="mt-0.5 shrink-0 accent-brand-600"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            {o.process}
                            {o.fromDrawing && <span className="ml-1 text-[9px] text-brand-400">from drawing</span>}
                          </span>
                          {o.selected && (
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {o.machineName ?? 'No machine on file'}
                              {o.cycleTimeSec != null && ` · ${(o.cycleTimeSec / 60).toFixed(2)} min`}
                            </span>
                          )}
                        </span>
                        <span className={`shrink-0 tabular-nums ${o.costPerPart == null ? 'text-muted-foreground' : ''}`}>{cost(o)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        {ops.dataWarnings.length > 0 && (
          <p className="text-[10px] text-amber-600 dark:text-amber-500">{ops.dataWarnings.join(' ')}</p>
        )}
      </div>

      <div className="shrink-0 border-t border-border/60 px-4 py-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">{picked.length === 0 ? 'No secondary operations' : `${picked.length} selected`}</span>
          <span className="font-semibold tabular-nums">{currencySymbol}{total.toFixed(2)} / part</span>
        </div>
        {uncosted > 0 && <p className="mt-0.5 text-[10px] text-muted-foreground">{uncosted} selected without a cost on file; not in this total.</p>}
      </div>
    </div>
  );
}
