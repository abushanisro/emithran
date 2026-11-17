/**
 * Writes migration 1065 (the composites calculators) from the composites calculator spec
 * (src/modules/bom-items/costing/composites/calculators/composites-calculators.json). Re-run after editing the spec, until the
 * migration is applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-composites-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildCompositesCalculatorsMigrationSql, COMPOSITES_CALCULATORS_MIGRATION } from '../src/modules/bom-items/costing/composites/calculators/composites-calculators-migration';

const OUT = join(__dirname, `../migrations/${COMPOSITES_CALCULATORS_MIGRATION}_composites_calculators.sql`);
writeFileSync(OUT, buildCompositesCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
