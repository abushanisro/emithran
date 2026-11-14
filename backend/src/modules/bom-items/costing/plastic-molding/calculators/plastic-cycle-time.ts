/**
 * The molding cycle time, computed by the stored calculators (plastic-molding-calculators.json, migration 975): the engine seeds each calculator's inputs from what it
 * holds (plastic-cycle-time-seeds.ts) and evaluates the calculator's own formulas with the evaluator the cost dialogs use, so the quote and the dialog cannot disagree.
 * The same arrangement as heat treatment, machining and die casting. No calculator in the database is a named gap, not a cycle: run migration 975.
 *
 * The result carries the run (inputs with their sources, every formula with its value), the registered formula behind each step (id, version, validation state), and a
 * fingerprint of the calculator's formulas, which a saved calculation records so that a replay can tell whether the same formulas are in force.
 */
import { createHash } from 'crypto';
import { runReferenceCalculator, type LookupMatch, type ReferenceCalculatorDef, type ReferenceCalculators } from '../../shared/calculators/reference-calculator';
import type { CalculationTraceStep } from '../../../dto/cost-breakdown.dto';
import { formulaById } from '../formula-registry';
import type { CycleTimeInput, CycleTimeResult } from '../process/cycle-time';
import { loadPlasticMoldingCalculatorSpec } from './plastic-molding-calculator-spec';
import { REGISTRY_FORMULA_OF_FIELD } from './plastic-calculator-formulas';
import { cadEvidenceKey } from '../../shared/cad-evidence';
import { deflashingSeeds, injectionCalculatorName, injectionCycleTimeSeeds, pressCycleTimeSeeds, rimCycleTimeSeeds, slideMovementSeeds, visualInspectionSeeds, weightCheckSeeds, materialDryingSeeds, MATERIAL_DRYING_CALCULATOR, type MaterialDryingInput, COMPRESSION_CALCULATOR, DEFLASH_CALCULATOR, RIM_CALCULATOR, SLIDE_MOVEMENT_CALCULATOR, VISUAL_INSPECTION_CALCULATOR, WEIGHT_CHECK_CALCULATOR } from './plastic-cycle-time-seeds';
import type { WeightCheckReference } from '../reference/im-reference';

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

/**
 * The trace with each step tied to the registered formula behind it, when there is one (its id, version and validation state travel with the number), and each input
 * measured on the part's CAD faces carrying the evidence key the cost dialog uses to show only those faces (cad-evidence.ts: the input's source must be CAD extraction).
 */
export function withRegistryFormulas(trace: readonly CalculationTraceStep[], calculatorName: string): CalculationTraceStep[] {
  const ids = REGISTRY_FORMULA_OF_FIELD[keyOf(calculatorName) ?? ''] ?? {};
  return trace.map((t) => {
    const f = ids[t.fieldName] ? formulaById(ids[t.fieldName]!) : undefined;
    const evidence = t.kind === 'input' ? cadEvidenceKey(t.fieldName, t.source ?? undefined) : undefined;
    return { ...t, ...(f ? { formulaId: f.id, formulaVersion: f.version, state: f.state } : {}), ...(evidence ? { evidence } : {}) };
  });
}

/** The migrations that create and update the plastic-molding calculators: what to apply to a database that lacks them or holds an older version. */
export const PLASTIC_CALCULATOR_MIGRATIONS = '975, 976, 977, 1007, 1008, 1010, 1012, 1013 and 1014';

/**
 * The stored calculator of a name, when it is in the database AND is the version this engine was written for; otherwise why not. A calculator that is not there means the
 * migrations were not applied to this database; one older than the engine expects (the reaction injection calculator at version 1, without the fill time) would compute a
 * cycle without what the engine now seeds, so it is refused, never run quietly.
 */
export function requirePlasticCalculator(calculators: ReferenceCalculators | null | undefined, name: string): { def: ReferenceCalculatorDef } | { problem: string } {
  const def = calculators?.[name];
  if (!def) {
    return { problem: `the stored calculator "${name}" is not in this database: migrations ${PLASTIC_CALCULATOR_MIGRATIONS} (the plastic molding cycle-time calculators) have not been applied to it, so no cycle time can be computed (run npm run db:migrate)` };
  }
  const wanted = loadPlasticMoldingCalculatorSpec().calculators.find((c) => c.name === name)?.version ?? 1;
  if ((def.version ?? 1) < wanted) {
    return { problem: `the stored calculator "${name}" in this database is version ${def.version ?? 1}, and this engine needs version ${wanted}: migrations ${PLASTIC_CALCULATOR_MIGRATIONS} have not all been applied to it (run npm run db:migrate)` };
  }
  return { def };
}

/** The cycle time of an injection, structural foam or LSR molding, by the stored calculator; or the inputs and the calculator that are missing. */
export function runInjectionCycleTime(input: CycleTimeInput, calculators: ReferenceCalculators | null | undefined, process: 'injection' | 'structural_foam'): CycleTimeResult {
  const seeded = injectionCycleTimeSeeds(input);
  if ('missing' in seeded) return { derivable: false, missing: seeded.missing };
  const name = injectionCalculatorName(input.isLsr, process);
  const found = requirePlasticCalculator(calculators, name);
  if ('problem' in found) return { derivable: false, missing: [found.problem], calculatorProblem: found.problem };
  const def = found.def;
  const run = runReferenceCalculator(calculators, name, seeded.seeds);
  if (run.missing.length > 0 || run.value == null) return { derivable: false, missing: run.missing.length > 0 ? run.missing : [`${name} produced no cycle time`] };
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
    lookups: run.lookups,
    calculator: { id: run.calculatorId, version: run.calculatorVersion, name, fingerprint: calculatorFingerprint(def) },
  };
}

