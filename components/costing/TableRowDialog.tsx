'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { missingMeasures, prunedRow, type RowVocabulary, type TableRow } from '@/lib/costing/joint-table';

interface Props<F extends string> {
  vocabulary: RowVocabulary<F>;
  initial: TableRow<F>;
  isNew: boolean;
  /** What a row is ("joint", "weld"), the kind select's name ("Joint type", "Weld"), and what the dialog says it is costed by. */
  noun: string;
  kindLabel: string;
  description: string;
  namePlaceholder: string;
  /** The kind cannot be changed (a joint the engine derived). */
  kindLocked?: boolean;
  onSave: (row: TableRow<F>) => void;
  onClose: () => void;
}

const controlClass = 'w-full min-w-0 text-sm border border-border rounded-md px-2 py-1.5 bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/40';

/**
 * A row of a Cost Guide table (a joint, a weld): its kind, then exactly the measures that kind needs (required, marked *) or takes (optional,
 * empty: the engine's default). Saved, the row keeps only the measures its kind takes.
 */
export function TableRowDialog<F extends string>({ vocabulary: v, initial, isNew, noun, kindLabel, description, namePlaceholder, kindLocked = false, onSave, onClose }: Props<F>) {
  const [row, setRow] = useState<TableRow<F>>(initial);
  const required = v.required(row);
  const optional = v.optional(row);
  const flags = optional.filter((f) => v.flags.has(f));
  const missing = missingMeasures(v, row);
  const set = (f: F | 'label', value: string | number | boolean | undefined) => {
    setRow((r) => {
      const next = Object.fromEntries(Object.entries(r).filter(([k]) => k !== f)) as TableRow<F>;
      return value === undefined || value === '' ? next : { ...next, [f]: value };
    });
  };
  const field = (f: F, isRequired: boolean) => {
    const choices = v.choices(f, row);
    const value = row[f];
    return (
      <label key={f} className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{v.label(f, row)}{isRequired ? ' *' : ''}</span>
        {choices ? (
          <select className={`${controlClass} cursor-pointer`} value={typeof value === 'string' ? value : ''} onChange={(e) => { set(f, e.target.value || undefined); }}>
            <option value="">{isRequired ? 'Choose…' : 'Default'}</option>
            {choices.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <input
            className={controlClass} type="number" min={0} step="any" inputMode="decimal"
            value={typeof value === 'number' ? value : ''} placeholder={v.placeholder?.(f, row) ?? ''}
            onChange={(e) => { set(f, e.target.value === '' ? undefined : Number(e.target.value)); }}
          />
        )}
      </label>
    );
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add' : 'Edit'} {noun}</DialogTitle>
          <DialogDescription>{description} Fields marked * are needed to cost it.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{kindLabel}</span>
            <select className={`${controlClass} cursor-pointer`} value={row.process} disabled={kindLocked} onChange={(e) => { setRow(v.rekind(row, e.target.value)); }}>
              {v.kinds.map((k) => <option key={k.process} value={k.process}>{k.label}</option>)}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Name</span>
            <input className={controlClass} value={row.label ?? ''} onChange={(e) => { set('label', e.target.value || undefined); }} placeholder={namePlaceholder} />
          </label>
          {required.map((f) => field(f, true))}
          {optional.filter((f) => !v.flags.has(f)).map((f) => field(f, false))}
          {flags.length > 0 && (
            <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-1">
              {flags.map((f) => (
                <label key={f} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={row[f] === true} onChange={(e) => { set(f, e.target.checked || undefined); }} /> {v.label(f, row)}
                </label>
              ))}
            </div>
          )}
        </div>
        {missing.length > 0 && <p className="text-xs text-amber-600">Still needed: {missing.map((f) => v.label(f, row)).join(', ')}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={missing.length > 0} onClick={() => { onSave(prunedRow(v, row)); }}>{isNew ? `Add ${noun}` : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
