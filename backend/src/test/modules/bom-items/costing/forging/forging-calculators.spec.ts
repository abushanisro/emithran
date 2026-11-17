import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { normalizeFieldName } from '../../../../../modules/calculators/calculator-formula-evaluator';
import { loadForgingCalculatorSpec } from '../../../../../modules/bom-items/costing/forging/calculators/forging-calculator-spec';
import { buildForgingCalculatorsMigrationSql, buildForgingHammerEnergyMigrationSql, buildForgingRoutesCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/forging/calculators/forging-calculators-migration';
import { FORGING_CLASS } from '../../../../../modules/bom-items/costing/forging/forging-route';
import { allForgingMachines, forgingBaselineVariables, forgingMaterial } from './forging-test-data';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const MIGRATIONS = join(__dirname, '../../../../../../migrations');
const DIR = join(__dirname, '../../../../../../../memory/Forging');
const all = loadForgingCalculatorSpec().calculators;

describe('forging calculator spec', () => {
  it('is what migration 1053 creates (regenerate the migration after editing the spec)', () => {
    expect(readFileSync(join(MIGRATIONS, '1053_forging_calculators.sql'), 'utf8')).toBe(buildForgingCalculatorsMigrationSql());
  });

  it('the calculators of the other routes are what migration 1054 creates (1053 is applied and never edited)', () => {
    expect(readFileSync(join(MIGRATIONS, '1054_forging_routes_calculators.sql'), 'utf8')).toBe(buildForgingRoutesCalculatorsMigrationSql());
  });

  // 1054 multiplied the hammer energy by materialTypeFactor's impact energy factor, the material's flow stress relative to carbon steel, on top of
  // the material's own flow stress. 1057 ships version 2; the superseded entry stays only so 1054 regenerates as applied.
  it('the hammer energy is what migration 1057 creates, and the engine reads only that version', () => {
    expect(readFileSync(join(MIGRATIONS, '1057_forging_hammer_energy.sql'), 'utf8')).toBe(buildForgingHammerEnergyMigrationSql());
    const hammer = all.filter((c) => c.name === 'Forging - Hammer energy');
    expect(hammer).toHaveLength(1);
    expect(hammer[0]).toMatchObject({ migration: 1057, version: 2 });
    expect(hammer[0]!.fields.some((f) => f.name === 'Impact Energy Factor')).toBe(false);
    expect(loadForgingCalculatorSpec({ includeSuperseded: true }).calculators.filter((c) => c.name === 'Forging - Hammer energy')).toHaveLength(2);
  });

  it('every operation it computes is a process of the staged catalog (migration 823) and none is computed twice', () => {
    const catalog = new Set(readCsv(join(DIR, 'forging_processes.csv')).rows.map((r: Record<string, string>) => r['Process Name']));
    const ops = all.flatMap((c) => c.operations);
    expect(ops.filter((o) => !catalog.has(o))).toEqual([]);
    expect(new Set(ops).size).toBe(ops.length);
  });

  it('field names never collide once normalized', () => {
    for (const c of all) {
      const names = c.fields.map((f) => normalizeFieldName(f.name));
      expect({ calc: c.name, dup: names.filter((n, i) => names.indexOf(n) !== i) }).toEqual({ calc: c.name, dup: [] });
    }
  });

  describe('every source resolves to real data', () => {
    const sources = all.flatMap((c) => c.fields.flatMap((f) => (f.source ? [{ at: `${c.name}/${f.name}`, source: f.source as Record<string, string> }] : [])));
    const of = (kind: string) => sources.filter((s) => kind in s.source).map((s) => ({ at: s.at, key: s.source[kind]! }));

    it('variables are in forging_variables.csv, or staged by migrations 1052 and 1055', () => {
      const variables = new Set<string>([...readCsv(join(DIR, 'forging_variables.csv')).rows.map((r: Record<string, string>) => r['Variable Name']), ...forgingBaselineVariables.map((v) => v.key)]);
      expect(of('variable').filter((s) => !variables.has(s.key))).toEqual([]);
    });

    it('lookups are an existing table and header of memory/Forging/Lookup', () => {
      const headers = new Map<string, string[]>(readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv')).map((f) => [f.replace(/\.csv$/, ''), readCsv(join(DIR, 'Lookup', f)).columns as string[]]));
      expect(of('lookup').filter((s) => !headers.get(s.key.slice(0, s.key.indexOf('.')))?.includes(s.key.slice(s.key.indexOf('.') + 1)))).toEqual([]);
    });

    it('machine columns are a spec of some forging machine, or its rated power (machineValue)', () => {
      const keys = new Set(['machine_power_kw', ...Object.values(allForgingMachines()).flat().flatMap((m) => Object.keys(m.specs))]);
      expect(of('machine').filter((s) => !keys.has(s.key))).toEqual([]);
    });

    it('every open die press carries its rated force (migrations 1055 and 1056), or it could never be offered for an upset', () => {
      expect(allForgingMachines()[FORGING_CLASS.openDie]!.filter((m) => m.specs['press_force_kn'] == null).map((m) => m.name)).toEqual([]);
    });

    it('material columns are values the forging materials carry', () => {
      const columns = forgingMaterial('Steel, AISI 4140, Medium-Carbon').columns;
      expect(of('material').filter((s) => columns[s.key] == null)).toEqual([]);
    });
  });
});
