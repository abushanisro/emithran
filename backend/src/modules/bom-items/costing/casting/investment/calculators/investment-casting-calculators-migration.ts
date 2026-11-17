import { buildDomainCalculatorsMigrationSql } from '../../../shared/calculators/domain-calculators-migration';
import { loadInvestmentCastingCalculatorSpec } from './investment-casting-calculator-spec';

export const INVESTMENT_CASTING_CALCULATORS_MIGRATION = 1046;

/** The SQL of migrations/1046_investment_casting_calculators.sql, built from the spec. */
export function buildInvestmentCastingCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadInvestmentCastingCalculatorSpec(), {
    number: INVESTMENT_CASTING_CALCULATORS_MIGRATION,
    title: 'Investment casting calculators -- every step time and sizing rule of the lost wax route as a real database calculator.',
    generator: 'scripts/generate-investment-casting-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/casting/investment/calculators/investment-casting-calculators.json',
    rootCause: [
      'The investment casting process catalog (migration 871) was seeded with calculator_id NULL ("no cost engine built"), and no',
      'calculator held an investment casting formula, so a part whose Process is Casting Investment had one uncosted line.',
      'This creates the calculators of the route. The tree, the metal, the material cost and the wax pattern die are helper',
      'calculators, and so is each bench operation (the catalog has one Bench Operation row for all of them): no catalog',
      'operation maps to a helper.',
    ].join('\n'),
  });
}
