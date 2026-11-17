/**
 * Writes migrations/1051_forging_calculators.sql from the forging calculator spec
 * (src/modules/bom-items/costing/forging/calculators/forging-calculators.json). Re-run after editing the spec, until the migration is
 * applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-forging-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildForgingCalculatorsMigrationSql, FORGING_CALCULATORS_MIGRATION } from '../src/modules/bom-items/costing/forging/calculators/forging-calculators-migration';

const OUT = join(__dirname, `../migrations/${FORGING_CALCULATORS_MIGRATION}_forging_calculators.sql`);
writeFileSync(OUT, buildForgingCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
