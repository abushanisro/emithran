/**
 * Writes migration 1078 (the assembly calculators) from the assembly calculator spec
 * (src/modules/bom-items/costing/assembly/calculators/assembly-calculators.json). Re-run after editing the spec, until the
 * migration is applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-assembly-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildAssemblyCalculatorsMigrationSql, ASSEMBLY_CALCULATORS_MIGRATION } from '../src/modules/bom-items/costing/assembly/calculators/assembly-calculators-migration';

const OUT = join(__dirname, `../migrations/${ASSEMBLY_CALCULATORS_MIGRATION}_assembly_calculators.sql`);
writeFileSync(OUT, buildAssemblyCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
