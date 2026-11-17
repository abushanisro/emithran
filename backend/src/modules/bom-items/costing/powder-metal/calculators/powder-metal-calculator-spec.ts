import spec from './powder-metal-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';

/** The powder metal calculator spec (powder-metal-calculators.json), validated. */
export function loadPowderMetalCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec as DomainCalculatorSpec);
}

/** Every powder metal calculator by name, as the spec has it (tests; the engine reads the database). */
export function powderMetalCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadPowderMetalCalculatorSpec());
}
