/**
 * Writes migrations 1053, 1054 and 1057 (the forging calculators) from the forging calculator spec
 * (src/modules/bom-items/costing/forging/calculators/forging-calculators.json). Re-run after editing the spec, until the
 * migration is applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-forging-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  buildForgingCalculatorsMigrationSql, buildForgingHammerEnergyMigrationSql, buildForgingRoutesCalculatorsMigrationSql,
  FORGING_CALCULATORS_MIGRATION, FORGING_HAMMER_ENERGY_MIGRATION, FORGING_ROUTES_CALCULATORS_MIGRATION,
} from '../src/modules/bom-items/costing/forging/calculators/forging-calculators-migration';

const OUT = join(__dirname, `../migrations/${FORGING_CALCULATORS_MIGRATION}_forging_calculators.sql`);
writeFileSync(OUT, buildForgingCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
const ROUTES = join(__dirname, `../migrations/${FORGING_ROUTES_CALCULATORS_MIGRATION}_forging_routes_calculators.sql`);
writeFileSync(ROUTES, buildForgingRoutesCalculatorsMigrationSql());
console.log(`wrote ${ROUTES}`);
const HAMMER = join(__dirname, `../migrations/${FORGING_HAMMER_ENERGY_MIGRATION}_forging_hammer_energy.sql`);
writeFileSync(HAMMER, buildForgingHammerEnergyMigrationSql());
console.log(`wrote ${HAMMER}`);
