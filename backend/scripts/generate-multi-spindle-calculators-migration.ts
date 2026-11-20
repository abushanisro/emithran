/**
 * Writes migration 1095 (the Multi-Spindle Machining calculators) from the calculator spec
 * (src/modules/bom-items/costing/multi-spindle/calculators/multi-spindle-calculators.json). Re-run after editing the spec, until the
 * migration is applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-multi-spindle-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildMultiSpindleCalculatorsMigrationSql, MULTI_SPINDLE_CALCULATORS_MIGRATION } from '../src/modules/bom-items/costing/multi-spindle/calculators/multi-spindle-calculators-migration';

const OUT = join(__dirname, `../migrations/${MULTI_SPINDLE_CALCULATORS_MIGRATION}_multi_spindle_calculators.sql`);
writeFileSync(OUT, buildMultiSpindleCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
