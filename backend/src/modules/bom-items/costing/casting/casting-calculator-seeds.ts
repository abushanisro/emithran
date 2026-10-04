// Seeds for the die-casting calculators (calculators/die-casting-calculators.json).
// The engine never computes a die-casting formula: it supplies each calculator's
// inputs from their real source -- a CAD measurement, the alloy's materials_master
// column, the selected machine's HR Rates spec, a memory/Die Casting variable or
// lookup-table row (with the row identity, so the table viewer can highlight it),
// the scenario, or another calculator's output -- and the calculator computes.
import type { CalcRun, CalcSeed, ReferenceCalcRun } from '../shared/calculators/reference-calculator';
import type { CalculatorRunDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import { CASTING_MATERIALS_TABLE, CASTING_VARIABLES_TABLE } from './calculators/die-casting-calculator-spec';

const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000);

export const castingSeed = {
  cad: (value: number, what: string): CalcSeed => ({ value, source: `CAD: ${what}` }),
  alloy: (alloyName: string, column: string, value: number): CalcSeed => ({
    value, source: `${alloyName}: ${column} (memory/Die Casting materials_master)`, lookup: true,
    match: { table: CASTING_MATERIALS_TABLE, row: { Name: alloyName } },
  }),
  variable: (name: string, value: number): CalcSeed => ({
    value, source: `variables ${name} = ${fmt(value)} (memory/Die Casting)`, lookup: true,
    match: { table: CASTING_VARIABLES_TABLE, row: { 'Variable Name': name } },
  }),
  lookup: (table: string, column: string, value: number, row: Record<string, string | number>): CalcSeed => ({
    value,
    source: `${table} ${column} (${Object.entries(row).map(([k, v]) => `${k} ${v}`).join(', ')})`,
    lookup: true, match: { table, row },
  }),
  machine: (machineName: string, key: string, value: number): CalcSeed => ({ value, source: `${machineName}: ${key} (HR Rates)` }),
  scenario: (value: number, what: string): CalcSeed => ({ value, source: `Scenario: ${what}` }),
  engine: (value: number, why: string): CalcSeed => ({ value, source: why }),
  calculator: (value: number, calculatorName: string): CalcSeed => ({ value, source: `${calculatorName} calculator` }),
};

/**
 * Collects seeds and names every input that has no real value -- the line then
 * says exactly what is missing instead of computing with a stand-in.
 */
export class SeedSet {
  readonly seeds: Record<string, CalcSeed> = {};
  readonly missing: string[] = [];

  /** Sets `field` when `value` is a finite number, else records `what` as missing. */
  put(field: string, value: number | null | undefined, make: (v: number) => CalcSeed, what: string): this {
    if (value == null || !Number.isFinite(value)) this.missing.push(what);
    else this.seeds[field] = make(value);
    return this;
  }

  with(extra: Record<string, CalcSeed>): Record<string, CalcSeed> {
    return { ...this.seeds, ...extra };
  }
}

/** The fields a process line carries from the calculator that computed it. */
export function runOnLine(run: CalcRun): Pick<ProcessLineCost, 'calculationTrace' | 'lookupMatches' | 'calculatorId' | 'calculatorVersion'> {
  return {
    calculationTrace: run.trace,
    ...(Object.keys(run.lookups).length ? { lookupMatches: run.lookups } : {}),
    ...(run.calculatorId ? { calculatorId: run.calculatorId } : {}),
    ...(run.calculatorVersion != null ? { calculatorVersion: run.calculatorVersion } : {}),
  };
}

/** A calculator run that is not a process line, for the summary calculatorRuns. */
export function runView(name: string, output: string, run: ReferenceCalcRun): CalculatorRunDto {
  return {
    calculatorId: run.calculatorId, calculatorVersion: run.calculatorVersion, name, output,
    value: run.value, trace: run.trace, lookupMatches: run.lookups, missing: run.missing,
  };
}
