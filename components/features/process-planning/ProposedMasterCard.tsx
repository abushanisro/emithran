'use client';

import { AlertTriangle, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProposedMaster } from '@/lib/api/hooks/useProcessPlanGenerate';

interface Props {
  master: ProposedMaster;
  approved: boolean;
  onChange: (approved: boolean) => void;
}

export function ProposedMasterCard({ master, approved, onChange }: Props) {
  const data = master.data as any;
  const title =
    master.kind === 'raw_material'
      ? `${data.material} (${data.grade ?? '—'})`
      : `${data.processName} — ${data.processCategory}`;

  const subtitle =
    master.kind === 'raw_material'
      ? `density ${data.densityKgPerM3} kg/m³ · ₹${data.unitCostInrPerKg}/kg · ${data.location ?? '—'}`
      : `${data.machineType ?? '—'} · setup ${data.setupTimeMinutes}min · cycle ${data.cycleTimeMinutes}min · ${data.skillLevelRequired}`;

  return (
    <div className={`rounded border px-3 py-2 ${approved ? 'border-green-500/40 bg-green-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium">
            NEW {master.kind === 'raw_material' ? 'MATERIAL' : 'PROCESS'} · {title}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{subtitle}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Why: {master.reason}</p>
        </div>
        <div className="flex items-center gap-1">
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
    </div>
  );
}
