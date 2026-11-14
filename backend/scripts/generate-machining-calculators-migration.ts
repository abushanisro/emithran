/**
 * Writes migrations/804_machining_calculators.sql from the machining
 * calculator spec (src/modules/bom-items/costing/machining/calculators/
 * machining-calculators.json). Re-run after editing the spec:
 *   npx ts-node --transpile-only scripts/generate-machining-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildMachiningCalculatorMigrationSql, buildMachiningCalculatorsMigrationSql } from '../src/modules/bom-items/costing/machining/calculators/machining-calculators-migration';

const OUT = join(__dirname, '../migrations/804_machining_calculators.sql');
writeFileSync(OUT, buildMachiningCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);

// Calculators added after 804, each in the migration the spec names.
const LATER: Record<number, string> = {
  1027: '1027_machining_milling_calculator.sql',
  1028: '1028_machining_calculators_missing_after_804.sql',
  1029: '1029_machining_inspection_from_reference.sql',
  1030: '1030_machining_calculators_batch_2.sql',
  1031: '1031_machining_mill_operation_calculators.sql',
  1032: '1032_machining_calculators_batch_3.sql',
  1035: '1035_machining_countersinking_calculator.sql',
};
for (const [n, file] of Object.entries(LATER)) {
  writeFileSync(join(__dirname, '../migrations', file), buildMachiningCalculatorMigrationSql(Number(n)));
  console.log(`wrote ${file}`);
}
