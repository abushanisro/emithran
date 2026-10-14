import spec from './heat-treatment-calculators.json';
import { validateDomainCalculatorSpec, domainCalculatorsAsReference, type DomainCalculatorSpec } from '../../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculators } from '../../shared/calculators/reference-calculator';

/** The heat-treatment calculator spec (heat-treatment-calculators.json), validated. */
export function loadHeatTreatmentCalculatorSpec(): DomainCalculatorSpec {
  return validateDomainCalculatorSpec(spec as DomainCalculatorSpec);
}

/** The spec as the per-operation calculator set the engine receives (tests; the engine reads the database). */
export function heatTreatmentCalculatorsFromSpec(): ReferenceCalculators {
  return domainCalculatorsAsReference(loadHeatTreatmentCalculatorSpec());
}
