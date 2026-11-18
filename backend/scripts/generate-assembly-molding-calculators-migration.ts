/**
 * Writes migration 1081 (the assembly molding calculators) from the spec
 * (src/modules/bom-items/costing/plastic-molding/insert/calculators/assembly-molding-calculators.json). Re-run after editing the spec, until
 * the migration is applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-assembly-molding-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  ASSEMBLY_MOLDING_CALCULATORS_MIGRATION, buildAssemblyMoldingCalculatorsMigrationSql,
} from '../src/modules/bom-items/costing/plastic-molding/insert/calculators/assembly-molding-calculators-migration';

const OUT = join(__dirname, `../migrations/${ASSEMBLY_MOLDING_CALCULATORS_MIGRATION}_assembly_molding_calculators.sql`);
writeFileSync(OUT, buildAssemblyMoldingCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
