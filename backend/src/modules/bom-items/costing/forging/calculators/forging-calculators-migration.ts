import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';
import { loadForgingCalculatorSpec } from './forging-calculator-spec';

export const FORGING_CALCULATORS_MIGRATION = 1051;

/** The SQL of migrations/1051_forging_calculators.sql, built from the spec. */
export function buildForgingCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadForgingCalculatorSpec(), {
    number: FORGING_CALCULATORS_MIGRATION,
    title: 'Forging calculators -- the billet, the flash, the forging load and every step time of a closed-die forging as real database calculators.',
    generator: 'scripts/generate-forging-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/forging/calculators/forging-calculators.json',
    rootCause: [
      'The forging process catalog (migration 790) was seeded with calculator_id NULL, and no calculator held a forging formula, so a part',
      'whose Process is Forging was not costed. memory/Forging holds the variables, tables, machines and alloys of forging but no formula.',
      'These calculators are written from published forging rules, each named in its description, and read their numbers from the staged',
      'reference data (migration 823) and the two published tables of migration 1050. The forged shape, the flash, the billet, the bar, the',
      'material cost, the forging load and the die tooling are helper calculators: no catalog operation maps to a helper.',
    ].join('\n'),
  });
}
