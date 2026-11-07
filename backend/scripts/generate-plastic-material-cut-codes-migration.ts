/**
 * Writes migrations/978_plastic_material_cut_codes.sql from memory/Plastic Modeling/materials_final.csv. Re-run after the reference changes:
 *   npx ts-node --transpile-only scripts/generate-plastic-material-cut-codes-migration.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildPlasticMaterialCutCodesMigrationSql } from '../src/modules/bom-items/costing/plastic-molding/plastic-material-cut-codes-migration';

const csv = readFileSync(join(__dirname, '../../memory/Plastic Modeling/materials_final.csv'), 'utf-8');
const out = join(__dirname, '../migrations/978_plastic_material_cut_codes.sql');
writeFileSync(out, buildPlasticMaterialCutCodesMigrationSql(csv));
console.log(`wrote ${out}`);
