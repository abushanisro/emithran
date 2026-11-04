'use client';

import { CalculationTracePanel } from '@/components/features/process-planning/CalculationTracePanel';
import { type CalculationEntry } from '@/lib/costing/sand-calculations';

/** Every calculation behind the sand-casting cost: the formula, each input and where it came from. Read-only. */
export function SandCalculationsPanel({ entries }: { entries: CalculationEntry[] }) {
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">No calculations yet: the route has not been built.</p>;
  return (
    <div className="space-y-2">
      {entries.map((e) => (
        <details key={e.key} className="rounded border border-border/50 px-2 py-1">
          <summary className="cursor-pointer text-xs flex items-baseline justify-between gap-2">
            <span className="font-medium truncate min-w-0">{e.title}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {e.kind}{e.result ? ` · ${e.result}` : ''}
            </span>
          </summary>
          <div className="pt-1.5 space-y-1.5">
            {e.noTraceReason ? (
              <p className="text-[10px] text-muted-foreground leading-tight">{e.noTraceReason}</p>
            ) : (
              <CalculationTracePanel line={{
                calculationTrace: e.trace,
                ...(e.calculatorId ? { calculatorId: e.calculatorId } : {}),
                ...(e.calculatorVersion != null ? { calculatorVersion: e.calculatorVersion } : {}),
              }} />
            )}
            {e.missing.length > 0 && (
              <p className="text-[10px] text-amber-600 dark:text-amber-500 leading-tight">Could not resolve: {e.missing.join(', ')}</p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
