import spec from './investment-casting-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef } from '../../../shared/calculators/reference-calculator';

/** The investment-casting calculator spec (investment-casting-calculators.json), validated. */
export function loadInvestmentCastingCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec as DomainCalculatorSpec);
}

/** Every investment-casting calculator by name, as the spec has it (tests; the engine reads the database). */
export function investmentCastingCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadInvestmentCastingCalculatorSpec());
}
