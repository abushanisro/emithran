import spec from './assembly-plastic-molding-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../../shared/calculators/domain-calculator-spec';

import type { ReferenceCalculatorDef } from '../../../shared/calculators/reference-calculator';

/** The assembly plastic molding (multi-shot) calculator spec (assembly-plastic-molding-calculators.json), validated. */
export function loadAssemblyPlasticMoldingCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec);
}

/** Every assembly plastic molding calculator by name, as the spec has it (tests; the engine reads the database). */
export function assemblyPlasticMoldingCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadAssemblyPlasticMoldingCalculatorSpec());
}
