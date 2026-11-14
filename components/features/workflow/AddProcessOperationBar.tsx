'use client';

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { processOperationOptions, type CatalogOperationRow } from '@/lib/processCatalog/process-operation-options';

// "Process" then "Operation", side by side, then Add: an operation the engineer adds to the part by hand. Both lists
// are the process catalog of one group; choosing a process narrows the operations to that process.
export function AddProcessOperationBar({
  rows, processGroup, onAdd, disabled = false,
}: {
  rows: readonly CatalogOperationRow[];
  processGroup: string;
  onAdd: (row: CatalogOperationRow) => void;
  disabled?: boolean;
}) {
  const options = useMemo(() => processOperationOptions(rows, processGroup), [rows, processGroup]);
  const [process, setProcess] = useState('');
  const [operation, setOperation] = useState('');
  const operations = options.find((o) => o.process === process)?.operations ?? [];
  const picked = operations.find((o) => o.operation === operation);
  const select = 'h-8 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs focus:outline-hidden focus:ring-1 focus:ring-brand-500 disabled:opacity-50';

  return (
    <div className="mb-3 flex items-end gap-2 rounded-md border border-border/60 bg-muted/20 p-2">
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Process
        <select
          className={select} value={process} disabled={disabled || options.length === 0}
          onChange={(e) => { setProcess(e.target.value); setOperation(''); }}
        >
          <option value="">{options.length === 0 ? 'No processes in the catalog' : `Select a process (${String(options.length)})`}</option>
          {options.map((o) => <option key={o.process} value={o.process}>{o.process}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Operation
        <select className={select} value={operation} disabled={disabled || !process} onChange={(e) => { setOperation(e.target.value); }}>
          <option value="">{process ? 'Select an operation' : 'Select a process first'}</option>
          {operations.map((o) => <option key={o.operation} value={o.operation}>{o.operation}</option>)}
        </select>
      </label>
      <button
        type="button" disabled={disabled || !picked}
        onClick={() => { if (picked) { onAdd(picked); setOperation(''); } }}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
      </button>
    </div>
  );
}
