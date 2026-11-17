import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';
import { loadCompositesCalculatorSpec } from './composites-calculator-spec';

export const COMPOSITES_CALCULATORS_MIGRATION = 1065;

/** The SQL of migrations/1065_composites_calculators.sql, built from the spec. */
export function buildCompositesCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadCompositesCalculatorSpec(), {
    number: COMPOSITES_CALCULATORS_MIGRATION,
    title: 'Composites calculators -- tool clean to autoclave cure as real database calculators.',
    generator: 'scripts/generate-composites-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/composites/calculators/composites-calculators.json',
    rootCause: [
      'Composites was staged (reference data 2026-Composites: 82 variables, 3 lookup tables; 87 HR Rates machines, 23 materials) but had',
      'no cost engine: its catalog processes had no calculator, and a part whose Process is Composites was not costed. These are the',
      'calculators of its routes (hand layup, tape layup, fiber placement): each catalog process computes its cycle; ply complexity, ply',
      'placement, ply cutting, core placement, ply and core material and the autoclave load are helpers the engine runs per ply, per',
      'core or per part, which no operation maps to.',
    ].join('\n'),
  });
}
