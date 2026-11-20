import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';
import { loadMultiSpindleCalculatorSpec } from './multi-spindle-calculator-spec';

export const MULTI_SPINDLE_CALCULATORS_MIGRATION = 1095;

/** The SQL of migrations/1095_multi_spindle_calculators.sql, built from the spec. */
export function buildMultiSpindleCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadMultiSpindleCalculatorSpec(), {
    number: MULTI_SPINDLE_CALCULATORS_MIGRATION,
    title: 'Multi-Spindle Machining calculators -- the bar stock per part and the multi-spindle cycle as real database calculators.',
    generator: 'scripts/generate-multi-spindle-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/multi-spindle/calculators/multi-spindle-calculators.json',
    rootCause: [
      'Multi-Spindle Machining was staged (reference data 2026-Multi-Spindle: the bar stock variables, tblPreferredSizes and tblPartingRingWidth;',
      'the 15 Simultaneous Turning machines of memory/Machining in HR Rates) but had no cost engine: a part whose Process is Multi-Spindle',
      'Machining was not costed. These are its calculators: the bar bought per part (allowance, preferred size, parting width, remnant) and the',
      'cycle of a machine whose stations all cut at once, the slowest station plus the index (migration 1094 adds the catalog row it links to).',
    ].join('\n'),
  });
}
