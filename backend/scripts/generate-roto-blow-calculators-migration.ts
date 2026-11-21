/**
 * Writes migration 1108 (the Roto & Blow Molding calculators) from the calculator spec
 * (src/modules/bom-items/costing/roto-blow/calculators/roto-blow-calculators.json). Re-run after editing the spec, until the migration is
 * applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-roto-blow-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildRotoBlowCalculatorsMigrationSql, ROTO_BLOW_CALCULATORS_MIGRATION } from '../src/modules/bom-items/costing/roto-blow/calculators/roto-blow-calculators-migration';

const OUT = join(__dirname, `../migrations/${ROTO_BLOW_CALCULATORS_MIGRATION}_roto_blow_calculators.sql`);
writeFileSync(OUT, buildRotoBlowCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
