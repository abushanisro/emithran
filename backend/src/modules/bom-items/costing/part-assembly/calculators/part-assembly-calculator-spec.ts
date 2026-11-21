import spec from './part-assembly-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';

import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';

/** The Part Assembly calculator spec (part-assembly-calculators.json), validated. */
export function loadPartAssemblyCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec);
}

/** Every Part Assembly calculator by name, as the spec has it (tests; the engine reads the database). */
export function partAssemblyCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadPartAssemblyCalculatorSpec());
}
