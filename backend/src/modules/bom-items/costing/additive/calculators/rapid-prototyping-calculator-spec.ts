import spec from './rapid-prototyping-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';

/** The Rapid Prototyping calculator spec (rapid-prototyping-calculators.json), validated. */
export function loadRapidPrototypingCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec as DomainCalculatorSpec);
}

/** Every Rapid Prototyping calculator by name, as the spec has it (tests; the engine reads the database). */
export function rapidPrototypingCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadRapidPrototypingCalculatorSpec());
}
