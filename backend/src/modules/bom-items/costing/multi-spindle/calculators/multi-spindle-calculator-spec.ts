import spec from './multi-spindle-calculators.json';
import { domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef } from '../../shared/calculators/reference-calculator';

/** The Multi-Spindle Machining calculator spec (multi-spindle-calculators.json), validated. */
export function loadMultiSpindleCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec as DomainCalculatorSpec);
}

/** Every Multi-Spindle Machining calculator by name, as the spec has it (tests; the engine reads the database). */
export function multiSpindleCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadMultiSpindleCalculatorSpec());
}
