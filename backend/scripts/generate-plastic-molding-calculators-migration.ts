/**
 * Writes migrations/976_plastic_rim_fill_time_calculator.sql from the plastic-molding
 * calculator spec (src/modules/bom-items/costing/plastic-molding/calculators/
 * plastic-molding-calculators.json). Re-run after editing the spec:
 *   npx ts-node --transpile-only scripts/generate-plastic-molding-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildPlasticMoldingCalculatorsMigrationSql } from '../src/modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculators-migration';

const OUT = join(__dirname, '../migrations/976_plastic_rim_fill_time_calculator.sql');
writeFileSync(OUT, buildPlasticMoldingCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
