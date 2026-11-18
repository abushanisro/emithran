import spec from './assembly-molding-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../../shared/calculators/domain-calculator-spec';

import type { ReferenceCalculatorDef } from '../../../shared/calculators/reference-calculator';

/** The assembly molding (insert molding) calculator spec (assembly-molding-calculators.json), validated. */
export function loadAssemblyMoldingCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec);
}

/** Every assembly molding calculator by name, as the spec has it (tests; the engine reads the database). */
export function assemblyMoldingCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadAssemblyMoldingCalculatorSpec());
}
