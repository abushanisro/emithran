import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';
import { loadPlasticMoldingCalculatorSpec } from './plastic-molding-calculator-spec';

/**
 * Migration 975 created the five plastic-molding calculators and is applied wherever the platform runs: it is history and is never edited. A calculator in use is not
 * changed in place under its version, so each change ships as a new migration for the calculators whose spec `version` is above 1 (calculators.version, migration 428).
 * Today that is the reaction injection calculator, version 2 (fill time added).
 */
export const PLASTIC_MOLDING_CALCULATORS_MIGRATION = 976;

/** The SQL of migrations/976_plastic_rim_fill_time_calculator.sql: the calculators of the spec whose version is above 1. */
export function buildPlasticMoldingCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadPlasticMoldingCalculatorSpec(), {
    number: PLASTIC_MOLDING_CALCULATORS_MIGRATION,
    title: 'Reaction injection molding calculator, version 2 -- the fill time (part volume over the staged machine injection rate).',
    generator: 'scripts/generate-plastic-molding-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculators.json',
    rootCause: [
      'The reaction injection cycle time (migration 975) was the machine dry cycle plus the material cure time: the staged machine injection rate',
      '(rates.injectionRateMm3PerS) was not used, so a larger part filled in no time. The approved fill time is the total shot volume (mm3) over the',
      'injection rate (mm3/s), in seconds (formula registry F-19, ASSUMED: the reference states the rate but no RIM fill formula). The calculator is',
      'replaced under version 2 (a calculator in use is not edited in place under its version); the others are unchanged.',
    ].join('\n'),
  }, (c) => (c.version ?? 1) > 1);
}
