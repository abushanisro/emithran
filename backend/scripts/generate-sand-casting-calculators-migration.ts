/**
 * Writes migrations/956_sand_casting_calculators.sql and migrations/958_sand_hot_box_physics.sql from the sand-casting
 * calculator spec (src/modules/bom-items/costing/casting/sand/calculators/
 * sand-casting-calculators.json). Re-run after editing the spec:
 *   npx ts-node --transpile-only scripts/generate-sand-casting-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildSandCastingCalculatorsMigrationSql, buildSandHotBoxPhysicsMigrationSql } from '../src/modules/bom-items/costing/casting/sand/calculators/sand-casting-calculators-migration';

const OUT = join(__dirname, '../migrations/956_sand_casting_calculators.sql');
writeFileSync(OUT, buildSandCastingCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
const HOT_BOX = join(__dirname, '../migrations/958_sand_hot_box_physics.sql');
writeFileSync(HOT_BOX, buildSandHotBoxPhysicsMigrationSql());
console.log(`wrote ${HOT_BOX}`);
