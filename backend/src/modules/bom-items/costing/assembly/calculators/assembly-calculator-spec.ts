import spec from './assembly-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';

import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';

/** The assembly calculator spec (assembly-calculators.json), validated. */
export function loadAssemblyCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec);
}

/** Every assembly calculator by name, as the spec has it (tests; the engine reads the database). */
export function assemblyCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadAssemblyCalculatorSpec());
}
