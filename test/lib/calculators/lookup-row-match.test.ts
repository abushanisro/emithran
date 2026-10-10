import { describe, expect, it } from 'vitest';

import { isMatchedLookupRow } from '@/lib/calculators/lookup-row-match';

// sm_lookup_manual_stroke rows (Lookup Table 4) at the 100 T class.
const rows = [
  { thickness_mm: 1, tonnage: 100, complexity: 'simple', stroke_time_sec: 2 },
  { thickness_mm: 2, tonnage: 100, complexity: 'simple', stroke_time_sec: 2.5 },
  { thickness_mm: 3, tonnage: 100, complexity: 'simple', stroke_time_sec: 3 },
];

describe('isMatchedLookupRow', () => {
  it('outlines both rows an interpolated value (1.6 mm) sits between', () => {
    const bracket = [
      { thickness_mm: 1, tonnage: 100, complexity: 'simple', stroke_time_sec: 2 },
      { thickness_mm: 2, tonnage: 100, complexity: 'simple', stroke_time_sec: 2.5 },
    ];
    expect(rows.map((r) => isMatchedLookupRow(r, bracket))).toEqual([true, true, false]);
  });

  it('outlines only the exact row for an exact match', () => {
    expect(rows.map((r) => isMatchedLookupRow(r, { thickness_mm: 3, tonnage: 100 }))).toEqual([false, false, true]);
  });

  it('outlines nothing when no row is in use (machine own cycle time)', () => {
    expect(rows.some((r) => isMatchedLookupRow(r, null))).toBe(false);
  });

  it('never matches a synthetic interpolated row against real rows', () => {
    const interpolated = { thickness_mm: 1.6, tonnage: 100, stroke_time_sec: 2.3 };
    expect(rows.some((r) => isMatchedLookupRow(r, interpolated))).toBe(false);
  });

  // Live API shape (smoke test 2026-10-08): rows and resolver rows arrive camelCased.
  it('matches when the API camelCases keys and the matcher holds the database spelling', () => {
    const apiRows = rows.map((r) => ({ thicknessMm: r.thickness_mm, tonnage: r.tonnage, complexity: r.complexity, strokeTimeSec: r.stroke_time_sec }));
    expect(apiRows.map((r) => isMatchedLookupRow(r, { thickness_mm: 2, tonnage: 100 }))).toEqual([false, true, false]);
  });

  it('never outlines every row when no column is shared (spelling or shape mismatch)', () => {
    expect(rows.some((r) => isMatchedLookupRow(r, { unrelatedColumn: 5 }))).toBe(false);
  });
});
