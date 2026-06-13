'use client';

import { Info } from 'lucide-react';
import type { GenerationResponse } from '@/lib/api/hooks/useProcessPlanGenerate';

export function OutOfScopeNotice({ generation }: { generation: GenerationResponse }) {
  return (
    <div className="rounded border border-blue-500/40 bg-blue-500/5 px-3 py-3">
      <div className="flex gap-2">
        <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-xs space-y-1.5">
          <p className="font-medium">This part is outside Phase 1 AI scope.</p>
          <p className="text-muted-foreground">{generation.scopeDecision.reason}</p>
          <p className="text-muted-foreground">
            Phase 1 covers CNC turning, CNC milling, and sheet metal child parts.
            Castings, forgings, composites, welded fabrications, and assemblies are coming in Phase 2.
          </p>
          <p className="text-muted-foreground">
            No credits were charged for this generation. Use the deterministic Auto-Fill on this part, or add the rows manually below.
          </p>
        </div>
      </div>
    </div>
  );
}
