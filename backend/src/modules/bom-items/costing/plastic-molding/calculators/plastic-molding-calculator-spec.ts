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

/**
 * The reference tables the plastic calculators' inputs name (sourceTable of their fields): the tables the cost dialog may open for them. They are staged in
 * machining_reference_data under the plastic dataset's source version (PLASTIC_REFERENCE_SOURCE_VERSION), so a request for one must read that dataset.
 */
export function plasticLookupTableNames(): string[] {
  const names = new Set<string>();
  for (const c of loadPlasticMoldingCalculatorSpec().calculators) for (const f of c.fields) if (f.sourceTable) names.add(f.sourceTable);
  return [...names].sort();
}

/** Every calculator of the spec by name, helpers included (the LSR variant no catalog operation maps to). */
export function plasticMoldingCalculatorsByName(): Record<string, ReferenceCalculatorDef> {
  return domainCalculatorsByName(loadPlasticMoldingCalculatorSpec());
}
