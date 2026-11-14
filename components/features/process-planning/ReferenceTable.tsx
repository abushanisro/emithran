'use client';

import { columnValue } from '@/lib/calculators/lookup-row-match';
import { cellText, outputColumn, pickedValue, type ReferenceColumn } from '@/lib/calculators/reference-table';

import type { ReactNode, Ref } from 'react';

/**
 * The reference table a calculator input is picked from (Process, Raw Material and Tooling dialogs): click a row to use its value. The value
 * column (the last) is pinned to the right edge so it is always in view, and long text (notes, sources) wraps instead of pushing it off-screen.
 */
export function ReferenceTable({ columns, rows, fieldLabel, note, isCurrent, currentTitle, currentRowRef, onPick }: {
  columns: readonly ReferenceColumn[];
  rows: readonly Record<string, unknown>[];
  /** The input the picked value goes to. */
  fieldLabel: string;
  /** More to say under the hint (which row is in use, an interpolation). */
  note?: ReactNode;
  /** The row the input currently comes from: outlined. */
  isCurrent?: (row: Record<string, unknown>) => boolean;
  currentTitle?: string;
  currentRowRef?: Ref<HTMLTableRowElement>;
  onPick: (value: unknown) => void;
}) {
  const output = outputColumn(columns);
  const stop = (e: { stopPropagation: () => void; preventDefault: () => void }) => { e.stopPropagation(); e.preventDefault(); };
  const label = (c: ReferenceColumn) => <>{c.label}{c.unit && <span className="ml-1 font-normal text-muted-foreground">({c.unit})</span>}</>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 border-b border-border bg-primary/5 px-3 py-1.5 text-xs leading-relaxed text-muted-foreground">
        Click a row to use its <strong className="text-primary">{output?.label ?? 'value'}</strong> for{' '}
        <strong className="text-foreground">{fieldLabel}</strong>.
        {note && <> {note}</>}
      </p>

      <div className="min-h-0 flex-1 overflow-auto" onClick={(e) => { e.stopPropagation(); }} onScroll={(e) => { e.stopPropagation(); }}>
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky top-0 z-20 w-8 border-b border-r border-border bg-muted px-1 py-1.5 text-center font-medium text-muted-foreground">#</th>
              {columns.map((c) => c === output ? (
                <th key={c.name} className="sticky right-0 top-0 z-30 whitespace-nowrap border-b border-l border-border bg-muted px-2 py-1.5 text-left font-semibold text-primary shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.35)]">
                  {label(c)}
                </th>
              ) : (
                <th key={c.name} className="sticky top-0 z-20 whitespace-nowrap border-b border-r border-border bg-muted px-2 py-1.5 text-left font-semibold text-foreground">
                  {label(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const current = isCurrent?.(row) ?? false;
              const value = output ? columnValue(row, output.name) : undefined;
              return (
                <tr
                  key={i}
                  ref={current ? currentRowRef : undefined}
                  className={`group cursor-pointer ${current ? 'bg-primary/10' : 'hover:bg-primary/5'}`}
                  title={current ? currentTitle ?? `Currently used for ${fieldLabel}` : `Use ${output?.label ?? 'value'} = ${cellText(value)}`}
                  onMouseDown={stop}
                  onClick={(e) => { stop(e); if (value !== undefined) onPick(pickedValue(value)); }}
                >
                  <td className={`border-b border-r border-border px-1 py-1 text-center font-mono ${current ? 'bg-primary/20 text-primary' : 'text-muted-foreground'}`}>
                    {current ? '★' : i + 1}
                  </td>
                  {columns.map((c) => c === output ? (
                    <td key={c.name} className={`sticky right-0 z-10 whitespace-nowrap border-b border-l border-border px-2 py-1 text-right font-mono font-semibold tabular-nums text-primary shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.35)] ${current ? 'bg-primary/20' : 'bg-background group-hover:bg-muted'}`}>
                      {cellText(value)}
                    </td>
                  ) : (
                    <td key={c.name} className={`min-w-[5rem] max-w-[22rem] whitespace-normal break-words border-b border-r border-border px-2 py-1 align-top ${current ? 'font-medium text-foreground' : 'text-foreground/90'}`}>
                      {cellText(columnValue(row, c.name))}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
