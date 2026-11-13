'use client';

import { alternativeRows, type SandRouteAlternative } from '@/lib/costing/sand-alternatives';

export interface SandCastingBreakdown {
  mouldingProcess: string;
  mouldingMachine: string;
  cavities: number;
  coresMade: number;
  coresLeftSolid: number;
  complete: boolean;
  measuredBy: 'casting analysis' | 'cad-engine';
  /** Every moulding machine the route was tried on, compared with the chosen one. */
  alternatives?: SandRouteAlternative[];
}

/** What the sand route decided: the moulding machine it was costed with, how the part was measured, cavities and cores, and the other machines compared. */
export function SandRouteSummary({ route }: { route: SandCastingBreakdown }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[11px]"><span className="text-muted-foreground">Costed with</span><span className="font-medium text-right">{route.mouldingProcess} · {route.mouldingMachine}</span></div>
      <div className="flex items-center justify-between text-[11px]"><span className="text-muted-foreground">Measured by</span><span className="font-medium">{route.measuredBy === 'casting analysis' ? 'casting analysis (exact solid)' : 'cad-engine'}</span></div>
      <div className="flex items-center justify-between text-[11px]"><span className="text-muted-foreground">Cavities</span><span className="font-medium">{route.cavities}</span></div>
      <div className="flex items-center justify-between text-[11px]"><span className="text-muted-foreground">Cores</span><span className="font-medium">{route.coresMade}{route.coresLeftSolid > 0 ? ` (+${route.coresLeftSolid} left solid, machined later)` : ''}</span></div>
      {!route.complete && <p className="text-[10px] text-amber-600 dark:text-amber-500 leading-tight">Incomplete: a step no machine can do is shown as a gap and left out of the total.</p>}
      {(route.alternatives?.length ?? 0) > 1 && (
        <details className="pt-1">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">Compare moulding machines ({route.alternatives?.length ?? 0})</summary>
          <div className="max-h-48 overflow-y-auto pt-1 space-y-0.5">
            {alternativeRows(route.alternatives).map((r) => (
              <div key={r.key} className="text-[10px] leading-tight" title={r.note ?? undefined}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate min-w-0 ${r.chosen ? 'font-medium' : ''}`}>{r.chosen ? '✓ ' : ''}{r.machine} <span className="text-muted-foreground">· {r.process}{r.cavities != null ? ` · ${r.cavities} cav` : ''}</span></span>
                  <span className="tabular-nums shrink-0">
                    {r.total != null ? r.total.toFixed(2) : '—'}
                    {r.difference && <span className="text-muted-foreground"> ({r.difference.amount >= 0 ? '+' : ''}{r.difference.amount.toFixed(2)}, {r.difference.percent >= 0 ? '+' : ''}{r.difference.percent.toFixed(1)}%)</span>}
                  </span>
                </div>
                {r.note && <div className="text-amber-600 dark:text-amber-500 truncate">{r.note}</div>}
              </div>
            ))}
          </div>
        </details>
      )}
      <p className="text-[10px] text-muted-foreground/60 leading-tight pt-0.5">
        Core boxes are costed over annual volume × production life; patterns and sand are not costed.
      </p>
    </div>
  );
}
