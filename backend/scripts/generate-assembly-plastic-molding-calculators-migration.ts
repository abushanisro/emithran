/**
 * Writes migration 1086 (the assembly plastic molding calculators) from the spec
 * (src/modules/bom-items/costing/plastic-molding/multi-shot/calculators/assembly-plastic-molding-calculators.json). Re-run after editing the
 * spec, until the migration is applied anywhere; after that a changed calculator ships in a new migration:
 *   npx ts-node --transpile-only scripts/generate-assembly-plastic-molding-calculators-migration.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  ASSEMBLY_PLASTIC_MOLDING_CALCULATORS_MIGRATION, buildAssemblyPlasticMoldingCalculatorsMigrationSql,
} from '../src/modules/bom-items/costing/plastic-molding/multi-shot/calculators/assembly-plastic-molding-calculators-migration';

const OUT = join(__dirname, `../migrations/${ASSEMBLY_PLASTIC_MOLDING_CALCULATORS_MIGRATION}_assembly_plastic_molding_calculators.sql`);
writeFileSync(OUT, buildAssemblyPlasticMoldingCalculatorsMigrationSql());
console.log(`wrote ${OUT}`);
