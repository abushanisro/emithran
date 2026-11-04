/**
 * The metal balance and the bill of the cost of one sand casting, read from what the route computed (the calculator runs' traces and the cost summary): nothing
 * is recomputed here, and a figure the route did not give is left out rather than filled in. Pure, so it is tested.
 *
 * Metal: the casting (net weight) plus the gates and risers (poured weight - net) is what is poured; the furnace loses a share of it as melt loss; the part of
 * the gates and risers the plant remelts (the remelt allowance) goes back to the furnace and is not bought. Bought = net + melt loss + the gates and risers
 * not remelted ("Sand Casting - Material cost", formula "Bought Weight").
 */
import type { CalculationTraceStep, ProcessLineCost } from '@/lib/api/hooks/useBOMItems';
import type { CalculatorRun } from '@/lib/costing/sand-calculations';

export interface MetalBalance {
  netKg: number;
  /** Gates and risers poured with the casting. */
  gatesAndRisersKg: number;
  pouredKg: number;
  meltLossKg: number;
  /** The part of the gates and risers the plant remelts, which goes back to the furnace and is not bought. */
  returnedKg: number;
  boughtKg: number;
  /** Casting weight as a percentage of the poured weight. */
  yieldPct: number;
  /** Bought weight minus the sum of its parts: zero when the balance closes. */
  residualKg: number;
}

const valueOf = (trace: readonly CalculationTraceStep[] | undefined, field: string): number | null => {
  const v = trace?.find((s) => s.displayLabel === field || s.fieldName === field)?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** The balance from the material-cost run's trace; null when the route has no such run or it lacks a figure. */
export function metalBalance(runs: Record<string, CalculatorRun> | undefined): MetalBalance | null {
  const trace = runs?.['Sand material cost']?.trace;
  const net = valueOf(trace, 'Net Weight');
  const poured = valueOf(trace, 'Poured Weight');
  const melt = valueOf(trace, 'Melt Loss');
  const bought = valueOf(trace, 'Bought Weight');
  const allowance = valueOf(trace, 'Remelt Allowance');
  if (net == null || poured == null || melt == null || bought == null || allowance == null || !(poured > 0)) return null;
  const gates = poured - net;
  const returned = gates * Math.min(Math.max(allowance, 0), 1);
  return {
    netKg: net,
    gatesAndRisersKg: gates,
    pouredKg: poured,
    meltLossKg: melt,
    returnedKg: returned,
    boughtKg: bought,
    yieldPct: (100 * net) / poured,
    residualKg: bought - (net + melt + (gates - returned)),
  };
}

export interface CostBom {
  /** The metal bought, with its cost per good casting. */
  material: { boughtKg: number | null; cost: number };
  /** The route's steps. */
  process: { process: string; cost: number }[];
  /** Core-box tooling per part, when costed: beside the piece cost, not in it (as on a die-cast route). */
  tooling: number | null;
  /** The piece cost: material and process. */
  total: number;
  /** The summary's total minus material and process: within a cent (rounding) when the bill is whole. */
  residual: number;
}

/** The material and process lines (and the tooling beside them) with the summary's own total and what is left over, so a line that is missing or counted twice shows. */
export function costBom(args: {
  materialCost: number;
  boughtKg: number | null;
  processLines: readonly Pick<ProcessLineCost, 'process' | 'totalCost'>[];
  toolingPerPart: number | null;
  totalCost: number;
}): CostBom {
  const process = args.processLines.map((l) => ({ process: l.process, cost: l.totalCost }));
  const sum = args.materialCost + process.reduce((s, l) => s + l.cost, 0);
  return {
    material: { boughtKg: args.boughtKg, cost: args.materialCost },
    process,
    tooling: args.toolingPerPart,
    total: args.totalCost,
    residual: args.totalCost - sum,
  };
}
