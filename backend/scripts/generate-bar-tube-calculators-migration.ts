/**
 * Writes migration 1091 (the bar and tube calculators) from the bar and tube calculator spec
 * (src/modules/bom-items/costing/bar-tube/calculators/bar-tube-calculators.json). Re-run after editing the spec, until the
 * migration is applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-bar-tube-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildBarTubeCalculatorsMigrationSql, BAR_TUBE_CALCULATORS_MIGRATION } from '../src/modules/bom-items/costing/bar-tube/calculators/bar-tube-calculators-migration';

const OUT = join(__dirname, `../migrations/${BAR_TUBE_CALCULATORS_MIGRATION}_bar_tube_calculators.sql`);
writeFileSync(OUT, buildBarTubeCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
