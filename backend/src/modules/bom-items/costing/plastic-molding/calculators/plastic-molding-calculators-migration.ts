import { buildDomainCalculatorsMigrationSql } from '../../shared/calculators/domain-calculators-migration';
import { loadPlasticMoldingCalculatorSpec } from './plastic-molding-calculator-spec';

export const PLASTIC_MOLDING_CALCULATORS_MIGRATION = 975;

/** The SQL of migrations/975_plastic_molding_calculators.sql, built from the spec. */
export function buildPlasticMoldingCalculatorsMigrationSql(): string {
  return buildDomainCalculatorsMigrationSql(loadPlasticMoldingCalculatorSpec(), {
    number: PLASTIC_MOLDING_CALCULATORS_MIGRATION,
    title: 'Plastic molding cycle-time calculators -- one real database calculator for each molding process.',
    generator: 'scripts/generate-plastic-molding-calculators-migration.ts',
    specPath: 'src/modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculators.json',
    rootCause: [
      'The molding cycle times (injection and structural foam: Menges cooling, fill, pack, mold motion;',
      'compression and reaction injection: press motion plus cure) were held only in TypeScript, and the four',
      'Plastic Molding rows of process_calculator_mappings carried a calculator name with calculator_id NULL,',
      'so the cost dialogs could not open the calculator behind a molding line the way they do for heat',
      'treatment, machining or die casting. The one injection calculator in the catalog ("Injection Molding',
      'Cycle time Calculation") is an older hand-built one that no mapping uses and that models ejection and',
      'slider time the engine does not.',
    ].join('\n'),
  });
}
