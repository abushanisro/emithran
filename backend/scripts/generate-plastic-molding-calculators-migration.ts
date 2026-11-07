/**
 * Writes migrations/976_plastic_rim_fill_time_calculator.sql and 977_plastic_fill_factor_lookup_tables.sql from the plastic-molding
 * calculator spec (src/modules/bom-items/costing/plastic-molding/calculators/
 * plastic-molding-calculators.json). Re-run after editing the spec:
 *   npx ts-node --transpile-only scripts/generate-plastic-molding-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  PLASTIC_MOLDING_CALCULATOR_MIGRATIONS, PLASTIC_MOLDING_CALCULATOR_MIGRATION_FILES, buildPlasticMoldingCalculatorsMigrationSql,
} from '../src/modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculators-migration';

for (const number of PLASTIC_MOLDING_CALCULATOR_MIGRATIONS) {
  const out = join(__dirname, '../migrations', PLASTIC_MOLDING_CALCULATOR_MIGRATION_FILES[number]);
  writeFileSync(out, buildPlasticMoldingCalculatorsMigrationSql(number));
  console.log(`wrote ${out}`);
}
