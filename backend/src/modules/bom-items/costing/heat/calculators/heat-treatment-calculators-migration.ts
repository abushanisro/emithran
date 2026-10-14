import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';
import { loadHeatTreatmentCalculatorSpec } from './heat-treatment-calculator-spec';

export const HEAT_TREATMENT_CALCULATORS_MIGRATION = 907;

/** The SQL of migrations/907_heat_treatment_calculators.sql, built from the spec. */
export function buildHeatTreatmentCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadHeatTreatmentCalculatorSpec(), {
    number: HEAT_TREATMENT_CALCULATORS_MIGRATION,
    title: 'Heat treatment calculators -- every heat-treatment time and service price as a real database calculator.',
    generator: 'scripts/generate-heat-treatment-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/heat/calculators/heat-treatment-calculators.json',
    rootCause: [
      'The heat-treatment formulas (straightening rate, oven loads, HIP load time, the',
      'weight-priced service) were held in TypeScript, and the Heat Treatment rows of',
      'process_calculator_mappings (migration 826) had calculator_id NULL, so the cost',
      'dialogs could not open the calculator behind a line.',
    ].join('\n'),
  });
}
