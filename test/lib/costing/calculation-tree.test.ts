import { describe, expect, it } from 'vitest';

import type { CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';
import { buildCalculationTree, type CalculationNode } from '@/lib/costing/calculation-tree';

function must<T>(v: T | null | undefined): T {
  if (v == null) throw new Error('missing');
  return v;
}
const tree = (...a: Parameters<typeof buildCalculationTree>): CalculationNode => must(buildCalculationTree(...a));

// A line's calculation as the stored calculator ran it (inputs, then calculated fields in order), shown as a tree from its result: each
// calculated value opens onto the fields its formula names, as the engineer's "Formula Dependencies" view does.
const input = (fieldName: string, value: number, unit: string, source: string): CalculationTraceStep =>
  ({ fieldName, displayLabel: `${fieldName} (${unit})`, kind: 'input', value, unit, source });
const calc = (fieldName: string, value: number, unit: string, formula: string): CalculationTraceStep =>
  ({ fieldName, displayLabel: `${fieldName} (${unit})`, kind: 'calculated', value, unit, formula });

const trace: CalculationTraceStep[] = [
  input('Nominal Wall Thickness', 2, 'mm', 'CAD'),
  input('Thermal Conductivity of Melt', 0.19, 'W/m·K', 'Material reference'),
  input('Press Dry Cycle Time', 1.18, 's', 'KraussMaffei 35 CX - 180'),
  calc('Thermal Diffusivity', 0.09, 'mm²/s', '{Thermal Conductivity of Melt} / 2'),
  calc('Cooling Time', 3.1, 's', 'floor({Nominal Wall Thickness} * {Nominal Wall Thickness} / {Thermal Diffusivity})'),
  calc('Cycle Time', 4.28, 's', '{Cooling Time} + {Press Dry Cycle Time}'),
];

describe('buildCalculationTree', () => {
  it("starts from the calculator's result and opens each value onto the fields its formula names, in formula order", () => {
    const root = tree(trace);
    expect(root).toMatchObject({ name: 'Cycle Time', value: 4.28, unit: 's', kind: 'calculated', description: '{Cooling Time} + {Press Dry Cycle Time}' });
    expect(root.children.map((c) => c.name)).toEqual(['Cooling Time', 'Press Dry Cycle Time']);
    const cooling = must(root.children[0]);
    expect(cooling.children.map((c) => c.name)).toEqual(['Nominal Wall Thickness', 'Thermal Diffusivity']);
    expect(must(cooling.children[1]).children.map((c) => c.name)).toEqual(['Thermal Conductivity of Melt']);
  });

  it('describes an input by where its value came from, and an input has no children', () => {
    const dry = must(tree(trace).children[1]);
    expect(dry).toMatchObject({ kind: 'input', description: 'KraussMaffei 35 CX - 180', children: [] });
  });

  it('can start from a named field', () => {
    expect(tree(trace, 'Cooling Time').name).toBe('Cooling Time');
  });

  it('is null without a calculated step, and skips a name the trace does not hold', () => {
    expect(buildCalculationTree([])).toBeNull();
    expect(buildCalculationTree([input('A', 1, 's', 'x')])).toBeNull();
    const root = tree([calc('Total', 1, 's', '{Missing} + {A}'), input('A', 1, 's', 'x')].reverse());
    expect(root.children.map((c) => c.name)).toEqual(['A']);
  });

  it('never loops on a formula that names itself', () => {
    const root = tree([calc('X', 1, 's', '{X} + 1')]);
    expect(root.children).toEqual([]);
  });
});
