/**
 * The molding cycle time, computed by the stored calculators (plastic-molding-calculators.json, migration 975): the engine seeds each calculator's inputs from what it
 * holds (plastic-cycle-time-seeds.ts) and evaluates the calculator's own formulas with the evaluator the cost dialogs use, so the quote and the dialog cannot disagree.
 * The same arrangement as heat treatment, machining and die casting. No calculator in the database is a named gap, not a cycle: run migration 975.
 *
 * The result carries the run (inputs with their sources, every formula with its value), the registered formula behind each step (id, version, validation state), and a
 * fingerprint of the calculator's formulas, which a saved calculation records so that a replay can tell whether the same formulas are in force.
 */
import { createHash } from 'crypto';
import { runReferenceCalculator, type ReferenceCalculatorDef, type ReferenceCalculators } from '../../shared/calculators/reference-calculator';
import type { CalculationTraceStep } from '../../../dto/cost-breakdown.dto';
import { formulaById } from '../formula-registry';
import type { CycleTimeInput, CycleTimeResult } from '../process/cycle-time';
import { loadPlasticMoldingCalculatorSpec } from './plastic-molding-calculator-spec';
import { REGISTRY_FORMULA_OF_FIELD } from './plastic-calculator-formulas';
import { injectionCalculatorName, injectionCycleTimeSeeds, pressCycleTimeSeeds } from './plastic-cycle-time-seeds';

/** A fingerprint of a calculator's formulas and what feeds it: its calculated fields' formulas and its input fields' names and units, in order. */
export function calculatorFingerprint(def: ReferenceCalculatorDef): string {
  const hash = createHash('sha256');
  for (const f of [...def.fields].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))) {
    hash.update(`${f.field_name}|${f.field_type === 'calculated' ? 'calculated' : 'input'}|${f.unit ?? ''}|${f.field_type === 'calculated' ? String(f.default_value ?? '') : ''}\n`);
  }
  return hash.digest('hex').slice(0, 16);
}

/** The key of a calculator in the spec (for the registry mapping), by its name. */
function keyOf(name: string): string | undefined {
  return loadPlasticMoldingCalculatorSpec().calculators.find((c) => c.name === name)?.key;
}

/** The trace with each step tied to the registered formula behind it, when there is one: its id, version and validation state travel with the number. */
export function withRegistryFormulas(trace: readonly CalculationTraceStep[], calculatorName: string): CalculationTraceStep[] {
  const ids = REGISTRY_FORMULA_OF_FIELD[keyOf(calculatorName) ?? ''] ?? {};
  return trace.map((t) => {
    const f = ids[t.fieldName] ? formulaById(ids[t.fieldName]!) : undefined;
    return f ? { ...t, formulaId: f.id, formulaVersion: f.version, state: f.state } : t;
  });
}

/** The cycle time of an injection, structural foam or LSR molding, by the stored calculator; or the inputs and the calculator that are missing. */
export function runInjectionCycleTime(input: CycleTimeInput, calculators: ReferenceCalculators | null | undefined, process: 'injection' | 'structural_foam'): CycleTimeResult {
  const seeded = injectionCycleTimeSeeds(input);
  if ('missing' in seeded) return { derivable: false, missing: seeded.missing };
  const name = injectionCalculatorName(input.isLsr, process);
  const run = runReferenceCalculator(calculators, name, seeded.seeds);
  const def = calculators?.[name];
  if (run.missing.length > 0 || run.value == null || !def) return { derivable: false, missing: run.missing.length > 0 ? run.missing : [`${name} produced no cycle time`] };
  const cool = run.outputs[input.isLsr ? 'Cure Time' : 'Cooling Time'];
  const fill = run.outputs['Fill Time'];
  if (cool == null || fill == null) return { derivable: false, missing: [`${name} produced no ${cool == null ? 'cooling' : 'fill'} time`] };
  return {
    derivable: true,
    fillSec: fill,
    packSec: input.isLsr ? 0 : run.outputs['Pack Time'] ?? 0,
    coolSec: cool,
    moldMotionSec: seeded.seeds['Press Dry Cycle Time']!.value,
    totalCycleSec: run.value,
    trace: withRegistryFormulas(run.trace, name),
    calculator: { id: run.calculatorId, version: run.calculatorVersion, name, fingerprint: calculatorFingerprint(def) },
  };
}

/** What a compression or reaction injection cycle needs from its calculator: the cycle (s) and the run, or why there is none. */
export type PressCycle =
  | { derivable: true; cycleSec: number; trace: CalculationTraceStep[]; calculator: { id: string | null; version: number | null; name: string; fingerprint: string } }
  | { derivable: false; missing: string[] };

/** The cycle of a compression or reaction injection press (press or dry cycle plus cure time), by the stored calculator. */
export function runPressCycleTime(
  input: { pressCycleTimeS: number | null; cureTimeMin: number | null; process: 'compression' | 'rim' },
  calculators: ReferenceCalculators | null | undefined,
  name: string,
): PressCycle {
  const seeded = pressCycleTimeSeeds(input);
  if ('missing' in seeded) return { derivable: false, missing: seeded.missing };
  const run = runReferenceCalculator(calculators, name, seeded.seeds);
  const def = calculators?.[name];
  if (run.missing.length > 0 || run.value == null || !def) return { derivable: false, missing: run.missing.length > 0 ? run.missing : [`${name} produced no cycle time`] };
  return { derivable: true, cycleSec: run.value, trace: run.trace, calculator: { id: run.calculatorId, version: run.calculatorVersion, name, fingerprint: calculatorFingerprint(def) } };
}
