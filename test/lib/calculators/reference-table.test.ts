import { describe, it, expect } from 'vitest';

import { variablePanel } from '@/lib/calculators/input-source';
import { cellText, outputColumn, pickedValue } from '@/lib/calculators/reference-table';

describe('reference table', () => {
  it('the value picked is the last column (the variables panel: Variable, Unit, Notes, Value)', () => {
    const panel = variablePanel({ kind: 'variable', domain: 'sand_casting', name: 'ambientTemp' } as never, [
      { key: 'ambientTemp', category: 'Temperature', value: '21', unitType: 'Temperature', notes: 'A long note '.repeat(30) },
    ]);
    expect(outputColumn(panel.column_definitions)?.name).toBe('value');
  });

  it('a number is used as a number, a numeric string is parsed, zero stays zero, and text stays text', () => {
    expect(pickedValue(21)).toBe(21);
    expect(pickedValue('0.98')).toBe(0.98);
    expect(pickedValue('0')).toBe(0);
    expect(pickedValue(0)).toBe(0);
    expect(pickedValue('Hot Box')).toBe('Hot Box');
    expect(pickedValue(' 12 ')).toBe(12);
  });

  it('an empty cell shows a dash, never "null"', () => {
    expect(cellText(null)).toBe('—');
    expect(cellText(undefined)).toBe('—');
    expect(cellText('')).toBe('—');
    expect(cellText(0)).toBe('0');
    expect(cellText('x')).toBe('x');
  });
});
