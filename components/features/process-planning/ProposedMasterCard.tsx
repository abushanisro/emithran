'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, X, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProposedMaster } from '@/lib/api/hooks/useProcessPlanGenerate';

interface Props {
  master: ProposedMaster;
  approved: boolean;
  onChange: (approved: boolean) => void;
}

function BRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex items-start justify-between py-0.5 ${highlight ? 'font-semibold text-foreground border-t border-border mt-0.5 pt-1' : 'text-muted-foreground'}`}>
      <span className="text-[10px] leading-tight pr-2">{label}</span>
      <span className={`text-[10px] tabular-nums font-mono whitespace-nowrap ${highlight ? 'text-primary' : ''}`}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-dashed border-border/60 my-1" />;
}

function MaterialDetails({ data }: { data: any }) {
  return (
    <div className="space-y-0">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Master Record — Raw Material</p>
      <BRow label={<><Database className="h-2.5 w-2.5 text-blue-500 inline mr-1" />Material group</>  as any} value={data.materialGroup ?? '—'} />
      <BRow label="Material" value={data.material ?? '—'} />
      <BRow label="Grade / spec" value={data.grade ?? '—'} />
      <Divider />
      <BRow label="Density" value={data.densityKgPerM3 != null ? `${data.densityKgPerM3} kg/m³` : '—'} />
      <BRow label="Unit cost" value={data.unitCostInrPerKg != null ? `₹${data.unitCostInrPerKg}/kg` : '—'} />
      <BRow label="Location" value={data.location ?? 'India-Bangalore'} />
    </div>
  );
}

function ProcessDetails({ data }: { data: any }) {
  return (
    <div className="space-y-0">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Master Record — Process Mapping</p>
      <BRow label="Process group" value={data.processGroup ?? '—'} />
      <BRow label="Process route" value={data.processRoute ?? '—'} />
      <BRow label="Operation" value={data.operation ?? '—'} />
      <Divider />
      <BRow label="Destination table" value="process_calculator_mappings" />
    </div>
  );
}

export function ProposedMasterCard({ master, approved, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const data = master.data as any;
  const isProcess = master.kind === 'process';

  const headline = isProcess
    ? `${data.processGroup ?? '—'} › ${data.processRoute ?? '—'} › ${data.operation ?? '—'}`
    : `${data.material ?? '—'}${data.grade ? ` (${data.grade})` : ''}`;

  const meta = isProcess
    ? 'New process mapping'
    : `${data.densityKgPerM3 ?? '—'} kg/m³ · ₹${data.unitCostInrPerKg ?? '—'}/kg`;

  return (
    <div className={`rounded border bg-card transition-colors ${approved ? 'border-green-500/50' : 'border-border'}`}>
      {/* Header */}
      <div className="px-3 py-2 flex items-start gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-muted-foreground hover:text-foreground shrink-0"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            {isProcess ? 'Proposed process' : 'Proposed material'}
          </p>
          <p className="text-xs font-medium truncate mt-0.5">{headline}</p>
          <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{meta}</p>
          <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{master.reason}</p>
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-2">
          <Button
            size="sm"
            variant={approved ? 'default' : 'outline'}
            className="h-6 px-2 text-[11px]"
            onClick={() => onChange(true)}
          >
            <Check className="h-3 w-3 mr-1" /> Approve
          </Button>
          <Button
            size="sm"
            variant={!approved ? 'secondary' : 'ghost'}
            className="h-6 px-2 text-[11px]"
            onClick={() => onChange(false)}
          >
            <X className="h-3 w-3 mr-1" /> Skip
          </Button>
        </div>
      </div>

      {/* Expandable detail */}
      {expanded && (
        <div className="border-t bg-muted/10 px-3 py-2">
          {isProcess ? <ProcessDetails data={data} /> : <MaterialDetails data={data} />}
        </div>
      )}
    </div>
  );
}
