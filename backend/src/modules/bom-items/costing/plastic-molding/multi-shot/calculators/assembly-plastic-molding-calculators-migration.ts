import { loadAssemblyPlasticMoldingCalculatorSpec } from './assembly-plastic-molding-calculator-spec';
import { buildDomainCalculatorsMigrationSql } from '../../../shared/calculators/domain-calculators-migration';

export const ASSEMBLY_PLASTIC_MOLDING_CALCULATORS_MIGRATION = 1086;

/** The SQL of migrations/1086_assembly_plastic_molding_calculators.sql, built from the spec. */
export function buildAssemblyPlasticMoldingCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadAssemblyPlasticMoldingCalculatorSpec(), {
    number: ASSEMBLY_PLASTIC_MOLDING_CALCULATORS_MIGRATION,
    title: 'Assembly Plastic Molding calculators -- the component loading and the multi-shot cycle as real database calculators.',
    generator: 'scripts/generate-assembly-plastic-molding-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/plastic-molding/multi-shot/calculators/assembly-plastic-molding-calculators.json',
    rootCause: [
      'Assembly Plastic Molding (multi-shot 2K/3K molding) was staged (reference data 2026-AssyPlastic; 97 USA HR Rates machines) but had no',
      'cost engine: loading the pre-made components (Pick and Place) had no calculator, and nothing timed a multi-shot press, where every',
      'station molds at once. Each shot is injection molding (migration 1087 links Multi-Shot Molding to the injection cycle-time calculator);',
      'the multi-shot cycle is a helper the engine runs over the shots (the longest, then the tool index), which no operation maps to.',
    ].join('\n'),
  });
}
