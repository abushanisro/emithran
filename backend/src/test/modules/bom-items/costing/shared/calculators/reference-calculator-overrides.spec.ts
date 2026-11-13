import { runReferenceCalculator, withFieldOverrides, type ReferenceCalculators } from '../../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';

// A part's own value for one field of a stored calculator (migration 1011): an engineer who knows better sets it, with the reason. An input's value replaces
// the seeded one; a calculated field's value replaces the formula's result, and every later formula uses it. The trace keeps what the calculator would
// have used and why it was changed. The stored calculator is never edited.
const CALC: ReferenceCalculators = {
  Cycle: {
    calculatorId: 'c1', name: 'Injection Molding - Cycle Time', version: 3,
    fields: [
      { field_name: 'Wall', field_type: 'number', unit: 'mm', display_order: 1 },
      { field_name: 'Dry Cycle', field_type: 'number', unit: 's', display_order: 2 },
      { field_name: 'Cooling Time', field_type: 'calculated', unit: 's', default_value: '{Wall} * {Wall}', display_order: 3 },
      { field_name: 'Pack Time', field_type: 'calculated', unit: 's', default_value: '{Cooling Time} * 0.5', display_order: 4 },
      { field_name: 'Cycle Time', field_type: 'calculated', unit: 's', default_value: '{Cooling Time} + {Pack Time} + {Dry Cycle}', display_order: 5 },
    ],
  },
};
const seeds = { Wall: { value: 2, source: 'CAD nominal wall' }, 'Dry Cycle': { value: 1.2, source: 'Press record' } };
const step = (r: ReturnType<typeof runReferenceCalculator>, name: string) => r.trace.find((t) => t.fieldName === name)!;

describe('a part\'s own value for a calculator field', () => {
  it('without overrides, the calculator runs as stored', () => {
    expect(runReferenceCalculator(CALC, 'Cycle', seeds).value).toBe(4 + 2 + 1.2);
  });

  it('an input: replaces the seeded value, and the trace says what it replaced and why', () => {
    const r = runReferenceCalculator(withFieldOverrides(CALC, { 'Injection Molding - Cycle Time': { 'Dry Cycle': { value: 2, reason: 'press runs slow' } } }), 'Cycle', seeds);
    expect(r.value).toBe(4 + 2 + 2);
    expect(step(r, 'Dry Cycle')).toMatchObject({ value: 2, override: { original: 1.2, reason: 'press runs slow' } });
    expect(step(r, 'Dry Cycle').source).toMatch(/Engineer's value for this part.*press runs slow.*Press record/);
  });

  it('a calculated field: replaces the formula result, and later formulas use it', () => {
    const r = runReferenceCalculator(withFieldOverrides(CALC, { 'Injection Molding - Cycle Time': { 'Cooling Time': { value: 6, reason: 'measured on the tool' } } }), 'Cycle', seeds);
    expect(step(r, 'Cooling Time')).toMatchObject({ kind: 'calculated', value: 6, override: { original: 4, reason: 'measured on the tool' } });
    expect(step(r, 'Pack Time').value).toBe(3);
    expect(r.value).toBe(6 + 3 + 1.2);
    expect(r.outputs['Cooling Time']).toBe(6);
  });

  it('an override of another calculator, or of a field the calculator does not have, changes nothing', () => {
    expect(runReferenceCalculator(withFieldOverrides(CALC, { 'Other Calculator': { Wall: { value: 9, reason: 'x' } } }), 'Cycle', seeds).value).toBe(7.2);
    expect(runReferenceCalculator(withFieldOverrides(CALC, { 'Injection Molding - Cycle Time': { Nope: { value: 9, reason: 'x' } } }), 'Cycle', seeds).value).toBe(7.2);
  });

  it('never edits the stored calculators it is given', () => {
    const before = JSON.stringify(CALC);
    withFieldOverrides(CALC, { 'Injection Molding - Cycle Time': { Wall: { value: 9, reason: 'x' } } });
    expect(JSON.stringify(CALC)).toBe(before);
    expect(withFieldOverrides(CALC, null)).toBe(CALC);
  });
});
