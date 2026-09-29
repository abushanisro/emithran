/**
 * Writes migrations/804_machining_calculators.sql from the machining
 * calculator spec (src/modules/bom-items/costing/machining/calculators/
 * machining-calculators.json). Re-run after editing the spec:
 *   npx ts-node --transpile-only scripts/generate-machining-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildMachiningCalculatorsMigrationSql } from '../src/modules/bom-items/costing/machining/calculators/machining-calculators-migration';

const OUT = join(__dirname, '../migrations/804_machining_calculators.sql');
writeFileSync(OUT, buildMachiningCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
