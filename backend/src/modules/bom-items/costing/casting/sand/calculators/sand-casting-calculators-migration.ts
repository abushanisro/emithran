import { buildDomainCalculatorsMigrationSql } from '../../../shared/calculators/domain-calculators-migration';
import { loadSandCastingCalculatorSpec } from './sand-casting-calculator-spec';

export const SAND_CASTING_CALCULATORS_MIGRATION = 956;

/** The SQL of migrations/956_sand_casting_calculators.sql, built from the spec. */
export function buildSandCastingCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadSandCastingCalculatorSpec(), {
    number: SAND_CASTING_CALCULATORS_MIGRATION,
    title: 'Sand casting calculators -- every sand step time and sizing rule as a real database calculator.',
    generator: 'scripts/generate-sand-casting-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/casting/sand/calculators/sand-casting-calculators.json',
    rootCause: [
      'The sand-casting process catalog (migration 851) was seeded with calculator_id NULL and is_active false ("no cost',
      'engine built"), and no calculator held a sand formula. This creates the calculators; the mappings stay inactive',
      'until the route that uses them exists. Sizing steps (risers, gating, metal, core sand, core box) and the machine',
      'variants (manual shakeout, cleaning room) are helper calculators: no catalog operation maps to them.',
    ].join('\n'),
  });
}
