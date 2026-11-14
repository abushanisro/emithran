import { describe, expect, it } from 'vitest';

import { buildEngineCalculatorSeeds } from '@/lib/calculators/engine-calculator-seeds';

const BENDING = '102772ff-5422-45c1-b391-6d2d4a96ab1b'; // "Sheet Metal - Bending Manufacturing"

// Live shape (2026-10-08, part 830-001720-00): the applied route's press-brake
// line has the calculator id but no trace; the cost summary's line has it.
const routeLine = { calculatorId: BENDING, calculationTrace: null };
const costSummaryLine = {
  calculatorId: BENDING,
  calculationTrace: [
    { kind: 'input', fieldName: 'Thickness', value: 1.5, source: 'BOM sheet thickness' },
    { kind: 'input', fieldName: 'UTS', value: 270, source: 'raw_materials — SECC' },
    { kind: 'calculated', fieldName: 'Theoretical Force', value: 0.453 },
    { kind: 'input', fieldName: 'Time Per Stroke', value: 3.5 },
  ],
};

describe('buildEngineCalculatorSeeds', () => {
  it('a traceless applied-route line does not hide the cost summary line (UTS reaches the popup)', () => {
    const seeds = buildEngineCalculatorSeeds([routeLine, costSummaryLine]);
    expect(seeds[BENDING].inputs.UTS).toBe(270);
    expect(seeds[BENDING].provenance.UTS).toBe('raw_materials — SECC');
  });

  it('keeps inputs only — calculated values are recomputed by the calculator', () => {
    const seeds = buildEngineCalculatorSeeds([costSummaryLine]);
    expect(seeds[BENDING].inputs).toEqual({ Thickness: 1.5, UTS: 270, 'Time Per Stroke': 3.5 });
  });

  it('first traced line wins for a calculator', () => {
    const later = { ...costSummaryLine, calculationTrace: [{ kind: 'input', fieldName: 'UTS', value: 999 }] };
    expect(buildEngineCalculatorSeeds([costSummaryLine, later])[BENDING].inputs.UTS).toBe(270);
  });

  it('lines without a calculator id give no seed', () => {
    expect(buildEngineCalculatorSeeds([{ calculationTrace: costSummaryLine.calculationTrace }])).toEqual({});
  });
});

describe('a line run once per group (thread sizes)', () => {
  it('fills the calculator from the first group under its own field names, and says which group', () => {
    const seeds = buildEngineCalculatorSeeds([{
      calculatorId: 'rigid-tapping',
      calculationTrace: [
        { kind: 'input', fieldName: 'M2 · Thread Diameter', value: 2, source: 'Thread size M2', group: 'M2', groupField: 'Thread Diameter' },
        { kind: 'input', fieldName: 'M3 · Thread Diameter', value: 3, source: 'Thread size M3', group: 'M3', groupField: 'Thread Diameter' },
        { kind: 'input', fieldName: 'Bar Diameter', value: 30, source: 'Blank optimizer' },
      ],
    }]);
    expect(seeds['rigid-tapping']!.inputs).toEqual({ 'Thread Diameter': 2, 'Bar Diameter': 30 });
    expect(seeds['rigid-tapping']!.provenance['Thread Diameter']).toBe('Thread size M2 — M2, the first of 2 groups (M2, M3)');
  });
});
