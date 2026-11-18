import { loadAssemblyMoldingCalculatorSpec } from './assembly-molding-calculator-spec';
import { buildDomainCalculatorsMigrationSql } from '../../../shared/calculators/domain-calculators-migration';

export const ASSEMBLY_MOLDING_CALCULATORS_MIGRATION = 1081;

/** The SQL of migrations/1081_assembly_molding_calculators.sql, built from the spec. */
export function buildAssemblyMoldingCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadAssemblyMoldingCalculatorSpec(), {
    number: ASSEMBLY_MOLDING_CALCULATORS_MIGRATION,
    title: 'Assembly Molding calculators -- the insert loading and the insert molding shot cycle as real database calculators.',
    generator: 'scripts/generate-assembly-molding-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/plastic-molding/insert/calculators/assembly-molding-calculators.json',
    rootCause: [
      'Assembly Molding (insert molding) was staged (reference data 2026-AssyMolding; 254 HR Rates machines) but had no cost engine: the',
      'loading of the inserts every shot (Insert Pick and Place) had no calculator. The molding itself is injection molding on an insert press',
      '(migration 1080 links it to the injection cycle-time calculator); the shot cycle is a helper the engine runs to overlap the loading with',
      'the molding on a rotary or shuttle table, which no operation maps to.',
    ].join('\n'),
  });
}
