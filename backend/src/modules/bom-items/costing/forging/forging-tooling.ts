// Closed-die hot forging: die amortisation per part (v1.1 6.11). Pure.
//
//   lifetime parts = annual volume x production life (years)
//   tool life      = <class>ToolLifeNumberOfParts (parts per tool before it is
//                    refurbished or replaced) x forging_tblToolCoating factor
//   die sets       = max(1, ceil(lifetime parts / tool life))
//   total tooling  = die cost + (die sets - 1) x replacement die cost
//   per part       = total tooling / lifetime parts
//
// The same structure as the die-casting Die Life calculator
// (casting/calculators/die-casting-calculators.json, "Dies Required").
//
// The die cost itself is not derived: memory/Forging holds die-cost bounds and
// CNC rates but not the build-up formula (v1.1 6.11), so the die cost and the
// replacement (refurbished or new) die cost are entered per quote (v1.1 D7).
// The staged min/max die-cost bounds say when a *calculated* cost "is not
// valid"; for an entered quote they are reported as a warning only.
// disableInvestmentAmortization (staged false) turns amortisation off.

import type { ForgingReference, ForgingVariable } from './forging-reference';
import type { TraceStep } from './forging-weights';

export type DieKind = 'press' | 'mechanicalPress' | 'hammer' | 'trim';

const TOOL_LIFE_KEY: Record<DieKind, ForgingVariable> = {
  press: 'pressToolLifeNumberOfParts',
  mechanicalPress: 'mechanicalPressToolLifeNumberOfParts',
  hammer: 'hammerToolLifeNumberOfParts',
  trim: 'trimToolLifeNumberOfParts',
};

/** Staged validity bounds for an entered die cost; null where memory gives none. */
const COST_BOUNDS: Record<DieKind, [ForgingVariable, ForgingVariable] | null> = {
  press: ['minFinishDieCost', 'maxFinishDieCost'],
  mechanicalPress: ['minFinishDieCost', 'maxFinishDieCost'],
  hammer: ['minFinishDieCost', 'maxFinishDieCost'],
  trim: ['minTrimDieCostWithOutMaterial', 'maxTrimDieCostWithOutMaterial'],
};

export type DieAmortisation =
  | {
      amortised: true;
      kind: DieKind;
      lifetimeParts: number;
      toolLifeParts: number;
      dieSets: number;
      totalToolingUsd: number;
      perPartUsd: number;
      trace: TraceStep[];
      warnings: string[];
    }
  | { amortised: false; kind: DieKind; reason: string; warnings: string[] };

export function amortiseForgingDie(input: {
  reference: ForgingReference;
  kind: DieKind;
  /** Entered die cost and replacement die cost (USD). */
  dieCostUsd: number | null;
  replacementDieCostUsd: number | null;
  /** forging_tblToolCoating Coating Type; 'None' is a staged row (factor 1). */
  coating: string | null;
  annualVolume: number | null;
  productionLifeYears: number | null;
}): DieAmortisation {
  const ref = input.reference;
  const warnings: string[] = [];
  const not = (reason: string): DieAmortisation => ({ amortised: false, kind: input.kind, reason, warnings });
  if (ref.switches.disableInvestmentAmortization) return not('disableInvestmentAmortization is true: tooling is not amortised to the part.');

  const { dieCostUsd: die, replacementDieCostUsd: repl, annualVolume: annual, productionLifeYears: years, coating } = input;
  const missing: string[] = [];
  if (!(die != null && die > 0)) missing.push('die cost (enter the quote: memory has no die cost build-up, v1.1 6.11)');
  if (repl == null || repl < 0) missing.push('replacement die cost (refurbish or new)');
  if (!(annual != null && annual > 0)) missing.push('annual volume');
  if (!(years != null && years > 0)) missing.push('production life (years)');
  const factor = coating != null ? ref.toolCoatingFactor.get(coating) : undefined;
  if (coating == null) missing.push("die coating (forging_tblToolCoating; 'None' if uncoated)");
  else if (factor == null) missing.push(`forging_tblToolCoating row for coating "${coating}"`);
  if (missing.length || die == null || repl == null || annual == null || years == null || coating == null || factor == null) {
    return not(`Die not amortised: missing ${missing.join('; ')}.`);
  }

  const bounds = COST_BOUNDS[input.kind];
  if (bounds) {
    const [lo, hi] = [ref.variables[bounds[0]], ref.variables[bounds[1]]];
    if (die < lo || die > hi) {
      warnings.push(`Entered die cost ${die} USD is outside ${bounds[0]} ${lo} to ${bounds[1]} ${hi} USD (memory's validity range for a calculated die cost).`);
    }
  }

  const lifeKey = TOOL_LIFE_KEY[input.kind];
  const lifetimeParts = annual * years;
  const toolLifeParts = ref.variables[lifeKey] * factor;
  const dieSets = Math.max(1, Math.ceil(lifetimeParts / toolLifeParts));
  const totalToolingUsd = die + (dieSets - 1) * repl;
  const perPartUsd = totalToolingUsd / lifetimeParts;
  return {
    amortised: true, kind: input.kind, lifetimeParts, toolLifeParts, dieSets, totalToolingUsd, perPartUsd, warnings,
    trace: [
      { label: 'Tool life', value: `${lifeKey} ${ref.variables[lifeKey]} × ${coating} ${factor} = ${toolLifeParts} parts` },
      { label: 'Die sets', value: `max(1, ceil(${lifetimeParts} / ${toolLifeParts})) = ${dieSets}` },
      { label: 'Tooling', value: `${die} + (${dieSets} − 1) × ${repl} = ${totalToolingUsd} USD; ${perPartUsd.toFixed(4)} USD per part` },
    ],
  };
}
