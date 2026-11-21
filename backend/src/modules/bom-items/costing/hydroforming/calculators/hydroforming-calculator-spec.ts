import spec from './hydroforming-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';

import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';

/** The Sheet Metal - Hydroforming calculator spec (hydroforming-calculators.json), validated. */
export function loadHydroformingCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec);
}

/** Every Sheet Metal - Hydroforming calculator by name, as the spec has it (tests; the engine reads the database). */
export function hydroformingCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadHydroformingCalculatorSpec());
}
