import { describe, expect, it } from 'vitest';

import type { ProcessLineCost } from '@/lib/api/hooks/useBOMItems';
import { calculationEntries, type CalculatorRun } from '@/lib/costing/sand-calculations';

const line = (over: Partial<ProcessLineCost>) => ({ process: 'Pour', cycleTimeMin: 1.23456, ...over }) as ProcessLineCost;
const run = (over: Partial<CalculatorRun>): CalculatorRun => ({
  calculatorId: 'c1', calculatorVersion: 2, name: 'Sand metal per casting', output: 'kg', value: 3.21987,
  trace: [{ fieldName: 'a', displayLabel: 'A', kind: 'input', value: 1 }], lookupMatches: {}, missing: [], ...over,
});

describe('sand calculation entries', () => {
  it('lists route steps in order, then calculator runs, with the figures rounded to three places', () => {
    const e = calculationEntries([line({ process: 'Melt' }), line({ process: 'Pour' })], { m: run({}) });
    expect(e.map((x) => x.title)).toEqual(['Melt', 'Pour', 'Sand metal per casting']);
    expect(e.map((x) => x.kind)).toEqual(['route step', 'route step', 'calculator run']);
    expect(e[0].result).toBe('1.235 min');
    expect(e[2].result).toBe('3.22 kg');
  });

  it('a step without a trace says why instead of showing an empty trace', () => {
    const [a, b] = calculationEntries([line({}), line({ calculationTrace: [{ fieldName: 'x', displayLabel: 'X', kind: 'calculated', value: 2 }] })], undefined);
    expect(a.noTraceReason).toMatch(/without a calculator trace/);
    expect(b.noTraceReason).toBeNull();
  });

  it('a run keeps what it could not resolve and shows no figure when it has no value', () => {
    const [r] = calculationEntries(undefined, { m: run({ value: null, missing: ['density'], trace: [] }) });
    expect(r.result).toBeNull();
    expect(r.missing).toEqual(['density']);
    expect(r.noTraceReason).toMatch(/no trace/);
  });

  it('nothing in, nothing out', () => {
    expect(calculationEntries(undefined, undefined)).toEqual([]);
  });
});
