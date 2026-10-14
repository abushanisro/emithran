/**
 * Writes migrations/907_heat_treatment_calculators.sql from the heat-treatment
 * calculator spec (src/modules/bom-items/costing/heat/calculators/
 * heat-treatment-calculators.json). Re-run after editing the spec:
 *   npx ts-node --transpile-only scripts/generate-heat-treatment-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildHeatTreatmentCalculatorsMigrationSql } from '../src/modules/bom-items/costing/heat/calculators/heat-treatment-calculators-migration';

const OUT = join(__dirname, '../migrations/907_heat_treatment_calculators.sql');
writeFileSync(OUT, buildHeatTreatmentCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
