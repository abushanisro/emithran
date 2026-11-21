import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';
import { loadRotoBlowCalculatorSpec } from './roto-blow-calculator-spec';

export const ROTO_BLOW_CALCULATORS_MIGRATION = 1108;

/** The SQL of migrations/1108_roto_blow_calculators.sql, built from the spec. */
export function buildRotoBlowCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadRotoBlowCalculatorSpec(), {
    number: ROTO_BLOW_CALCULATORS_MIGRATION,
    title: 'Roto & Blow Molding calculators -- extrusion blow molding, rotational molding, routing, sawing and grinding as real database calculators.',
    generator: 'scripts/generate-roto-blow-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/roto-blow/calculators/roto-blow-calculators.json',
    rootCause: [
      'Roto & Blow Molding was staged (reference data 2026-RotoBlow: 73 variables, 7 lookup tables; 19 HR Rates machines, 72 materials)',
      'but had no cost engine: its five catalog processes had no calculator, and a part whose Process is Roto & Blow Molding was not costed.',
      'These are the calculators of its two routes (extrusion blow molding, rotational molding) and their steps (routing, sawing, grinding):',
      'each catalog process computes its cycle; the cooling, the inflation, the cavities, the molds per arm, the load station, the materials',
      'and the tooling are helpers the engine runs per part, which no operation maps to.',
    ].join('\n'),
  });
}
