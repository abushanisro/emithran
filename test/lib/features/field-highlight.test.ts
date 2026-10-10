import { describe, expect, it } from 'vitest';

import { checkAgainstInput, resolveFieldHighlight } from '@/lib/features/field-highlight';
import type { FeatureGraphV2 } from '@/lib/types/manufacturing';

const graph: FeatureGraphV2 = {
  metadata: { face_map: [] },
  features: [
    {
      id: 'cut_profile', feature_type: 'Blank',
      occurrences: [
        { centroid: [0, 0, 0], face_ids: [0, 1], cut_category: 'outer_profile', length_mm: 300 },
        { centroid: [0, 0, 0], face_ids: [6], cut_category: 'circular_holes', length_mm: 31.4 },
      ],
    },
    { id: 'bend_r1', feature_type: 'StraightBend', occurrences: [{ centroid: [1, 1, 1], face_ids: [8, 9] }] },
  ],
  measurements: {
    pierce_count: {
      value: 3, unit: 'count', reconciles: false,
      occurrences: [{ kind: 'hole', face_ids: [6] }, { kind: 'initial_pierce', face_ids: [0, 1] }],
    },
    flat_pattern_area: { value: 5000, unit: 'mm2', reconciles: true, occurrences: [{ face_ids: [2, 3, 8, 9] }] },
  },
};

const faces = (n: { occurrences: { face_ids: number[] }[] }) => n.occurrences.flatMap((o) => o.face_ids);

describe('resolveFieldHighlight', () => {
  it('Cutting Length highlights the cut faces and reports the measured sum', () => {
    const h = resolveFieldHighlight('cut_length', graph);
    expect(faces(h!.node)).toEqual([0, 1, 6]);
    expect(h!.measured.value).toBeCloseTo(331.4);
  });

  it('pierces highlight the recorded pierce faces and surface a failed reconciliation', () => {
    const h = resolveFieldHighlight('pierce_count', graph);
    expect(faces(h!.node)).toEqual([6, 0, 1]);
    expect(h!.reconciles).toBe(false);
  });

  it('flat pattern area and bends resolve to their own faces', () => {
    expect(faces(resolveFieldHighlight('flat_pattern_area', graph)!.node)).toEqual([2, 3, 8, 9]);
    expect(faces(resolveFieldHighlight('bend_count', graph)!.node)).toEqual([8, 9]);
  });

  it('a part analysed before the engine recorded a set gets no highlight, not a guess', () => {
    const legacy: FeatureGraphV2 = { metadata: { face_map: [] }, features: [] };
    expect(resolveFieldHighlight('pierce_count', legacy)).toBeNull();
    expect(resolveFieldHighlight('bend_line_length', graph)).toBeNull();
    expect(resolveFieldHighlight('cut_length', legacy)).toBeNull();
  });

  it('no evidence key, or an unknown one, gives no highlight', () => {
    expect(resolveFieldHighlight(undefined, graph)).toBeNull();
    expect(resolveFieldHighlight('cutting_speed', graph)).toBeNull();
  });
});

describe('checkAgainstInput', () => {
  const base = resolveFieldHighlight('cut_length', graph)!; // measures 331.4 mm

  it('agrees when the input holds the measured value within rounding', () => {
    expect(checkAgainstInput(base, 331.4).reconciles).toBe(true);
    expect(checkAgainstInput(base, '331.6').reconciles).toBe(true);
  });

  it('flags an edited or stale input, saying what each side holds', () => {
    const r = checkAgainstInput(base, 400);
    expect(r.reconciles).toBe(false);
    expect(r.note).toBe('the input holds 400 but these faces measure 331.4 mm');
  });

  it('counts must match exactly', () => {
    const pierces = resolveFieldHighlight('pierce_count', { ...graph, measurements: { pierce_count: { value: 128, unit: 'count', reconciles: true, occurrences: [{ face_ids: [1] }] } } })!;
    expect(checkAgainstInput(pierces, 128).reconciles).toBe(true);
    expect(checkAgainstInput(pierces, 127).reconciles).toBe(false);
  });

  it('an empty or non-numeric input is not compared', () => {
    expect(checkAgainstInput(base, '')).toBe(base);
    expect(checkAgainstInput(base, undefined)).toBe(base);
  });
});

describe('bend line length', () => {
  const withBends: FeatureGraphV2 = {
    metadata: { face_map: [] },
    features: [],
    measurements: {
      bend_line_length: {
        value: 150, unit: 'mm', reconciles: true,
        occurrences: [
          { face_ids: [1, 2], length_mm: 30 },
          { face_ids: [3, 4], length_mm: 90 },
          { face_ids: [5, 6], length_mm: 30 },
        ],
      },
    },
  };

  it('highlights and measures the longest single bend, not the sum', () => {
    const h = resolveFieldHighlight('bend_line_length', withBends)!;
    expect(h.node.occurrences.flatMap((o) => o.face_ids)).toEqual([3, 4]);
    expect(h.measured).toEqual({ value: 90, unit: 'mm', label: 'longest of 3 bends' });
    expect(checkAgainstInput(h, 90).reconciles).toBe(true);
    expect(checkAgainstInput(h, 150).reconciles).toBe(false);
  });

  it('an analysis without the recorded set still resolves from its bend features', () => {
    const legacy: FeatureGraphV2 = {
      metadata: { face_map: [] },
      features: [{
        id: 'bend_r1', feature_type: 'StraightBend',
        occurrences: [
          { centroid: [0, 0, 0], face_ids: [1, 2], bend_length_mm: 30 },
          { centroid: [0, 0, 0], face_ids: [3, 4], bend_length_mm: 66 },
        ],
      }],
    };
    const h = resolveFieldHighlight('bend_line_length', legacy)!;
    expect(h.node.occurrences.flatMap((o) => o.face_ids)).toEqual([3, 4]);
    expect(h.measured.value).toBe(66);
    expect(resolveFieldHighlight('bend_line_length', { metadata: { face_map: [] }, features: [] })).toBeNull();
  });
});
