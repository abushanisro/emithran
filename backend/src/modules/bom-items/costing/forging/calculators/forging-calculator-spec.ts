import spec from './forging-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';

/** The forging calculator spec (forging-calculators.json), validated. */
export function loadForgingCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec as DomainCalculatorSpec);
}

/** Every forging calculator by name, as the spec has it (tests; the engine reads the database). */
export function forgingCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadForgingCalculatorSpec());
}
