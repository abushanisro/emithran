import { readFileSync } from 'fs';
import { join } from 'path';

import { buildPlasticMaterialCutCodesMigrationSql, cutCodeRows, parseCsv } from '../../../../../modules/bom-items/costing/plastic-molding/plastic-material-cut-codes-migration';

// Migration 978 is generated from memory/Plastic Modeling/materials_final.csv; this proves the committed file is what the generator writes, and what it writes is the reference.

const CSV = readFileSync(join(__dirname, '../../../../../../../memory/Plastic Modeling/materials_final.csv'), 'utf-8');
const MIGRATION = readFileSync(join(__dirname, '../../../../../../migrations/978_plastic_material_cut_codes.sql'), 'utf-8');

describe('migration 978: the cut code of each plastic material, from materials_final.csv', () => {
  it('the committed migration is the generator\'s output for the committed reference (regenerate it, never edit it)', () => {
    expect(MIGRATION).toBe(buildPlasticMaterialCutCodesMigrationSql(CSV));
  });

  it('every reference material that has a cut code is in it, with that cut code', () => {
    const rows = cutCodeRows(CSV);
    expect(rows).toHaveLength(109);
    const nylon = rows.find((r) => r.sourceName === 'generic nylon, type 11 40% glass')!;
    expect(nylon.cutCode).toBe(41.11);
    expect(MIGRATION).toContain("('generic nylon, type 11 40% glass', 41.11)");
    for (const r of parseCsv(CSV)) {
      if (r['cutCode'] && r['sourceName']) expect(rows.some((x) => x.sourceName === r['sourceName']!.trim().toLowerCase() && x.cutCode === Number(r['cutCode']))).toBe(true);
    }
  });

  it('never changes a cut code a row already has, and only touches a name that is one row', () => {
    expect(MIGRATION).toMatch(/AND r\.cut_code IS NULL/);
    expect(MIGRATION).toMatch(/SELECT count\(\*\) FROM raw_materials x WHERE lower\(x\.name\) = v\.source_name\) = 1/);
    expect((MIGRATION.match(/^UPDATE /gm) ?? [])).toHaveLength(1);
  });

  it('a reference name shared by two materials links to nothing (it is ambiguous), and a quote in a name is escaped', () => {
    const csv = 'sourceName,cutCode\nTwin,1.1\nTwin,2.2\nSolo,3.3\n"O\'Brien Resin",4.4\nNo Code,\n';
    expect(cutCodeRows(csv)).toEqual([{ sourceName: "o'brien resin", cutCode: 4.4 }, { sourceName: 'solo', cutCode: 3.3 }]);
    expect(buildPlasticMaterialCutCodesMigrationSql(csv)).toContain("('o''brien resin', 4.4)");
  });

  it('reads quoted fields with commas, as the material names have (Generic Nylon, Type 11 40% Glass)', () => {
    expect(parseCsv('a,b\n"x, y",2\n')).toEqual([{ a: 'x, y', b: '2' }]);
  });
});
