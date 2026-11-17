import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeFieldName } from '../../../../../modules/calculators/calculator-formula-evaluator';
import { loadForgingCalculatorSpec } from '../../../../../modules/bom-items/costing/forging/calculators/forging-calculator-spec';
import { buildForgingCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/forging/calculators/forging-calculators-migration';
import { FORGING_PUBLISHED_TABLES } from '../../../../../modules/bom-items/costing/forging/forging-reference';
import { allForgingMachines, FORGING_DIR, forgingLookupHeaders, forgingMaterial, forgingPublishedTables } from './forging-test-data';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const MIGRATIONS = join(__dirname, '../../../../../../migrations');
const all = loadForgingCalculatorSpec().calculators;

describe('forging calculator spec', () => {
  it('is what migration 1051 creates (regenerate the migration after editing the spec)', () => {
    expect(readFileSync(join(MIGRATIONS, '1051_forging_calculators.sql'), 'utf8')).toBe(buildForgingCalculatorsMigrationSql());
  });

  it('every operation it computes is a process of the staged catalog (migration 790) and none is computed twice', () => {
    const catalog = new Set(readCsv(join(FORGING_DIR, 'forging_processes.csv')).rows.map((r: Record<string, string>) => r['Process Name']));
    const ops = all.flatMap((c) => c.operations);
    expect(ops.filter((o) => !catalog.has(o))).toEqual([]);
    expect(new Set(ops).size).toBe(ops.length);
  });

  it('field names never collide once normalized (the evaluator addresses a field by its normalized name)', () => {
    for (const c of all) {
      const names = c.fields.map((f) => normalizeFieldName(f.name));
      expect({ calc: c.name, dup: names.filter((n, i) => names.indexOf(n) !== i) }).toEqual({ calc: c.name, dup: [] });
    }
  });

  it('migration 1050 stages exactly the two published tables the engine names', () => {
    expect(forgingPublishedTables.map((t) => t.key).sort()).toEqual(Object.values(FORGING_PUBLISHED_TABLES).sort());
    for (const t of forgingPublishedTables) expect(t.raw.rows.length).toBeGreaterThan(0);
  });

  describe('every source resolves to real data', () => {
    const sources = all.flatMap((c) => c.fields.flatMap((f) => (f.source ? [{ at: `${c.name}/${f.name}`, source: f.source as Record<string, string> }] : [])));
    const of = (kind: string) => sources.filter((s) => kind in s.source).map((s) => ({ at: s.at, key: s.source[kind]! }));

    it('variables are in forging_variables.csv and none is deprecated there', () => {
      const rows = readCsv(join(FORGING_DIR, 'forging_variables.csv')).rows as Array<Record<string, string>>;
      const live = new Set(rows.filter((r) => r['Deprecated'] !== 'Yes').map((r) => r['Variable Name']));
      expect(of('variable').filter((s) => !live.has(s.key))).toEqual([]);
    });

    it('lookups are a table and header of memory/Forging/Lookup, or of a published table of migration 1050', () => {
      const headers = forgingLookupHeaders();
      expect(of('lookup').filter((s) => !headers.get(s.key.slice(0, s.key.indexOf('.')))?.includes(s.key.slice(s.key.indexOf('.') + 1)))).toEqual([]);
    });

    it('machine columns are a spec of some forging machine, or its power', () => {
      const keys = new Set(Object.values(allForgingMachines()).flat().flatMap((m) => Object.keys(m.specs)));
      expect(of('machine').filter((s) => s.key !== 'machine_power_kw' && !keys.has(s.key))).toEqual([]);
    });

    it('material columns are values the alloys carry', () => {
      const columns = forgingMaterial('Steel, Hot Worked, AISI 1045').columns;
      expect(of('material').filter((s) => columns[s.key] == null)).toEqual([]);
    });
  });
});
