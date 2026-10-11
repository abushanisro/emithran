/**
 * Machining cycle times are computed BY the database calculators
 * (machining-calculators.json and its generated migration 804), evaluated by
 * the shared reference-calculator runner. These are the machining names for it.
 */
import {
  CYCLE_TIME_FIELD,
  runReferenceCalculator,
  type CalcRun,
  type CalcSeed,
  type LookupMatch,
  type ReferenceCalculatorDef,
  type ReferenceCalculatorField,
  type ReferenceCalculators,
} from '../../shared/calculators/reference-calculator';

export { CYCLE_TIME_FIELD };
export type { CalcRun, CalcSeed, LookupMatch };
export type MachiningCalculatorField = ReferenceCalculatorField;
/** Calculator per catalog operation name ("Drilling", "Rough Turning", ...). */
export type MachiningCalculators = ReferenceCalculators;

export function runMachiningCalculator(
  calculators: MachiningCalculators | null | undefined,
  operation: string,
  seeds: Record<string, CalcSeed>,
): CalcRun {
  return runReferenceCalculator(calculators, operation, seeds);
}
