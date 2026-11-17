import spec from './composites-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';

/** The composites calculator spec (composites-calculators.json), validated. */
export function loadCompositesCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec as DomainCalculatorSpec);
}

/** Every composites calculator by name, as the spec has it (tests; the engine reads the database). */
export function compositesCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadCompositesCalculatorSpec());
}
