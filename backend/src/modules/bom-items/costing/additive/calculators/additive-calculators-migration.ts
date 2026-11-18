import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';
import { loadAdditiveCalculatorSpec } from './additive-calculator-spec';

export const ADDITIVE_CALCULATORS_MIGRATION = 1073;

/** The SQL of migrations/1073_additive_calculators.sql, built from the spec. */
export function buildAdditiveCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadAdditiveCalculatorSpec(), {
    number: ADDITIVE_CALCULATORS_MIGRATION,
    title: 'Additive Manufacturing calculators -- metal and laser sintering, material jetting, stereolithography and their post steps as real database calculators.',
    generator: 'scripts/generate-additive-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/additive/calculators/additive-calculators.json',
    rootCause: [
      'Additive Manufacturing was staged (reference data 2026-Additive: 61 variables, 7 lookup tables; 102 HR Rates machines, 96 materials)',
      'but had no cost engine: its catalog processes had no calculator, and a part whose Process is Additive Manufacturing was not costed.',
      'These are the calculators of its four routes (metal sintering, laser sintering, material jetting, stereolithography) and their post',
      'steps (breakoff, base removal, powder loading and recovery, part curing, cleaning): each catalog process computes its cycle; the parts',
      'per build, the melt complexity, the materials and the build gas are helpers the engine runs per part, which no operation maps to.',
    ].join('\n'),
  });
}
