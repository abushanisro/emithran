import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';
import { loadRapidPrototypingCalculatorSpec } from './rapid-prototyping-calculator-spec';

export const RAPID_PROTOTYPING_CALCULATORS_MIGRATION = 1105;

/** The SQL of migrations/1105_rapid_prototyping_calculators.sql, built from the spec. */
export function buildRapidPrototypingCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadRapidPrototypingCalculatorSpec(), {
    number: RAPID_PROTOTYPING_CALCULATORS_MIGRATION,
    title: 'Rapid Prototyping calculators -- laser sintering, 3D printing, stereolithography, part curing and per-feature cleaning as real database calculators.',
    generator: 'scripts/generate-rapid-prototyping-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/additive/calculators/rapid-prototyping-calculators.json',
    rootCause: [
      'Rapid Prototyping was staged (reference data 2026-RapidProto: 90 variables, 2 lookup tables; 25 HR Rates machines, 50 materials)',
      'but had no cost engine: its five catalog processes had no calculator, and a part whose Process is Rapid Prototyping was not costed.',
      'It is priced by the additive engine in its own domain (costing/additive/additive-domain.ts RAPID_PROTOTYPING): these are the',
      'calculators of its three build routes (laser sintering, 3D printing, stereolithography), part curing, and cleaning timed per hole and',
      'void; the parts per build, the powder, resin and support material, the build gas, the laser use and one feature\'s cleaning time are',
      'helpers the engine runs per part, which no operation maps to.',
    ].join('\n'),
  });
}
