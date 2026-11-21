// The calculator plumbing of a domain's routes (Assembly, Part Assembly): a stored calculator's inputs seeded from the domain's variables,
// its lookup rows, the step's machine and the route's own values, each with where it came from; the calculator run; and a step priced on
// the cheapest capable machine of its class (selectAndCost). One kit, so every domain built on it traces its inputs the same way. Pure.
import { runReferenceCalculator, type CalcSeed, type ReferenceCalcRun, type ReferenceCalculatorDef } from './reference-calculator';
import { machineValue, type SandMachine } from '../../casting/sand/sand-machines';
import { seedsFor, type SeedProvider, type SeedProviders } from '../../casting/sand/sand-seeds';
import { selectAndCost, type CostedStep, type StepOutcome } from '../../casting/sand/sand-steps';

import type { DomainCalculatorSpec } from './domain-calculator-spec';
import type { CostContext } from '../../casting/casting-finishing';
import type { SandReference } from '../../casting/sand/sand-reference';

export type KitRow = Readonly<Record<string, unknown>>;

/** A number in a lookup row's column; null when the row or the value is missing. */
export const cell = (row: KitRow | null | undefined, col: string): number | null =>
  (row?.[col] != null && Number.isFinite(Number(row[col])) ? Number(row[col]) : null);

/** A step that cannot be priced, with why. */
export const fail = (...reasons: string[]): StepOutcome => ({ ok: false, reasons });

export interface RouteKitInput {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  machinesByClass: Readonly<Record<string, readonly SandMachine[]>>;
  batchSize: number;
  costContext: CostContext;
  /** The reference domain the variables and lookups belong to (their refs), and its name in a source text ("Assembly variable x"). */
  domain: string;
  domainLabel: string;
  /** The process group the steps' lines are filed under, and the HR Rates machine class of each process. */
  processGroup: string;
  processClass: Readonly<Record<string, string>>;
  /** What a step's time is per ("assembly", "weldment"), for its line's breakdown. */
  partName: string;
  /** The part's measurements, for the fields whose source is `cad` (keyed by the name before " ("); none when the domain has none. */
  cad?: Readonly<Record<string, CalcSeed | undefined>>;
  /** The part's material, for the fields whose source is `material` (a column of the material). */
  material?: SeedProvider;
}

/** How a step is priced when it is not on every machine of its class, or its line is filed under a route of its process. */
export interface StepOptions {
  /** The machines the step may run on (a route's own, say deep draw presses only); every machine of the process's class when absent. */
  machines?: readonly SandMachine[];
  /** The line's process route (memory's Hydroform:Hydroform Deep Draw); the process when absent. */
  processRoute?: string;
}

/** A calculator run with its result (`sec`: the run's finite Cycle Time, or its declared output), or why it has none. */
export type KitRun = { run: ReferenceCalcRun; sec: number } | { reasons: string[] };

export interface RouteKit {
  /** A domain variable as a seed, with its unit and where it came from; null when the domain has none of that name. */
  variable: SeedProvider;
  /** Runs a calculator of the spec on a machine (or none) with the route's own values and lookup rows; its run, or why it could not. */
  run: (calculator: string, machine: SandMachine | null, engine: Record<string, CalcSeed | undefined>, lookups?: Record<string, CalcSeed | undefined>) => KitRun;
  seed: (value: number, source: string) => CalcSeed;
  /** A lookup row's column as a seed that names the table, the row and the column (and outlines the row in the dialog). */
  lookupSeed: (table: string, row: KitRow | null | undefined, column: string, identity: readonly string[]) => CalcSeed | undefined;
  /** The calculator of a process: the spec's calculator that computes it. */
  calcOf: (process: string) => string;
  /** A process timed on a machine by its calculator, as a step outcome. */
  timed: (process: string, m: SandMachine, engine: Record<string, CalcSeed | undefined>, lookups?: Record<string, CalcSeed | undefined>, extra?: Partial<Extract<StepOutcome, { ok: true }>>) => StepOutcome;
  /** A process priced on the cheapest of its class's machines (or `options.machines`) that `evaluate` can time. */
  step: (process: string, evaluate: (m: SandMachine) => StepOutcome, criteria: string[], options?: StepOptions) => CostedStep;
}

