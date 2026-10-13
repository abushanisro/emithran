// Migration 904 makes Cycle Time (sec) of the TPP calculator a calculated field. The formula
// stored in the migration is run here through the real calculator formula evaluator.
import * as fs from 'fs';
import * as path from 'path';
import { evaluateCalculatorFormulas } from '../../modules/calculators/calculator-formula-evaluator';

const sql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/904_tpp_calculator_cycle_time.sql'), 'utf8');
const formula = /'(\(\{Punch Count\}[^']*)'/.exec(sql)![1]!;

const field = (field_name: string, field_type: string, default_value: string | null = null, display_order = 0) =>
  ({ id: field_name, field_name, field_type, default_value, display_order } as any);
const fields = [
  field('Punch Count', 'number'), field('Punch Rate (hits/min)', 'number'), field('Stroke Rate Factor', 'number'),
  field('Tool Changes', 'number'), field('Tool Change Time (s)', 'number'), field('Nibble Length (mm)', 'number'),
  field('Nibble Speed (mm/min)', 'number'), field('Lot size', 'number'),
  field('Cycle Time (sec)', 'calculated', formula, 15),
];

// Amada EM-3510 ZRB (Countries data punchRate 500; library nibble 410 x (6.35 - 0.5); tool change 1.5 s;
// Lookup Table 1 intermediate factor at 30 t: 0.62), a part with 20 punched holes of 3 diameters.
const real = {
  'Punch Count': 20, 'Punch Rate (hits/min)': 500, 'Stroke Rate Factor': 0.62,
  'Tool Changes': 3, 'Tool Change Time (s)': 1.5, 'Nibble Length (mm)': 1000, 'Nibble Speed (mm/min)': 2398.5, 'Lot size': 10,
};
const run = (input: Record<string, number>) => evaluateCalculatorFormulas(fields, [], input).results['Cycle Time (sec)'];
const value = (r: any) => (r && typeof r === 'object' && 'value' in r ? r.value : r);

describe('migration 904 — TPP calculator cycle time', () => {
  it('removes the fields nothing reads and the typed-in cycle time', () => {
    for (const f of ['Process Type', 'Machine Name', 'M/c Automation', 'Direct Labors', 'Skilled Labors', 'Cycle Time (sec)']) {
      expect(sql).toContain(`'${f}'`);
    }
    expect(sql).toMatch(/DELETE FROM calculator_fields/);
  });

  it('computes punching + tool changes + nibbling from the machine and part inputs', () => {
    const expected = (20 / (500 * 0.62)) * 60 + (3 * 1.5) / 10 + (1000 / 2398.5) * 60;
    expect(value(run(real))).toBeCloseTo(expected, 6);
  });

  it('is slower on a slower machine and for a more complex part', () => {
    const base = value(run(real));
    expect(value(run({ ...real, 'Punch Rate (hits/min)': 240 }))).toBeGreaterThan(base);
    expect(value(run({ ...real, 'Stroke Rate Factor': 0.55 }))).toBeGreaterThan(base);
  });

  it('is not resolved when a machine input is missing, never a default', () => {
    const { ['Punch Rate (hits/min)']: _omit, ...withoutRate } = real;
    expect(typeof value(run(withoutRate))).not.toBe('number');
  });

  it('is re-runnable and aborts when no TPP calculator exists', () => {
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).toContain("RAISE EXCEPTION 'no \"Sheet Metal - TPP Manufacturing\" calculator found'");
  });
});
