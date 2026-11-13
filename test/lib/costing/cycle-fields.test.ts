import { describe, expect, it } from 'vitest';

import type { CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';
import { cycleFields, formatFieldValue } from '@/lib/costing/cycle-fields';

// The Cost panel's Cycle section: the line's Cycle Time, the phases its formula adds up (shown first, editable), and every other field of the calculation.
const input = (fieldName: string, value: number, unit: string | null, source: string): CalculationTraceStep => ({ fieldName, displayLabel: fieldName, kind: 'input', value, unit, source });
const calc = (fieldName: string, value: number, unit: string | null, formula: string): CalculationTraceStep => ({ fieldName, displayLabel: fieldName, kind: 'calculated', value, unit, formula });

const trace: CalculationTraceStep[] = [
  input('Nominal Wall Thickness', 1.5, 'mm', 'CAD nominal wall thickness'),
  input('Press Dry Cycle Time', 1.18, 's', 'Press reference record'),
  input('Cycle Time Adjustment Factor', 1, null, 'variables: cycleTimeAdjustmentFactor'),
  calc('Thermal Diffusivity', 0.08, 'mm²/s', '{Thermal Conductivity of Melt} / 2'),
  calc('Cooling Time', 2.9, 's', 'floor({Nominal Wall Thickness} * 2)'),
  calc('Fill Time', 0.12, 's', '{Shot Melt Volume} / {Press Injection Rate}'),
  calc('Cycle Time', 4.2, 's', '({Fill Time} + {Cooling Time} + {Press Dry Cycle Time}) * {Cycle Time Adjustment Factor}'),
];

describe('cycleFields', () => {
  it('splits the calculation into the cycle, its phases in formula order, and the rest in calculator order', () => {
    const f = cycleFields(trace);
    if (!f) throw new Error('no cycle');
    expect(f.cycle.fieldName).toBe('Cycle Time');
    expect(f.phases.map((s) => s.fieldName)).toEqual(['Fill Time', 'Cooling Time', 'Press Dry Cycle Time', 'Cycle Time Adjustment Factor']);
    expect(f.others.map((s) => s.fieldName)).toEqual(['Nominal Wall Thickness', 'Thermal Diffusivity']);
  });

  it('is null without a Cycle Time (or Total Time) in the calculation', () => {
    expect(cycleFields([])).toBeNull();
    expect(cycleFields([input('A', 1, 's', 'x')])).toBeNull();
  });
});

describe('formatFieldValue', () => {
  it('keeps the precision a phase needs: 2.9 s is not 3 s, 1.18 s is not 1 s', () => {
    expect(formatFieldValue(2.9)).toBe('2.9');
    expect(formatFieldValue(1.18)).toBe('1.18');
    expect(formatFieldValue(0.0797238)).toBe('0.0797');
    expect(formatFieldValue(784.61)).toBe('784.61');
    expect(formatFieldValue(null)).toBe('—');
  });
});
