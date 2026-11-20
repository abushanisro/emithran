import spec from './bar-tube-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';

/** The bar and tube fabrication calculator spec (bar-tube-calculators.json), validated. */
export function loadBarTubeCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec as DomainCalculatorSpec);
}

/** Every bar and tube calculator by name, as the spec has it (tests; the engine reads the database). */
export function barTubeCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadBarTubeCalculatorSpec());
}
