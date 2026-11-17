import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';
import { loadPowderMetalCalculatorSpec } from './powder-metal-calculator-spec';

export const POWDER_METAL_CALCULATORS_MIGRATION = 1060;

/** The SQL of migrations/1060_powder_metal_calculators.sql, built from the spec. */
export function buildPowderMetalCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadPowderMetalCalculatorSpec(), {
    number: POWDER_METAL_CALCULATORS_MIGRATION,
    title: 'Powder metal calculators -- compaction pressing and belt sintering as real database calculators.',
    generator: 'scripts/generate-powder-metal-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/powder-metal/calculators/powder-metal-calculators.json',
    rootCause: [
      'Powder Metal was staged (reference data 2026-PowderMetal, 16 HR Rates machines, 7 powders with their compaction curves)',
      'but had no cost engine: its two catalog operations had no calculator, and a part whose Process is Powder Metal was not',
      'costed. These are the calculators of its route: compaction pressing and belt sintering compute their operations; the',
      'compaction pressure, the press force and the fill height are helpers no operation maps to.',
    ].join('\n'),
  });
}
