/**
 * Writes migration 1073 (the additive calculators) from the additive calculator spec
 * (src/modules/bom-items/costing/additive/calculators/additive-calculators.json). Re-run after editing the spec, until the
 * migration is applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-additive-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildAdditiveCalculatorsMigrationSql, ADDITIVE_CALCULATORS_MIGRATION } from '../src/modules/bom-items/costing/additive/calculators/additive-calculators-migration';

const OUT = join(__dirname, `../migrations/${ADDITIVE_CALCULATORS_MIGRATION}_additive_calculators.sql`);
writeFileSync(OUT, buildAdditiveCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
