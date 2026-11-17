import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { normalizeFieldName } from '../../../../../modules/calculators/calculator-formula-evaluator';
import { loadInvestmentCastingCalculatorSpec } from '../../../../../modules/bom-items/costing/casting/investment/calculators/investment-casting-calculator-spec';
import { buildInvestmentCastingCalculatorsMigrationSql } from '../../../../../modules/bom-items/costing/casting/investment/calculators/investment-casting-calculators-migration';
import { allInvestmentMachines, investmentBaselineVariables, investmentMaterial } from './investment-test-data';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const MIGRATIONS = join(__dirname, '../../../../../../migrations');
const DIR = join(__dirname, '../../../../../../../memory/Casting Investment');
const all = loadInvestmentCastingCalculatorSpec().calculators;

describe('investment casting calculator spec', () => {
  it('is what migration 1046 creates (regenerate the migration after editing the spec)', () => {
    expect(readFileSync(join(MIGRATIONS, '1046_investment_casting_calculators.sql'), 'utf8')).toBe(buildInvestmentCastingCalculatorsMigrationSql());
  });

  it('every operation it computes is a process of the staged catalog (migration 871) and none is computed twice', () => {
    const catalog = new Set(readCsv(join(DIR, 'Processes/processes.csv')).rows.map((r: Record<string, string>) => r['Process Name']));
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

  describe('every source resolves to real data', () => {
    const sources = all.flatMap((c) => c.fields.flatMap((f) => (f.source ? [{ at: `${c.name}/${f.name}`, source: f.source as Record<string, string> }] : [])));
    const of = (kind: string) => sources.filter((s) => kind in s.source).map((s) => ({ at: s.at, key: s.source[kind]! }));

    it('variables are in investment_casting_variables.csv, or staged by migration 1045', () => {
      const variables = new Set<string>([
        ...readCsv(join(DIR, 'investment_casting_variables.csv')).rows.map((r: Record<string, string>) => r['Variable Name']),
        ...investmentBaselineVariables.map((v) => v.key),
      ]);
      expect(investmentBaselineVariables.map((v) => v.key)).toEqual(['waxPatternThermalConductivity', 'waxPatternDieTemperature']);
      expect(of('variable').filter((s) => !variables.has(s.key))).toEqual([]);
    });

    it('lookups are an existing table and header of memory/Casting Investment/Lookup', () => {
      const headers = new Map<string, string[]>(readdirSync(join(DIR, 'Lookup')).filter((f) => f.endsWith('.csv'))
        .map((f) => [f.replace(/\.csv$/, ''), readCsv(join(DIR, 'Lookup', f)).columns as string[]]));
      expect(of('lookup').filter((s) => !headers.get(s.key.slice(0, s.key.indexOf('.')))?.includes(s.key.slice(s.key.indexOf('.') + 1)))).toEqual([]);
    });

    it('machine columns are a spec of some investment casting machine, or its power', () => {
      const keys = new Set(Object.values(allInvestmentMachines()).flat().flatMap((m) => Object.keys(m.specs)));
      expect(of('machine').filter((s) => s.key !== 'machine_power_kw' && !keys.has(s.key))).toEqual([]);
    });

    it('material columns are values the alloys carry', () => {
      const columns = investmentMaterial('Stainless Steel, AISI 304').columns;
      expect(of('material').filter((s) => columns[s.key] == null)).toEqual([]);
    });
  });
});
