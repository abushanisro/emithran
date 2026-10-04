'use client';

import { useState } from 'react';
import type { SecondaryOperationsDto, SecondaryOptionDto } from '@/lib/api/hooks/useBOMItems';

type Group = 'heat' | 'surface' | 'other';
const GROUPS: Array<{ key: Group; label: string }> = [
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
  const [open, setOpen] = useState<Group | null>(null);
  const selected = (g: Group) => ops[g].filter((o) => o.selected).map((o) => o.process);
  const toggle = (g: Group, process: string) => {
    const next = { heat: selected('heat'), surface: selected('surface'), other: selected('other') };
    next[g] = next[g].includes(process) ? next[g].filter((p) => p !== process) : [...next[g], process];
    onChange(next);
  };
  const cost = (o: SecondaryOptionDto) =>
    o.costPerPart != null ? `${currencySymbol}${o.costPerPart.toFixed(2)}` : o.status === 'not_applicable' ? 'n/a' : 'not costed';

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-muted-foreground">
        {ops.source === 'drawing' ? 'Pre-selected from the drawing callouts.' : 'Your selection.'} Each pick is a line on the quote.
      </p>
      {GROUPS.map(({ key, label }) => {
        const picked = ops[key].filter((o) => o.selected);
        return (
          <div key={key}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setOpen(open === key ? null : key)}
              className="w-full flex items-center justify-between gap-2 text-xs border border-border rounded px-2 py-1 bg-background hover:bg-muted/40 disabled:opacity-50"
            >
              <span className="text-muted-foreground shrink-0">{label}</span>
              <span className="truncate text-right">
                {picked.length === 0 ? 'None' : picked.map((o) => o.process).join(', ')}
              </span>
            </button>
            {open === key && (
              <div className="mt-1 max-h-56 overflow-y-auto rounded border border-border bg-background">
                {ops[key].length === 0 && <p className="px-2 py-1 text-[10px] text-muted-foreground">No processes on file.</p>}
                {ops[key].map((o) => (
                  <label
                    key={o.process}
                    title={o.reason}
                    className="flex items-center gap-2 px-2 py-1 text-[11px] cursor-pointer hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={o.selected}
                      disabled={disabled}
                      onChange={() => toggle(key, o.process)}
                      className="accent-violet-600 shrink-0"
                    />
                    <span className="flex-1 min-w-0 truncate">
                      {o.process}
                      {o.fromDrawing && <span className="ml-1 text-[9px] text-violet-400">from drawing</span>}
                    </span>
                    <span className={`tabular-nums shrink-0 ${o.costPerPart == null ? 'text-muted-foreground' : ''}`}>{cost(o)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {ops.dataWarnings.length > 0 && (
        <p className="text-[10px] text-amber-600 dark:text-amber-500">{ops.dataWarnings.join(' ')}</p>
      )}
    </div>
  );
}
