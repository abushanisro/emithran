'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DraftLine, DraftLineKind } from '@/lib/api/hooks/useProcessPlanGenerate';

interface Props {
  line: DraftLine;
  removed: boolean;
  override: Record<string, any> | null;
  onFieldChange: (fieldPath: string, value: unknown) => void;
  onRemove: () => void;
}

// Which fields to surface as the inline summary + which are editable
const EDITABLE_FIELDS_BY_KIND: Record<DraftLineKind, Array<{ path: string; label: string; type: 'number' | 'string' }>> = {
  raw_material: [
    { path: 'grossUsage', label: 'Gross usage (kg)', type: 'number' },
    { path: 'netUsage', label: 'Net usage (kg)', type: 'number' },
    { path: 'scrapPercentage', label: 'Scrap %', type: 'number' },
    { path: 'overheadPercentage', label: 'Overhead %', type: 'number' },
    { path: 'unitCost', label: '₹/kg', type: 'number' },
  ],
  process: [
    { path: 'opNbr', label: 'Op #', type: 'number' },
    { path: 'setupTimeMinutes', label: 'Setup (min)', type: 'number' },
    { path: 'batchSize', label: 'Batch', type: 'number' },
    { path: 'cycleTimeSeconds', label: 'Cycle (s)', type: 'number' },
    { path: 'partsPerCycle', label: 'Parts/cycle', type: 'number' },
    { path: 'heads', label: 'Heads', type: 'number' },
    { path: 'scrapPercentage', label: 'Scrap %', type: 'number' },
  ],
  tooling: [
    { path: 'description', label: 'Description', type: 'string' },
    { path: 'unitCost', label: 'Unit cost (₹)', type: 'number' },
    { path: 'quantity', label: 'Qty', type: 'number' },
    { path: 'amortizationParts', label: 'Amort. parts', type: 'number' },
    { path: 'usagePercentage', label: 'Usage %', type: 'number' },
  ],
  logistics: [
    { path: 'costName', label: 'Cost name', type: 'string' },
    { path: 'unitCost', label: 'Unit cost (₹)', type: 'number' },
    { path: 'quantity', label: 'Qty', type: 'number' },
  ],
  procured_part: [
    { path: 'partName', label: 'Part name', type: 'string' },
    { path: 'unitCost', label: 'Unit cost (₹)', type: 'number' },
    { path: 'quantity', label: 'Qty', type: 'number' },
    { path: 'scrapPercentage', label: 'Scrap %', type: 'number' },
  ],
};

function describeLine(line: DraftLine): string {
  switch (line.kind) {
    case 'raw_material':
      return `${line.data.materialGrade ?? 'material'} — ${line.data.grossUsage} kg gross`;
    case 'process':
      return `Op ${line.data.opNbr} · ${line.data.machineName ?? 'machine'} · ${line.data.setupTimeMinutes}min setup + ${line.data.cycleTimeSeconds}s cycle`;
    case 'tooling':
      return `${line.data.toolingType} · ${line.data.description}`;
    case 'logistics':
      return `${line.data.costName} · ${line.data.logisticsType} · ${line.data.modeOfTransport}`;
    case 'procured_part':
      return `${line.data.partName} × ${line.data.quantity}`;
  }
}

export function DraftLineCard({ line, removed, override, onFieldChange, onRemove }: Props) {
  const [expanded, setExpanded] = useState(false);
  const merged = { ...line.data, ...(override ?? {}) };
  const fields = EDITABLE_FIELDS_BY_KIND[line.kind];

  if (removed) {
    return (
      <div className="rounded border border-dashed border-muted-foreground/40 px-3 py-2 text-xs text-muted-foreground line-through">
        {describeLine(line)} · removed
      </div>
    );
  }

  return (
    <div className="rounded border border-border bg-card">
      <div className="px-3 py-2 flex items-start gap-2">
        <button onClick={() => setExpanded((v) => !v)} className="mt-0.5 text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{describeLine({ ...line, data: merged })}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{line.reason}</p>
          {line.estimatedCost !== null && (
            <p className="text-[11px] text-primary tabular-nums mt-0.5">est ₹{line.estimatedCost.toFixed(2)} per part</p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={onRemove}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      {expanded && (
        <div className="border-t bg-muted/20 px-3 py-2 space-y-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {fields.map(({ path, label, type }) => (
              <label key={path} className="text-[11px]">
                <span className="text-muted-foreground">{label}</span>
                <Input
                  className="h-6 text-xs mt-0.5"
                  type={type === 'number' ? 'number' : 'text'}
                  value={merged[path] ?? ''}
                  onChange={(e) => {
                    const v = type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
                    onFieldChange(path, v);
                  }}
                />
              </label>
            ))}
          </div>

          {line.references.candidatesConsidered.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Candidates considered ({line.references.candidatesConsidered.length})
              </summary>
              <ul className="mt-1 ml-3 space-y-0.5">
                {line.references.candidatesConsidered.map((c) => (
                  <li key={c.candidateId} className={c.chosen ? 'text-primary font-medium' : 'text-muted-foreground'}>
                    {c.chosen ? '★ ' : '  '}{c.candidateId}: {c.label} (score {c.score})
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
