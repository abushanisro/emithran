import { describe, expect, it } from 'vitest';

import { metalBalance } from '@/lib/costing/sand-balance';
import type { CalculatorRun } from '@/lib/costing/sand-calculations';

const step = (label: string, value: number) => ({ fieldName: label, displayLabel: `${label} (kg)`, kind: 'calculated' as const, value });
const run = (values: Record<string, number>): CalculatorRun => ({
  calculatorId: 'c', calculatorVersion: 1, name: 'Sand Casting - Material cost', output: 'Material Cost', value: 1,
  trace: Object.entries(values).map(([k, v]) => step(k, v)), lookupMatches: {}, missing: [],
});

// Worked by hand: net 8 kg, poured 11 kg (gates and risers 3 kg), furnace factor 0.95 -> melt loss 11 / 0.95 - 11 = 0.5789..., 50 % of the
// gates and risers remelted: returned 1.5, bought = 8 + 0.5789 + 1.5 = 10.0789.
const melt = 11 / 0.95 - 11;
const values = { 'Net Weight': 8, 'Poured Weight': 11, 'Melt Loss': melt, 'Remelt Allowance': 0.5, 'Bought Weight': 8 + melt + 1.5 };

describe('the metal balance of a sand casting', () => {
  it('splits what is poured into the casting, the gates and risers, and what is bought into the casting, melt loss and the gates and risers not remelted', () => {
    const b = metalBalance({ 'Sand material cost': run(values) })!;
    expect(b.netKg).toBe(8);
    expect(b.gatesAndRisersKg).toBe(3);
    expect(b.pouredKg).toBe(11);
    expect(b.returnedKg).toBe(1.5);
    expect(b.meltLossKg).toBeCloseTo(0.578947, 5);
    expect(b.boughtKg).toBeCloseTo(10.078947, 5);
    expect(b.yieldPct).toBeCloseTo(72.7273, 3);
  });

  it('closes: bought is exactly the casting plus melt loss plus the gates and risers not remelted', () => {
    expect(Math.abs(metalBalance({ 'Sand material cost': run(values) })!.residualKg)).toBeLessThan(1e-9);
  });

  it('shows a balance that does not close, instead of hiding it', () => {
    expect(metalBalance({ 'Sand material cost': run({ ...values, 'Bought Weight': 12 }) })!.residualKg).toBeCloseTo(12 - 10.078947, 5);
  });

  it('keeps the remelt share between 0 and 1', () => {
    expect(metalBalance({ 'Sand material cost': run({ ...values, 'Remelt Allowance': 2 }) })!.returnedKg).toBe(3);
    expect(metalBalance({ 'Sand material cost': run({ ...values, 'Remelt Allowance': -1 }) })!.returnedKg).toBe(0);
  });

  it('is null without the run or without a figure, never a guess', () => {
    expect(metalBalance(undefined)).toBeNull();
    expect(metalBalance({})).toBeNull();
    const { 'Melt Loss': _melt, ...lacking } = values;
    expect(metalBalance({ 'Sand material cost': run(lacking) })).toBeNull();
  });
});
