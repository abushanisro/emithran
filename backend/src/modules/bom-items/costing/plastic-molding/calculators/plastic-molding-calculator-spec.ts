import spec from './plastic-molding-calculators.json';
import { validateDomainCalculatorSpec, domainCalculatorsAsReference, domainCalculatorsByName, type DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculatorDef, ReferenceCalculators } from '../../shared/calculators/reference-calculator';

/** The plastic-molding cycle-time calculator spec (plastic-molding-calculators.json), validated. */
export function loadPlasticMoldingCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec as DomainCalculatorSpec);
}

/** The spec as the per-operation calculator set the engine receives (tests; the engine reads the database). */
export function plasticMoldingCalculatorsFromSpec(): ReferenceCalculators {
  return domainCalculatorsAsReference(loadPlasticMoldingCalculatorSpec());
}

/** Every calculator of the spec by name, helpers included (the LSR variant no catalog operation maps to). */
export function plasticMoldingCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadPlasticMoldingCalculatorSpec());
}
