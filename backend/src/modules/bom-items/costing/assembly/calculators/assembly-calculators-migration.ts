import { loadAssemblyCalculatorSpec } from './assembly-calculator-spec';
import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';

export const ASSEMBLY_CALCULATORS_MIGRATION = 1078;

/** The SQL of migrations/1078_assembly_calculators.sql, built from the spec. */
export function buildAssemblyCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadAssemblyCalculatorSpec(), {
    number: ASSEMBLY_CALCULATORS_MIGRATION,
    title: 'Assembly calculators -- pick and place, fastening, welding, bonding and sealing as real database calculators.',
    generator: 'scripts/generate-assembly-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/assembly/calculators/assembly-calculators.json',
    rootCause: [
      'Assembly was staged (reference data 2026-Assembly: 70 variables, 11 lookup tables; 60 HR Rates machines) but had no cost engine: its',
      'catalog processes had no calculator, and the work of putting an assembly together (loading its components, fastening, welding, bonding,',
      'sealing) was never costed. These are the calculators of every Assembly catalog process; the weld consumables and the sealant and adhesive',
      'material are helpers the engine runs per joint, which no operation maps to.',
    ].join('\n'),
  });
}