/** What a compression or reaction injection cycle needs from its calculator: the cycle (s) and the run, or why there is none. */
export type PressCycle =
  | { derivable: true; cycleSec: number; trace: CalculationTraceStep[]; lookups: Record<string, LookupMatch>; calculator: { id: string | null; version: number | null; name: string; fingerprint: string } }
  | { derivable: false; missing: string[]; /** Set when the stored calculator itself is absent or too old: the migrations to apply, not data to add. */ calculatorProblem?: string };

function runPress(name: string, seeded: ReturnType<typeof pressCycleTimeSeeds>, calculators: ReferenceCalculators | null | undefined): PressCycle {
  if ('missing' in seeded) return { derivable: false, missing: seeded.missing };
  const found = requirePlasticCalculator(calculators, name);
  if ('problem' in found) return { derivable: false, missing: [found.problem], calculatorProblem: found.problem };
  const def = found.def;
  const run = runReferenceCalculator(calculators, name, seeded.seeds);
  if (run.missing.length > 0 || run.value == null) return { derivable: false, missing: run.missing.length > 0 ? run.missing : [`${name} produced no cycle time`] };
  return { derivable: true, cycleSec: run.value, trace: withRegistryFormulas(run.trace, name), lookups: run.lookups, calculator: { id: run.calculatorId, version: run.calculatorVersion, name, fingerprint: calculatorFingerprint(def) } };
}

/** The cycle of a compression press (press open/close time plus cure time), by the stored calculator. */
export function runCompressionCycleTime(input: Parameters<typeof pressCycleTimeSeeds>[0], calculators: ReferenceCalculators | null | undefined): PressCycle {
  return runPress(COMPRESSION_CALCULATOR, pressCycleTimeSeeds(input), calculators);
}

/** The time to trim the flash off the parting line by hand (length / rate), by the stored calculator. */
export function runDeflashingTime(input: { partingLineLengthMm: number | null; rateMmPerS: number | null }, calculators: ReferenceCalculators | null | undefined): PressCycle {
  return runPress(DEFLASH_CALCULATOR, deflashingSeeds(input), calculators);
}

/** The time the hydraulic slides add to each part (F-32), by the stored slide movement calculator, or what is missing. */
export function runSlideMovementTime(input: { slideStrokeMm: number | null; rateMmPerS: number | null; cavities: number }, calculators: ReferenceCalculators | null | undefined): PressCycle {
  return runPress(SLIDE_MOVEMENT_CALCULATOR, slideMovementSeeds(input), calculators);
}

/** The visual inspection time per part (F-34), by the stored visual inspection calculator, or what is missing. */
export function runVisualInspectionTime(input: { surfaceAreaMm2: number | null; minPerM2: number | null; percent: number | null }, calculators: ReferenceCalculators | null | undefined): PressCycle {
  return runPress(VISUAL_INSPECTION_CALCULATOR, visualInspectionSeeds(input), calculators);
}

/** The material drying (F-36): the press time per part and the dryer's hourly cost, by the stored material drying calculator, or what is missing. */
export function runMaterialDrying(input: MaterialDryingInput, calculators: ReferenceCalculators | null | undefined): PressCycle & { dryerHourlyUsd?: number } {
  const run = runPress(MATERIAL_DRYING_CALCULATOR, materialDryingSeeds(input), calculators);
  if (!run.derivable) return run;
  const rate = run.trace.find((t) => t.fieldName === 'Dryer Hourly Cost')?.value;
  return typeof rate === 'number' ? { ...run, dryerHourlyUsd: rate } : { derivable: false, missing: ['the dryer hourly cost (Dryer Hourly Cost)'] };
}

/** The weight check time per part and the scale's hourly rate (F-35), by the stored weight check calculator, or what is missing. */
export function runWeightCheck(ref: WeightCheckReference, calculators: ReferenceCalculators | null | undefined): PressCycle & { scaleRateUsdPerHr?: number } {
  const run = runPress(WEIGHT_CHECK_CALCULATOR, weightCheckSeeds(ref), calculators);
  if (!run.derivable) return run;
  const rate = run.trace.find((t) => t.fieldName === 'Scale Rate')?.value;
  return typeof rate === 'number' ? { ...run, scaleRateUsdPerHr: rate } : { derivable: false, missing: ['the scale rate (Scale Rate)'] };
}

/** The cycle of a reaction injection molding (dry cycle + fill + cure time), by the stored calculator. */
export function runRimCycleTime(
  input: Parameters<typeof rimCycleTimeSeeds>[0],
  calculators: ReferenceCalculators | null | undefined,
): PressCycle {
  return runPress(RIM_CALCULATOR, rimCycleTimeSeeds(input), calculators);
}
