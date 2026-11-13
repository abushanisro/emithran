'use client';

import { metalBalance } from '@/lib/costing/sand-balance';
import type { CalculatorRun } from '@/lib/costing/sand-calculations';

const kg = (v: number) => `${(Math.round(v * 1000) / 1000).toString()} kg`;
const row = 'flex items-baseline justify-between gap-2 text-[11px]';

/** The metal of one sand casting, as the route computed it: what is poured, lost and remelted, and what is bought. Nothing when the route has no material-cost run. */
export function SandMetalBalance({ runs }: { runs: Record<string, CalculatorRun> | undefined }) {
  const metal = metalBalance(runs);
  if (!metal) return null;
  return (
    <div className="space-y-0.5" title="From the material-cost calculator: bought = casting + melt loss + the gates and risers not remelted.">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Metal per casting</div>
      <div className={row}><span>Casting (net)</span><span className="tabular-nums">{kg(metal.netKg)}</span></div>
      <div className={row}><span>Gates and risers</span><span className="tabular-nums">{kg(metal.gatesAndRisersKg)}</span></div>
      <div className={`${row} font-medium`}><span>Poured ({metal.yieldPct.toFixed(1)} % casting)</span><span className="tabular-nums">{kg(metal.pouredKg)}</span></div>
      <div className={row}><span>Melt loss</span><span className="tabular-nums">{kg(metal.meltLossKg)}</span></div>
      <div className={row}><span>Gates and risers remelted (not bought)</span><span className="tabular-nums">−{kg(metal.returnedKg)}</span></div>
      <div className={`${row} font-medium`}><span>Metal bought</span><span className="tabular-nums">{kg(metal.boughtKg)}</span></div>
      {Math.abs(metal.residualKg) > 1e-6 && (
        <p className="text-[10px] text-amber-600 dark:text-amber-500 leading-tight">The balance does not close: {kg(metal.residualKg)} left over.</p>
      )}
    </div>
  );
}
