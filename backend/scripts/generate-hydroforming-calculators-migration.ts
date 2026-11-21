/**
 * Writes migration 1110 (the Sheet Metal - Hydroforming calculators) from the calculator spec
 * (src/modules/bom-items/costing/hydroforming/calculators/hydroforming-calculators.json). Re-run after editing the spec, until the migration
 * is applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-hydroforming-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildHydroformingCalculatorsMigrationSql, HYDROFORMING_CALCULATORS_MIGRATION } from '../src/modules/bom-items/costing/hydroforming/calculators/hydroforming-calculators-migration';

const OUT = join(__dirname, `../migrations/${HYDROFORMING_CALCULATORS_MIGRATION}_hydroforming_calculators.sql`);
writeFileSync(OUT, buildHydroformingCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
