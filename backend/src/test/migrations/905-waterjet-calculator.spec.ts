// Migration 905 makes the waterjet calculator compute cut time, pierce time and total time from the
// part and the machine. The formulas stored in the migration are run through the real formula
// evaluator, with the real reference values (variables and a machine from the machine library).
import * as fs from 'fs';
import * as path from 'path';
import { evaluateCalculatorFormulas } from '../../modules/calculators/calculator-formula-evaluator';

const sql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/905_waterjet_calculator_cycle_time.sql'), 'utf8');
const formulaOf = (field: string) => new RegExp(`SET default_value =\\s*'([^']*)'\\s*WHERE calculator_id = v_calc.id AND field_name = '${field}'`).exec(sql)![1]!;

const input = (field_name: string, display_order: number) => ({ id: field_name, field_name, field_type: 'number', default_value: null, display_order }) as any;
const calc = (field_name: string, default_value: string, display_order: number) => ({ id: field_name, field_name, field_type: 'calculated', default_value, display_order }) as any;
const fields = [
  input('Cutting Length', 1), input('No Of Starts', 2), input('Cutting Speed', 3), input('Lead In Per Start', 4),
  input('Cut Time Adjustment Factor', 5), input('Pierce Delay Per Start', 6),
  calc('Cutting Time', formulaOf('Cutting Time'), 7), calc('Piercing Time', formulaOf('Piercing Time'), 8),
  calc('Total Time', '({Cutting Time} + {Piercing Time}) * 60', 9),
];

// Real references: lead-in 5 mm and adjustment 1.4 (sheet metal variables), nozzle delay 4 s
// (Flow Mach 2 1313b). A part with 1000 mm of cut and 2 starts at 500 mm/min.
const real = {
  'Cutting Length': 1000, 'No Of Starts': 2, 'Cutting Speed': 500,
  'Lead In Per Start': 5, 'Cut Time Adjustment Factor': 1.4, 'Pierce Delay Per Start': 4,
};
const run = (values: Record<string, number>) => evaluateCalculatorFormulas(fields, [], values).results;
const value = (r: any) => (r && typeof r === 'object' && 'value' in r ? r.value : r);

describe('migration 905 — waterjet calculator cycle time', () => {
  it('removes the fields nothing reads and the table pierce time', () => {
    for (const f of ['Process Type', 'Pump Power', 'Machine Name', 'Machine Automation', 'Direct Labors', 'Skilled Labors', 'Piercing Time Per Start']) {
      expect(sql).toContain(`'${f}'`);
    }
  });

  it('cut time: length plus lead-in and lead-out of every start, at the cutting speed, times the adjustment', () => {
    const expectedMin = ((1000 + 2 * 2 * 5) / 500) * 1.4;
    expect(value(run(real)['Cutting Time'])).toBeCloseTo(expectedMin, 9);
  });

  it('pierce time: the machine nozzle delay at every start', () => {
    expect(value(run(real)['Piercing Time'])).toBeCloseTo((4 * 2) / 60, 9);
  });

  it('total time in seconds is the sum of both', () => {
    const expectedSec = (((1000 + 20) / 500) * 1.4 + 8 / 60) * 60;
    expect(value(run(real)['Total Time'])).toBeCloseTo(expectedSec, 6);
  });

  it('is slower in a thicker (slower) material and with more starts', () => {
    const base = value(run(real)['Total Time']);
    expect(value(run({ ...real, 'Cutting Speed': 250 })['Total Time'])).toBeGreaterThan(base);
    expect(value(run({ ...real, 'No Of Starts': 20 })['Total Time'])).toBeGreaterThan(base);
  });

  it('is not resolved when a machine input is missing, never a default', () => {
    const { ['Pierce Delay Per Start']: _omit, ...withoutDelay } = real;
    expect(typeof value(run(withoutDelay)['Total Time'])).not.toBe('number');
  });

  it('is re-runnable and aborts when no waterjet calculator exists', () => {
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).toContain("RAISE EXCEPTION 'no \"Sheet Metal - Waterjet Cutting Manufacturing\" calculator found'");
  });
});
