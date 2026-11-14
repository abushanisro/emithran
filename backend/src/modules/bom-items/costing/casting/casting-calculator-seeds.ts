// Seeds for the die-casting calculators (calculators/die-casting-calculators.json).
// The engine never computes a die-casting formula: it supplies each calculator's
// inputs from their real source -- a CAD measurement, the alloy's materials_master
// column, the selected machine's HR Rates spec, a memory/Die Casting variable or
// lookup-table row (with the row identity, so the table viewer can highlight it),
// the scenario, or another calculator's output -- and the calculator computes.
import type { CalcRun, CalcSeed, ReferenceCalcRun } from '../shared/calculators/reference-calculator';
import type { CalculationTraceStep, CalculatorRunDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import type { CadEvidenceKey } from '../shared/cad-evidence';
import { CASTING_MATERIALS_TABLE, CASTING_VARIABLES_TABLE } from './calculators/die-casting-calculator-spec';

/** The reference-data domain of memory/Die Casting (processes/memory-reference-domains.json): its variables and staged lookup tables. */
export const DIE_CASTING_DOMAIN = 'die_casting';

/** A die-casting alloy's raw_materials record (material_group 'Die Casting'); id null when the record is not known, and then no ref. */
export interface AlloyRecord { id: string | null; name: string }

/** A machine's HR Rates record (mhr_records). */
export interface MachineRecord { id: string; name: string }

const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000);

/**
 * Each builder says where the value was read and, when that is something the calculator dialog can open (a SourceRef on the input's
 * trace step), exactly where: the variable, the staged table's column and row, the machine's or the alloy's record and column, the CAD
 * faces, or the run of the calculator that produced it.
 */
export const castingSeed = {
  /** `evidence`: only when the value is that whole-part CAD measurement (the part's volume, or its whole surface). */
  cad: (value: number, what: string, evidence?: CadEvidenceKey): CalcSeed => ({
    value, source: `CAD: ${what}`, ...(evidence ? { ref: { kind: 'cad', evidence } } : {}),
  }),
  /** `column`: the raw_materials column or raw_material_properties property_key the value is in; `label` names it for people. */
  alloy: (alloy: AlloyRecord, column: string, label: string, value: number): CalcSeed => ({
    value, source: `${alloy.name}: ${label} (memory/Die Casting materials_master)`, lookup: true,
    match: { table: CASTING_MATERIALS_TABLE, row: { Name: alloy.name } },
    ...(alloy.id ? { ref: { kind: 'material', materialId: alloy.id, materialName: alloy.name, column } } : {}),
  }),
  variable: (name: string, value: number): CalcSeed => ({
    value, source: `variables ${name} = ${fmt(value)} (memory/Die Casting)`, lookup: true,
    match: { table: CASTING_VARIABLES_TABLE, row: { 'Variable Name': name } },
    ref: { kind: 'variable', domain: DIE_CASTING_DOMAIN, name },
  }),
  /** A row of a staged lookup table: `table` is its staged key, `column` and `row` its real headers; `domain` when it is not memory/Die Casting's. */
  lookup: (table: string, column: string, value: number, row: Record<string, string | number>, domain: string = DIE_CASTING_DOMAIN): CalcSeed => ({
    value,
    source: `${table} ${column} (${Object.entries(row).map(([k, v]) => `${k} ${v}`).join(', ')})`,
    lookup: true, match: { table, row },
    ref: { kind: 'lookup', domain, table, column, row },
  }),
  /** `column`: the mhr_records column or specs key the value is in; `label` names it for people. */
  machine: (machine: MachineRecord, column: string, label: string, value: number): CalcSeed => ({
    value, source: `${machine.name}: ${label} (HR Rates)`,
    ref: { kind: 'machine', machineId: machine.id, machineName: machine.name, column },
  }),
  scenario: (value: number, what: string): CalcSeed => ({ value, source: `Scenario: ${what}` }),
  engine: (value: number, why: string): CalcSeed => ({ value, source: why }),
  /** Another calculator's output; given its run, the steps that produced it (and the CAD faces they rest on, if any). */
  calculator: (value: number, calculatorName: string, run?: { trace: CalculationTraceStep[] }, evidence: CadEvidenceKey | null = null): CalcSeed => ({
    value, source: `${calculatorName} calculator`,
    ...(run ? { ref: { kind: 'calculation', name: calculatorName, evidence, steps: run.trace } } : {}),
  }),
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
