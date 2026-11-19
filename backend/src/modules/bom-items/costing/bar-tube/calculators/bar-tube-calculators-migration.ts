import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';
import { loadBarTubeCalculatorSpec } from './bar-tube-calculator-spec';

export const BAR_TUBE_CALCULATORS_MIGRATION = 1091;

/** The SQL of migrations/1091_bar_tube_calculators.sql, built from the spec. */
export function buildBarTubeCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadBarTubeCalculatorSpec(), {
    number: BAR_TUBE_CALCULATORS_MIGRATION,
    title: 'Bar and Tube Fabrication calculators -- stock, cutting (saw, shear, tube laser, plate and torch), punching, end forming, bending and extrusion as real database calculators.',
    generator: 'scripts/generate-bar-tube-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/bar-tube/calculators/bar-tube-calculators.json',
    rootCause: [
      'Bar and Tube Fabrication was staged (reference data 2026-BarTube: 50 variables, 14 lookup tables; 277 HR Rates machines, 93 materials)',
      'but had no cost engine: its 34 catalog processes had no calculator, and a part whose Process is Bar and Tube Fabrication was not costed.',
      'These are the calculators of its processes: the stock and plate per part, sawing, shearing, tube laser, plate and torch cutting, punching,',
      'end forming, rotary draw, compression, bend brake, roll and profile bending, and aluminium extrusion with its billet and die preheat.',
    ].join('\n'),
  });
}
