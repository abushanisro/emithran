import spec from './roto-blow-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';

/** The Roto & Blow Molding calculator spec (roto-blow-calculators.json), validated. */
export function loadRotoBlowCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec as DomainCalculatorSpec);
}

/** Every Roto & Blow Molding calculator by name, as the spec has it (tests; the engine reads the database). */
export function rotoBlowCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadRotoBlowCalculatorSpec());
}
