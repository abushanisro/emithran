/**
 * Writes migration 1100 (the Part Assembly calculators) from the calculator spec
 * (src/modules/bom-items/costing/part-assembly/calculators/part-assembly-calculators.json). Re-run after editing the spec, until the
 * migration is applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-part-assembly-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildPartAssemblyCalculatorsMigrationSql, PART_ASSEMBLY_CALCULATORS_MIGRATION } from '../src/modules/bom-items/costing/part-assembly/calculators/part-assembly-calculators-migration';

const OUT = join(__dirname, `../migrations/${PART_ASSEMBLY_CALCULATORS_MIGRATION}_part_assembly_calculators.sql`);
writeFileSync(OUT, buildPartAssemblyCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
