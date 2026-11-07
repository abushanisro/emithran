// What each cost driver is worth, by asking the cost engine. For a driver the engine reads, the engine is run again on the same part with only that driver moved one step, and the
// difference per part is reported by cost line (material, each process line, mold). A driver whose step changes nothing is reported as zero: that is the proof it is not priced,
// not an estimate. The engine prices each line to the cent per part, so a change under a cent can read as 0 or 1 cent. Pure: the engine is, so this needs nothing but the input it was given.
import type { EngineResultLike } from './cost-driver-sensitivity.types';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from './process/cost-injection-molding-engine';

export interface DriverImpactLine { line: string; deltaPerPart: number }

export interface DriverImpact {
  /** The name of the driver in plastic-cost-drivers.ts. */
  driver: string;
  /** The step that was tried, in words ("+10 %", "+1 feature"). */
  step: string;
  baselineValue: number;
  variantValue: number;
  unit: string;
  /** Change of the manufacturing cost per part (material + process + mold), in the summary currency, for the step. */
  deltaPerPart: number;
  /** The cost lines that moved, largest first; empty when none did. */
  lines: DriverImpactLine[];
}

type Money = { total: number; byLine: Map<string, number> };

/** The per-part money of a result, by line: material, every process line, the mold. The same three the cost view adds up. */
function moneyOf(result: EngineResultLike): Money {
  const byLine = new Map<string, number>();
  byLine.set('Material', result.materialCost ?? 0);
  for (const l of result.processLines ?? []) byLine.set(l.operation ?? l.process ?? 'Process', (byLine.get(l.operation ?? l.process ?? 'Process') ?? 0) + (l.totalCost ?? 0));
  if (result.tooling) byLine.set('Mold (amortised)', result.tooling.moldCostPerPartUsd ?? 0);
  let total = 0;
  for (const v of byLine.values()) total += v;
  return { total, byLine };
}

interface Probe {
  driver: string;
  unit: string;
  /** The step in words, for the part's own value (a threshold driver steps across its threshold, when it is not already past it). */
  step: (i: InjectionMoldingCostInput) => string;
  read: (i: InjectionMoldingCostInput) => number | null;
  apply: (i: InjectionMoldingCostInput) => InjectionMoldingCostInput;
}

const PCT = 1.1;
const withSignals = (i: InjectionMoldingCostInput, s: Partial<NonNullable<InjectionMoldingCostInput['signals']>>): InjectionMoldingCostInput => ({ ...i, signals: { ...(i.signals ?? {}), ...s } as InjectionMoldingCostInput['signals'] });

/** The drivers the engine's input holds, each moved one step. A driver with no input in the engine has no probe. */
const PROBES: Probe[] = [
  { driver: 'Part volume', unit: 'mm³', step: () => '+10 %', read: (i) => i.volume, apply: (i) => ({ ...i, volume: i.volume * PCT }) },
  { driver: 'Surface area', unit: 'mm²', step: () => '+10 %', read: (i) => i.surfaceArea, apply: (i) => ({ ...i, surfaceArea: i.surfaceArea * PCT }) },
  { driver: 'Nominal wall thickness', unit: 'mm', step: () => '+10 %', read: (i) => i.wallThicknessNominalMm, apply: (i) => ({ ...i, wallThicknessNominalMm: i.wallThicknessNominalMm * PCT }) },
  { driver: 'Footprint (two longest sides)', unit: 'mm²', step: () => '+10 %', read: (i) => i.signals?.projectedAreaMm2 ?? null, apply: (i) => withSignals(i, { projectedAreaMm2: (i.signals?.projectedAreaMm2 ?? 0) * PCT }) },
  // The mold class rises above 2 undercut features and above a parting complexity of 0.6 (cost-injection-molding-engine.ts recommendMoldClass): a part already past a
  // threshold is stepped by one feature / 0.1, a part below it is stepped across it, which is what the step is worth to this part.
  { driver: 'Undercut features', unit: 'pcs', step: (i) => ((i.signals?.undercutCount ?? 0) <= 2 ? 'to 3 features (the mold class rises)' : '+1 feature'), read: (i) => i.signals?.undercutCount ?? null,
    apply: (i) => withSignals(i, { undercutCount: (i.signals?.undercutCount ?? 0) <= 2 ? 3 : (i.signals?.undercutCount ?? 0) + 1 }) },
  { driver: 'Parting complexity', unit: '0-1', step: (i) => ((i.signals?.partingComplexity ?? 0) <= 0.6 ? 'to 0.61 (the mold class rises)' : '+0.1'), read: (i) => i.signals?.partingComplexity ?? null,
    apply: (i) => withSignals(i, { partingComplexity: (i.signals?.partingComplexity ?? 0) <= 0.6 ? 0.61 : Math.min(1, (i.signals?.partingComplexity ?? 0) + 0.1) }) },
];

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** The impact of each driver the engine reads, against the result the part's cost summary already holds. A driver with no value on this part is skipped. */
export function driverImpacts(input: InjectionMoldingCostInput, baseline: EngineResultLike): DriverImpact[] {
  const base = moneyOf(baseline);
  const out: DriverImpact[] = [];
  for (const p of PROBES) {
    const value = p.read(input);
    if (value == null || !Number.isFinite(value) || value <= 0 && p.driver !== 'Parting complexity') continue;
    const variantInput = p.apply(input);
    const variantValue = p.read(variantInput);
    if (variantValue == null || variantValue === value) continue;
    const money = moneyOf(computeInjectionMoldedCostSummary(variantInput) as unknown as EngineResultLike);
    const lines: DriverImpactLine[] = [];
    for (const k of new Set([...base.byLine.keys(), ...money.byLine.keys()])) {
      const d = (money.byLine.get(k) ?? 0) - (base.byLine.get(k) ?? 0);
      if (Math.abs(d) >= 5e-5) lines.push({ line: k, deltaPerPart: r4(d) });
    }
    lines.sort((a, b) => Math.abs(b.deltaPerPart) - Math.abs(a.deltaPerPart));
    out.push({ driver: p.driver, step: p.step(input), unit: p.unit, baselineValue: value, variantValue, deltaPerPart: r4(money.total - base.total), lines });
  }
  return out;
}
