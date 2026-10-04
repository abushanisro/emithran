/**
 * Writes migrations/893_die_casting_calculators.sql from the die-casting
 * calculator spec (src/modules/bom-items/costing/casting/calculators/
 * die-casting-calculators.json). Re-run after editing the spec:
 *   npx ts-node --transpile-only scripts/generate-die-casting-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildDieCastingCalculatorsMigrationSql } from '../src/modules/bom-items/costing/casting/calculators/die-casting-calculators-migration';

const OUT = join(__dirname, '../migrations/893_die_casting_calculators.sql');
writeFileSync(OUT, buildDieCastingCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
