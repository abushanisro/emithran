import { describe, expect, it } from 'vitest';

import { calculatorRunEntries, splitSandRuns, variableOfSource, type CalculatorRun } from '@/lib/costing/sand-calculations';

const run = (over: Partial<CalculatorRun>): CalculatorRun => ({
  calculatorId: 'c1', calculatorVersion: 2, name: 'Sand metal per casting', output: 'kg', value: 3.21987,
  trace: [{ fieldName: 'a', displayLabel: 'A', kind: 'input', value: 1 }], lookupMatches: {}, missing: [], ...over,
});

describe('sand calculator runs', () => {
  it('lists each run with its figure rounded to three places', () => {
    const e = calculatorRunEntries({ m: run({}), r: run({ name: 'Sand risers', value: 0.0354, output: 'kg' }) });
    expect(e.map((x) => [x.title, x.result])).toEqual([['Sand metal per casting', '3.22 kg'], ['Sand risers', '0.035 kg']]);
  });

  it('a run keeps what it could not resolve and shows no figure when it has no value', () => {
    const [r] = calculatorRunEntries({ m: run({ value: null, missing: ['density'], trace: [] }) });
    expect(r.result).toBeNull();
    expect(r.missing).toEqual(['density']);
    expect(r.noTraceReason).toMatch(/no trace/);
  });

  it('nothing in, nothing out', () => {
    expect(calculatorRunEntries(undefined)).toEqual([]);
  });
});

describe('the plant variable behind a trace input', () => {
  it('is read from the backend wording, with or without a part value, and from nothing else', () => {
    expect(variableOfSource('Sand casting variable finishAllowance (Length)')).toBe('finishAllowance');
    expect(variableOfSource('Your value for sand casting variable finishAllowance (Length): the plant value is 0.5')).toBe('finishAllowance');
    expect(variableOfSource('machine Hot box 1: cycle')).toBeNull();
    expect(variableOfSource('Sand casting - Gating system')).toBeNull();
    expect(variableOfSource(undefined)).toBeNull();
  });
});

describe('where each sand calculator run is shown', () => {
  it('core boxes under Tooling; the metal, risers, gating and core sand under the material', () => {
    const r = run({});
    const { material, tooling } = splitSandRuns({ 'Sand metal per casting': r, 'Sand risers': r, 'Sand core sand 1': r, 'Sand core box 1': r, 'Sand core box 2': r });
    expect(Object.keys(material)).toEqual(['Sand metal per casting', 'Sand risers', 'Sand core sand 1']);
    expect(Object.keys(tooling)).toEqual(['Sand core box 1', 'Sand core box 2']);
    expect(splitSandRuns(undefined)).toEqual({ material: {}, tooling: {} });
  });
});
