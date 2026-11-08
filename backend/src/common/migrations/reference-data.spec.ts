import * as fs from 'fs';
import * as path from 'path';

import { migrationNumber } from './migration-plan';
import { classifyStatement, splitStatements } from './sql-statements';

// Reference data (eMithran's rates, lookups and process knowledge) no longer arrives through migrations: from
// REFERENCE_DATA.json's `noNewRowsAfter` on, a migration may change a reference table's schema but must not write its rows.
// Those rows ship in versioned, licensed data packages instead (on-premises plan, steps 4-5).

const migrationsDir = path.join(__dirname, '../../../migrations');
const manifest = JSON.parse(fs.readFileSync(path.join(migrationsDir, 'REFERENCE_DATA.json'), 'utf8')) as {
  noNewRowsAfter: number;
  reference: string[];
  shared: Record<string, string>;
  /** Migrations after the cut-off that still write reference rows, each with the reason and the condition for removing the entry. */
  exceptions: Record<string, string>;
};
const protectedTables = new Set([...manifest.reference, ...Object.keys(manifest.shared)]);
const afterCutoff = (f: string) => f.endsWith('.sql') && (migrationNumber(f) ?? 0) > manifest.noNewRowsAfter && migrationNumber(f) !== 999;
const qualified = (t: string) => (t.includes('.') ? t : `public.${t}`);

/** The rows a migration writes into reference or shared tables: `file: VERB table`. Procedural bodies are not inspected. */
function referenceWrites(name: string, sql: string): string[] {
  return splitStatements(sql)
    .map(classifyStatement)
    .filter((s) => s.kind === 'data' && protectedTables.has(qualified(s.table!)))
    .map((s) => `${name}: ${s.verb} ${qualified(s.table!)}`);
}

describe('reference data stays out of new migrations', () => {
  it('the manifest lists each table once, in one category, schema-qualified', () => {
    const all = [...manifest.reference, ...Object.keys(manifest.shared)];
    expect(new Set(all).size).toBe(all.length);
    for (const t of all) expect(t).toMatch(/^[a-z_]+\.[a-z0-9_]+$/);
  });

  it('no migration after the cut-off writes rows into a reference or shared table', () => {
    const newer = fs.readdirSync(migrationsDir).filter((f) => afterCutoff(f) && !(f in manifest.exceptions));
    const writes = newer.flatMap((f) => referenceWrites(f, fs.readFileSync(path.join(migrationsDir, f), 'utf8')));
    expect(writes).toEqual([]);
  });

  it('each exception is a real migration after the cut-off with a stated reason and a condition for removal, so the list cannot hold a vague or stale entry', () => {
    const files = new Set(fs.readdirSync(migrationsDir).filter(afterCutoff));
    expect(Object.keys(manifest.exceptions).length).toBeGreaterThan(0);
    for (const [file, reason] of Object.entries(manifest.exceptions)) {
      expect(files.has(file)).toBe(true);
      expect(reason.length).toBeGreaterThan(80);
      expect(reason).toMatch(/Remove this entry when/);
    }
  });

  it('an exception only covers the migration it names: the same write in another file is still caught', () => {
    const writes = referenceWrites('978_plastic_material_cut_codes.sql', 'UPDATE raw_materials SET cut_code = 1;');
    expect(writes).toEqual(['978_plastic_material_cut_codes.sql: UPDATE public.raw_materials']);
    expect('984_other.sql' in manifest.exceptions).toBe(false);
  });

  it('would catch one (the check is not vacuous)', () => {
    expect(referenceWrites('936_x.sql', "INSERT INTO sm_lookup_laser_cut (a) VALUES (1); UPDATE public.mhr_records SET x = 1;")).toEqual([
      '936_x.sql: INSERT public.sm_lookup_laser_cut',
      '936_x.sql: UPDATE public.mhr_records',
    ]);
    expect(referenceWrites('936_x.sql', 'ALTER TABLE sm_lookup_laser_cut ADD COLUMN b int;')).toEqual([]);
  });
});
