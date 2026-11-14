'use client';

export interface SandCastingBreakdown {
  mouldingProcess: string;
  mouldingMachine: string;
  cavities: number;
  coresMade: number;
  coresLeftSolid: number;
  complete: boolean;
  measuredBy: 'casting analysis' | 'cad-engine';
}

/** The moulding line's detail (its row shows the machine and, under Why this machine, the moulding machines compared): how the part was measured, cavities and cores. */
export function SandMouldingDetail({ route }: { route: SandCastingBreakdown }) {
  return (
    <div className="space-y-0.5 pt-1">
      <div className="flex items-center justify-between text-[11px]"><span className="text-muted-foreground">Measured by</span><span className="font-medium">{route.measuredBy === 'casting analysis' ? 'casting analysis (exact solid)' : 'cad-engine'}</span></div>
      <div className="flex items-center justify-between text-[11px]"><span className="text-muted-foreground">Cavities</span><span className="font-medium">{route.cavities}</span></div>
      <div className="flex items-center justify-between text-[11px]"><span className="text-muted-foreground">Cores</span><span className="font-medium">{route.coresMade}{route.coresLeftSolid > 0 ? ` (+${route.coresLeftSolid} left solid, machined later)` : ''}</span></div>
      {!route.complete && <p className="text-[10px] text-amber-600 dark:text-amber-500 leading-tight">Incomplete: a step no machine can do is shown as a gap and left out of the total.</p>}
      <p className="text-[10px] text-muted-foreground/60 leading-tight pt-0.5">
        Core boxes are costed over annual volume × production life; patterns and sand are not costed.
      </p>
    </div>
  );
}
