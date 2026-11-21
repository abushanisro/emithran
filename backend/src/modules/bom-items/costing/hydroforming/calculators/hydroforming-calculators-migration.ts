import { loadHydroformingCalculatorSpec } from './hydroforming-calculator-spec';
import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';

export const HYDROFORMING_CALCULATORS_MIGRATION = 1110;

/** The SQL of migrations/1110_hydroforming_calculators.sql, built from the spec. */
export function buildHydroformingCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadHydroformingCalculatorSpec(), {
    number: HYDROFORMING_CALCULATORS_MIGRATION,
    title: 'Sheet Metal - Hydroforming calculators -- the hydroform press, the offline blanking press and their helpers as real database calculators.',
    generator: 'scripts/generate-hydroforming-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/hydroforming/calculators/hydroforming-calculators.json',
    rootCause: [
      'Sheet Metal - Hydroforming was staged (reference data 2026-Hydroform: 174 variables, 22 lookup tables; 56 HR Rates machines, rated by',
      'migration 1109) but its two catalog processes, Hydroform and Offline Blank, had no calculator, and a part whose Process is Sheet Metal -',
      'Hydroforming was priced as plain sheet metal. These are the calculators of its two routes (Deep Draw, Fluid Cell): the press cycle of',
      'each and the offline blanking stroke compute the catalog processes; the cleaning, the throw pad, the hand adjusting, the parts per tray,',
      'the blanking force, the blank, the material and the hydroform tool are helpers the engine runs per part, which no operation maps to.',
    ].join('\n'),
  });
}