export function routeKit(inp: RouteKitInput): RouteKit {
  const { ref, batchSize } = inp;
  const variable: SeedProvider = (name) => {
    const value = ref.number(name);
    const unit = ref.unit(name);
    return value == null ? null : { value, source: `${inp.domainLabel} variable ${name}${unit ? ` (${unit})` : ''}`, ref: { kind: 'variable', domain: inp.domain, name } };
  };
  // A spec source names its key with a description ("weld_length_mm (the weld's length)"): the key is the part before " (".
  const named = (values: Readonly<Record<string, CalcSeed | undefined>>): SeedProvider => (key) => values[key] ?? values[key.split(' (')[0].trim()] ?? null;
  const run: RouteKit['run'] = (calculator, machine, engine, lookups = {}) => {
    const calc = inp.spec.calculators.find((c) => c.name === calculator);
    if (!calc) return { reasons: [`${calculator} is not in the calculator spec`] };
    const providers: SeedProviders = {
      variable, engine: named(engine), lookup: named(lookups), scenario: named({ batch_size: { value: batchSize, source: 'batch size' } }),
      ...(inp.cad ? { cad: named(inp.cad) } : {}),
      ...(inp.material ? { material: inp.material } : {}),
      machine: (key) => {
        const value = machine ? machineValue(machine, key) : null;
        return value == null || !machine ? null : {
          value, source: `machine ${machine.name}: ${key}`,
          ref: { kind: 'machine', machineId: machine.id, machineName: machine.name, machineClass: machine.machineClass, location: machine.location, column: key },
        };
      },
    };
    const { seeds, missing } = seedsFor(calc, providers);
    if (missing.length) return { reasons: missing.map((m) => `${calculator}: ${m}`) };
    const result = runReferenceCalculator(inp.calculators, calculator, seeds, calc.output ?? 'Cycle Time');
    return result.value == null || !Number.isFinite(result.value) ? { reasons: result.missing.length ? result.missing : [`${calculator}: no finite result`] } : { run: result, sec: result.value };
  };
  const seed: RouteKit['seed'] = (value, source) => ({ value, source });
  const lookupSeed: RouteKit['lookupSeed'] = (table, row, column, identity) => {
    const value = cell(row, column);
    if (!row || value == null) return undefined;
    const id = Object.fromEntries(identity.map((c) => [c, row[c] as string | number]));
    return {
      value, source: `${table} (${identity.map((c) => `${c} ${String(row[c])}`).join(', ')}): ${column}`, lookup: true, match: { table, row: id },
      ref: { kind: 'lookup', domain: inp.domain, table, column, row: id },
    };
  };
  const calcOf: RouteKit['calcOf'] = (process) => inp.spec.calculators.find((c) => c.operations.includes(process))?.name ?? `${inp.domainLabel} - ${process}`;
  const timed: RouteKit['timed'] = (process, m, engine, lookups = {}, extra = {}) => {
    const r = run(calcOf(process), m, engine, lookups);
    return 'run' in r ? { ok: true, sec: r.sec, run: r.run, energyCostUsd: 0, notes: [], ...extra } : fail(...r.reasons);
  };
  const step: RouteKit['step'] = (process, evaluate, criteria, options = {}) => {
    const machineClass = inp.processClass[process];
    return selectAndCost({
      process, machineClass, machines: options.machines ?? inp.machinesByClass[machineClass] ?? [], evaluate, criteria,
      batchSize, costContext: inp.costContext, ref, partName: inp.partName, processGroup: inp.processGroup,
      ...(options.processRoute ? { processRoute: options.processRoute } : {}),
    });
  };
  return { variable, run, seed, lookupSeed, calcOf, timed, step };
}
