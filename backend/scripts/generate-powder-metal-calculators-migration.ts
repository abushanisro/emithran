/**
 * Writes migrations/1060_powder_metal_calculators.sql from the powder metal calculator spec
 * (src/modules/bom-items/costing/powder-metal/calculators/powder-metal-calculators.json). Re-run after editing the spec, until the
 * migration is applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-powder-metal-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildPowderMetalCalculatorsMigrationSql, POWDER_METAL_CALCULATORS_MIGRATION } from '../src/modules/bom-items/costing/powder-metal/calculators/powder-metal-calculators-migration';

const OUT = join(__dirname, `../migrations/${POWDER_METAL_CALCULATORS_MIGRATION}_powder_metal_calculators.sql`);
writeFileSync(OUT, buildPowderMetalCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
