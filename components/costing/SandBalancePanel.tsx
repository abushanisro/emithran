'use client';

import type { ProcessLineCost } from '@/lib/api/hooks/useBOMItems';
import { costBom, metalBalance } from '@/lib/costing/sand-balance';
import type { CalculatorRun } from '@/lib/costing/sand-calculations';

const kg = (v: number) => `${(Math.round(v * 1000) / 1000).toString()} kg`;
const money = (v: number) => v.toFixed(2);
const row = 'flex items-baseline justify-between gap-2 text-[11px]';

/** The metal balance and the cost bill of one sand casting, as the route computed them: material, process and tooling kept apart. */
export function SandBalancePanel({ runs, materialCost, processLines, toolingPerPart, totalCost }: {
  runs: Record<string, CalculatorRun> | undefined;
  materialCost: number;
  processLines: readonly ProcessLineCost[];
  toolingPerPart: number | null;
  totalCost: number;
}) {
  const metal = metalBalance(runs);
  const bom = costBom({ materialCost, boughtKg: metal?.boughtKg ?? null, processLines, toolingPerPart, totalCost });
  return (
    <div className="space-y-2">
      {metal && (
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
      )}
      <div className="space-y-0.5">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Cost per good casting</div>
        <div className={row}><span>Material{bom.material.boughtKg != null ? ` (${kg(bom.material.boughtKg)} bought)` : ''}</span><span className="tabular-nums">{money(bom.material.cost)}</span></div>
        {bom.process.map((l, i) => (
          <div key={`${i}:${l.process}`} className={row}><span className="truncate min-w-0">{l.process}</span><span className="tabular-nums">{money(l.cost)}</span></div>
        ))}
        <div className={`${row} font-medium`}><span>Piece cost</span><span className="tabular-nums">{money(bom.total)}</span></div>
        {bom.tooling != null && (
          <div className={row} title="Core-box tooling over the lifetime volume: beside the piece cost, not in it."><span>Tooling per part (separate)</span><span className="tabular-nums">{money(bom.tooling)}</span></div>
        )}
        {Math.abs(bom.residual) > 0.01 && (
          <p className="text-[10px] text-amber-600 dark:text-amber-500 leading-tight">The lines do not add up to the piece cost: {money(bom.residual)} left over.</p>
        )}
      </div>
    </div>
  );
}
