import spec from './sand-casting-calculators.json';
import {
  domainCalculatorsAsReference,
  domainCalculatorsByName,
  validateDomainCalculatorSpec,
  type DomainCalculatorSpec,
} from '../../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef, ReferenceCalculators } from '../../../shared/calculators/reference-calculator';

/** The sand-casting calculator spec (sand-casting-calculators.json), validated. */
export function loadSandCastingCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec as DomainCalculatorSpec);
}

/** The spec as the per-operation calculator set the engine receives (tests; the engine reads the database). */
export function sandCastingCalculatorsFromSpec(): ReferenceCalculators {
  return domainCalculatorsAsReference(loadSandCastingCalculatorSpec());
}

/** Every sand calculator by name, helpers included (sizing steps and machine variants no operation maps to). */
export function sandCastingCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadSandCastingCalculatorSpec());
}
