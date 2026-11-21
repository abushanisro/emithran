/**
 * Writes migration 1105 (the Rapid Prototyping calculators) from the Rapid Prototyping calculator spec
 * (src/modules/bom-items/costing/additive/calculators/rapid-prototyping-calculators.json). Re-run after editing the spec, until the
 * migration is applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-rapid-prototyping-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  buildRapidPrototypingCalculatorsMigrationSql, RAPID_PROTOTYPING_CALCULATORS_MIGRATION,
} from '../src/modules/bom-items/costing/additive/calculators/rapid-prototyping-calculators-migration';

const OUT = join(__dirname, `../migrations/${RAPID_PROTOTYPING_CALCULATORS_MIGRATION}_rapid_prototyping_calculators.sql`);
writeFileSync(OUT, buildRapidPrototypingCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
