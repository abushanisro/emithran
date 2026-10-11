import { describe, expect, it } from 'vitest';

import { describeStrokeLookup, strokeComplexity, type StrokeLookupOutcome } from '@/lib/calculators/stroke-lookup';

/** The outcome, failing the test when there is none. */
function must(o: StrokeLookupOutcome | null): StrokeLookupOutcome {
  if (!o) throw new Error('expected a stroke lookup outcome');
  return o;
}

const ctx = { thicknessMm: 1.6, tonnage: 111.76, complexity: 'simple' as const, machineName: '11010 (Heller-hydraulic)' };

describe('describeStrokeLookup', () => {
  it('machine own cycle time: outlines no table row and names the machine', () => {
    const out = must(describeStrokeLookup({ value: 3.5, fromMachineSpec: true, resolution: { nearestRows: [] } }, ctx));
    expect(out.value).toBe(3.5);
    expect(out.matchedRows).toBeNull();
    expect(out.provenance).toContain('"11010 (Heller-hydraulic)" own bend cycle time');
  });

  it('interpolated: outlines the two real bracketing rows and says which', () => {
    const lo = { thickness_mm: 1, tonnage: 100, complexity: 'simple', stroke_time_sec: 2 };
    const hi = { thickness_mm: 2, tonnage: 100, complexity: 'simple', stroke_time_sec: 2.5 };
    const out = must(describeStrokeLookup({ value: 2.3, resolution: { policy: 'INTERPOLATE', nearestRows: [{ columns: lo }, { columns: hi }] } }, ctx));
    expect(out.matchedRows).toEqual([lo, hi]);
    expect(out.provenance).toContain('100T class');
    expect(out.provenance).toContain('1.6mm interpolated between the 1mm and 2mm rows');
  });

  it('interpolated, live API shape (camelCase columns): Why text still names the rows', () => {
    const lo = { thicknessMm: 1, tonnage: 100, complexity: 'simple', strokeTimeSec: 1.22 };
    const hi = { thicknessMm: 2, tonnage: 100, complexity: 'simple', strokeTimeSec: 1.36 };
    const out = must(describeStrokeLookup({ value: 1.304, resolution: { policy: 'INTERPOLATE', nearestRows: [{ columns: lo }, { columns: hi }] } }, ctx));
    expect(out.provenance).toContain('100T class');
    expect(out.provenance).toContain('between the 1mm and 2mm rows');
    expect(out.provenance).not.toContain('undefined');
  });

  it('exact: outlines the single matched row', () => {
    const row = { thickness_mm: 1.6, tonnage: 100, complexity: 'simple', stroke_time_sec: 2.3 };
    const out = must(describeStrokeLookup({ value: 2.3, row: { columns: row }, resolution: { nearestRows: [] } }, ctx));
    expect(out.matchedRows).toEqual(row);
  });

  it('no value (table gap): returns null so the gap is reported, never a guess', () => {
    expect(describeStrokeLookup({ value: null }, ctx)).toBeNull();
    expect(describeStrokeLookup(null, ctx)).toBeNull();
  });
});

describe('strokeComplexity', () => {
  it.each([
    ['Complex', 'medium', 'complex'],
    ['Simple', 'complex', 'simple'],   // calculator input wins over the part
    ['', 'complex', 'complex'],
    [undefined, 'medium', 'simple'],
    [undefined, undefined, 'simple'],
  ])('calculator %s + part %s -> %s', (calc, part, expected) => {
    expect(strokeComplexity(calc, part)).toBe(expected);
  });
});
