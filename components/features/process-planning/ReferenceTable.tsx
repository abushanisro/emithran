'use client';

import { columnValue } from '@/lib/calculators/lookup-row-match';
import { cellText, columnShares, outputColumn, pickedValue, type ReferenceColumn } from '@/lib/calculators/reference-table';

import type { ReactNode, Ref } from 'react';

/** The narrowest a column is laid out (rem): below it the panel scrolls sideways instead of squeezing a table of many columns. */
const MIN_COLUMN_REM = 5;

/**
 * The reference table a calculator input is picked from (Process, Raw Material and Tooling dialogs): click a row to use its value. Every
 * column is in view at once: each gets a share of the width by the text it holds (columnShares) and long text (names, notes, sources) wraps
 * inside it. The value column (the last) is pinned to the right edge, for a table of so many columns that the panel scrolls sideways.
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
  const shares = columnShares(columns, rows, columnValue);
  const label = (c: ReferenceColumn) => <>{c.label}{c.unit && <span className="ml-1 font-normal text-muted-foreground">({c.unit})</span>}</>;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 border-b border-border bg-primary/5 px-3 py-1.5 text-xs leading-relaxed text-muted-foreground">
        Click a row to use its <strong className="text-primary">{output?.label ?? 'value'}</strong> for{' '}
        <strong className="text-foreground">{fieldLabel}</strong>.
        {note && <> {note}</>}
      </p>

      <div className="min-h-0 flex-1 overflow-auto" onClick={(e) => { e.stopPropagation(); }} onScroll={(e) => { e.stopPropagation(); }}>
        <table className="w-full table-fixed border-separate border-spacing-0 text-xs" style={{ minWidth: `${2.5 + columns.length * MIN_COLUMN_REM}rem` }}>
          <colgroup>
            <col className="w-10" />
            {columns.map((c, i) => <col key={c.name} style={{ width: `${shares[i]}%` }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky top-0 z-20 border-b border-r border-border bg-muted px-1 py-1.5 text-center font-medium text-muted-foreground">#</th>
              {columns.map((c) => c === output ? (
                <th key={c.name} className="sticky right-0 top-0 z-30 break-words border-b border-l border-border bg-muted px-2 py-1.5 text-right align-bottom font-semibold text-primary shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.35)]">
                  {label(c)}
                </th>
              ) : (
                <th key={c.name} className="sticky top-0 z-20 break-words border-b border-r border-border bg-muted px-2 py-1.5 text-left align-bottom font-semibold text-foreground">
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
                  className={`group cursor-pointer ${current ? 'bg-primary/10' : 'hover:bg-muted/60'}`}
                  title={current ? currentTitle ?? `Currently used for ${fieldLabel}` : `Use ${output?.label ?? 'value'} = ${cellText(value)}`}
                  onMouseDown={stop}
                  onClick={(e) => { stop(e); if (value !== undefined) onPick(pickedValue(value)); }}
                >
                  <td className={`border-b border-r border-border px-1 py-1.5 text-center align-top font-mono tabular-nums ${current ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
                    {current ? '★' : i + 1}
                  </td>
                  {columns.map((c) => c === output ? (
                    <td key={c.name} className={`sticky right-0 z-10 break-words border-b border-l border-border px-2 py-1.5 text-right align-top font-mono font-semibold tabular-nums text-primary shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.35)] ${current ? 'bg-background bg-[linear-gradient(hsl(var(--primary)/0.18),hsl(var(--primary)/0.18))]' : 'bg-background group-hover:bg-muted'}`}>
                      {cellText(value)}
                    </td>
                  ) : (
                    <td key={c.name} className={`break-words border-b border-r border-border px-2 py-1.5 align-top leading-snug ${current ? 'font-medium text-foreground' : 'text-foreground/90'}`}>
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
