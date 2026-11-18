import spec from './additive-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';

/** The additive manufacturing calculator spec (additive-calculators.json), validated. */
export function loadAdditiveCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec as DomainCalculatorSpec);
}

/** Every additive calculator by name, as the spec has it (tests; the engine reads the database). */
export function additiveCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadAdditiveCalculatorSpec());
}
